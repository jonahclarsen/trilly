import type { PurchaseHistoryRule } from './types'

export function purchaseHistoryLinks(rules: PurchaseHistoryRule[] = [], payee: string | null = null) {
  const name = (payee ?? '').toLowerCase()
  return rules.filter(rule => rule.payee_contains.some(phrase =>
    phrase.trim().length > 0 && name.includes(phrase.toLowerCase()),
  ))
}
