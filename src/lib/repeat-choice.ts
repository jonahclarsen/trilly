import type { Transaction } from './types'

// Offer the same choice for the rest of the batch after this many identical approvals.
export const repeatThreshold = 3
export const repeatDismissDelayMs = 3000

export type RepeatChoice = { look: string; payee_id: string | null; payee_name?: string; category_id: string; memo: string }

// Transactions look the same when the bank describes them with the same text.
export function lookOf(t: Transaction) {
  return (t.import_payee_name_original ?? t.import_payee_name ?? t.payee_name ?? '').trim()
}

export function repeatKey(choice: RepeatChoice) {
  return JSON.stringify([choice.look, choice.payee_id, choice.payee_name ?? null, choice.category_id, choice.memo])
}
