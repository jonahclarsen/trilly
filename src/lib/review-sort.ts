import type { Transaction } from './types'

export const reviewColumns = [
  ['date', 'Date'], ['payee', 'Payee'], ['category', 'Category'],
  ['description', 'Description'], ['amount', 'Amount'], ['status', 'Status'],
] as const
export type ReviewSortColumn = typeof reviewColumns[number][0]
export type ReviewSortDirection = 'ascending' | 'descending'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function sortReviewRows(rows: readonly Transaction[], column: ReviewSortColumn, direction: ReviewSortDirection, skipped: readonly string[]) {
  const skippedIds = new Set(skipped)
  function value(t: Transaction): string | number {
    switch (column) {
      case 'date': return t.date
      case 'payee': return t.payee_name ?? t.import_payee_name ?? 'Unknown payee'
      case 'category': return t.category_name ?? 'Uncategorized'
      case 'description': return t.memo ?? ''
      case 'amount': return t.amount
      case 'status': return t.approved ? 2 : skippedIds.has(t.id) ? 1 : 0
    }
  }
  return [...rows].sort((a, b) => {
    const left = value(a), right = value(b)
    const comparison = typeof left === 'number' && typeof right === 'number'
      ? left - right : collator.compare(String(left), String(right))
    return comparison * (direction === 'ascending' ? 1 : -1)
      || a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
  })
}

// Filter the displayed order through the authoritative queue; reviewed rows never become current.
export function orderedReviewQueue(rows: readonly Transaction[], queue: readonly Transaction[]) {
  const queued = new Map(queue.map(t => [t.id, t]))
  return rows.flatMap(t => {
    const transaction = queued.get(t.id)
    return transaction ? [transaction] : []
  })
}
