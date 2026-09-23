import type { PurchaseHistoryRule } from './types'

export function purchaseHistoryLinks(rules: PurchaseHistoryRule[] = [], payee: string | null = null) {
  const name = (payee ?? '').toLowerCase()
  const matches = rules.filter(rule => rule.payee_contains.some(phrase =>
    phrase.trim().length > 0 && name.includes(phrase.toLowerCase()),
  ))
  const highestPriority = Math.max(...matches.map(rule => rule.priority ?? 0))
  return matches.filter(rule => (rule.priority ?? 0) === highestPriority)
}

// Keep payment-provider context even when the selected payee is the merchant.
export const paypalMemo = 'via paypal. '
export function isPaypal(...payees: (string | null | undefined)[]) {
  return payees.some(payee => payee?.toLowerCase().includes('paypal'))
}
export function paypalDescription(memo: string | null | undefined, ...payees: (string | null | undefined)[]) {
  return !memo && isPaypal(...payees) ? paypalMemo : null
}
