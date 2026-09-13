import type { Suggestion } from './types'

type Selection = { payee: string | null; newPayee: string | null; category: string | null }

export function reviewSelection(current: Selection, fixed: { payee: boolean; category: boolean }, suggestion?: Suggestion): Selection {
  return {
    payee: suggestion && !fixed.payee ? suggestion.payee_id : current.payee,
    newPayee: suggestion && !fixed.payee ? null : current.newPayee,
    category: suggestion && !fixed.category ? suggestion.category_id : current.category,
  }
}
