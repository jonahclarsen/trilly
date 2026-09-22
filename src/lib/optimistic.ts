import { amazonPayee } from './amazon.ts'
import type { Snapshot, Transaction } from './types.ts'

export type QueuedAction = { body: Record<string, unknown>; restore?: Transaction }

export function project(snapshot: Snapshot, event: QueuedAction): Snapshot {
  const result = { ...snapshot, queue: [...snapshot.queue], review_rows: [...(snapshot.review_rows ?? snapshot.queue)], undo_transactions: [...(snapshot.undo_transactions ?? [])] }
  if (event.body.action === 'description') {
    const transaction = result.queue.find(t => t.id === event.body.id)
    const memo = String(event.body.description)
    if (!transaction || (transaction.memo ?? '') === memo) return result
    const update = (t: Transaction) => t.id === event.body.id ? { ...t, memo } : t
    result.queue = result.queue.map(update)
    result.review_rows = result.review_rows.map(update)
    result.undo_transactions.push(transaction)
    const pending = new Set(result.description_pending ?? [])
    if (!pending.has(transaction.id)) result.pending++
    pending.add(transaction.id)
    result.description_pending = [...pending]
    result.can_undo = true
  } else if (event.body.action === 'business_expense') {
    const transaction = result.queue.find(t => t.id === event.body.id)
    if (!transaction) return result
    const existing = (result.business_expenses ?? []).find(e => e.plan_id === result.plan_id && e.transaction_id === transaction.id)
    const amount = typeof event.body.amount === 'number' ? event.body.amount : existing?.amount ?? -transaction.amount
    const expense = existing ? { ...existing, amount, description: String(event.body.description).trim(), note: String(event.body.note ?? '') } : {
      plan_id: result.plan_id, transaction_id: transaction.id,
      description: String(event.body.description).trim(), note: String(event.body.note ?? ''),
      date: transaction.date, amount,
      account: result.accounts.find(a => a.id === transaction.account_id)?.name ?? '', archived: false,
    }
    result.business_expenses = existing
      ? (result.business_expenses ?? []).map(e => e === existing ? expense : e)
      : [...(result.business_expenses ?? []), expense]
    result.can_undo_business = true; result.can_undo_archive = false
  } else if (event.body.action === 'edit_business_expense') {
    result.business_expenses = (result.business_expenses ?? []).map(expense =>
      expense.plan_id === event.body.plan_id && expense.transaction_id === event.body.id ? {
        ...expense,
        description: String(event.body.description).trim(), date: String(event.body.date),
        amount: Number(event.body.amount), account: String(event.body.account).trim(), note: String(event.body.note ?? ''),
      } : expense)
    result.can_undo_business = true; result.can_undo_archive = false
  } else if (event.body.action === 'review') {
    if (result.amazon_targets) result.amazon_targets = result.amazon_targets.filter(t => t.id !== event.body.id)
    if (typeof event.body.amazon_payment_id === 'string') result.amazon_assignments = [...(result.amazon_assignments ?? []).filter(a => a.transaction_id !== event.body.id), { payment_id: event.body.amazon_payment_id, transaction_id: String(event.body.id) }]
    const transaction = result.queue.find(t => t.id === event.body.id)
    if (transaction) result.undo_transactions.push(transaction)
    result.review_rows = result.review_rows.map(t => t.id !== event.body.id ? t : {
      ...t, approved: true,
      payee_name: typeof event.body.payee_name === 'string' ? event.body.payee_name : typeof event.body.amazon_marketplace === 'string' ? amazonPayee(snapshot.payees, event.body.amazon_marketplace)?.name ?? event.body.amazon_marketplace : snapshot.payees.find(p => p.id === event.body.payee_id)?.name ?? t.payee_name,
      category_name: snapshot.categories.find(c => c.id === event.body.category_id)?.name ?? t.category_name,
      memo: typeof event.body.memo === 'string' ? event.body.memo : t.memo,
    })
    result.queue = result.queue.filter(t => t.id !== event.body.id)
    result.pending++; result.can_undo = true
  } else if (event.body.action === 'undo') {
    if (event.restore && result.amazon_targets && !event.restore.approved && !event.restore.transfer_account_id) result.amazon_targets = [event.restore, ...result.amazon_targets.filter(t => t.id !== event.restore!.id)]
    if (event.restore) result.amazon_assignments = (result.amazon_assignments ?? []).filter(a => a.transaction_id !== event.restore!.id)
    result.undo_transactions.pop()
    if (event.restore) result.description_pending = (result.description_pending ?? []).filter(id => id !== event.restore!.id)
    if (event.restore && event.restore.account_id === result.account_id) {
      result.review_rows = [event.restore, ...result.review_rows.filter(t => t.id !== event.restore!.id)]
      result.queue = [event.restore, ...result.queue.filter(t => t.id !== event.restore!.id)]
    }
    result.pending = Math.max(0, result.pending - 1)
    result.can_undo = result.undo_transactions.length > 0
  }
  return result
}
