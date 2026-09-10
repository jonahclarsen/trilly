import type { Transaction } from './types'

export type Marketplace = 'amazon.ca' | 'amazon.com'
export type AmazonPayment = { id: string; marketplace: Marketplace; date: string; amount: number; currency: string; refund: boolean; payment_method: string; order_ids: string[]; evidence: string }
export type AmazonItem = { id: string; title: string; quantity: number; unit_price: number | null; price_text: string; product_url: string; image: string; seller: string; status: string; details: string }
export type AmazonOrder = { id: string; marketplace: Marketplace; url: string; date: string; currency: string; total: number | null; payment_method: string; items: AmazonItem[]; totals: { label: string; value: string }[]; fetched_at: string }
export type AmazonStore = { payments: AmazonPayment[]; orders: AmazonOrder[] }
export type AmazonCandidate = { payment: AmazonPayment; orders: AmazonOrder[]; confident: boolean; reason: string }
export type AmazonStatus = { running: boolean; pages: number; orders: number; queued: number; active: number; message: string; paused: { tab: number; marketplace: string; reason: string }[] }
export const emptyAmazon = (): AmazonStore => ({ payments: [], orders: [] })
export function isAmazon(t: Transaction) {
  if (t.transfer_account_id || t.debt_transaction_type) return false
  const names = [t.import_payee_name_original, t.import_payee_name, t.payee_name].filter(Boolean).join(' ').toLowerCase()
  return !/amazon mbna card/.test(names) && /\b(?:amazon|amzn)|\bmktp\s*(?:ca|us)\b/.test(names)
}
export function mergeAmazon(store: AmazonStore, incoming: AmazonStore): AmazonStore {
  const payments = new Map(store.payments.map(p => [p.id, p]))
  const orders = new Map(store.orders.map(o => [`${o.marketplace}:${o.id}`, o]))
  for (const p of incoming.payments) payments.set(p.id, p)
  for (const o of incoming.orders) orders.set(`${o.marketplace}:${o.id}`, o)
  const result = { payments: [...payments.values()], orders: [...orders.values()] }
  let imageBytes = result.orders.reduce((n, o) => n + o.items.reduce((sum, i) => sum + i.image.length, 0), 0)
  const withoutImages = new Set<string>()
  for (const order of [...result.orders].sort((a, b) => a.fetched_at.localeCompare(b.fetched_at))) {
    if (imageBytes <= 16 * 1024 * 1024) break
    withoutImages.add(`${order.marketplace}:${order.id}`); imageBytes -= order.items.reduce((n, i) => n + i.image.length, 0)
  }
  result.orders = result.orders.map(o => withoutImages.has(`${o.marketplace}:${o.id}`) ? { ...o, items: o.items.map(i => ({ ...i, image: '' })) } : o)
  return result
}
const distance = (a: string, b: string) => a && b ? Math.abs(Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000 : Infinity
export function amazonCandidates(store: AmazonStore, t: Transaction, currency: string | undefined, targets: Transaction[], assignments: { payment_id: string; transaction_id: string }[] = []): AmazonCandidate[] {
  if (!isAmazon(t)) return []
  const eligible = store.payments.filter(p => !assignments.some(a => a.payment_id === p.id && a.transaction_id !== t.id) && p.amount === t.amount && (p.refund === (t.amount > 0)) && (!p.date || distance(p.date, t.date) <= 14))
  const exact = eligible.filter(p => p.currency === currency && distance(p.date, t.date) <= 7)
  return eligible.map(payment => {
    const competing = targets.filter(other => isAmazon(other) && other.amount === payment.amount && distance(other.date, payment.date) <= 7)
    const confident = exact.length === 1 && exact[0]?.id === payment.id && competing.length === 1 && competing[0]?.id === t.id
    const reason = payment.currency !== currency ? 'Currency differs or is unavailable — confirm manually'
      : !payment.date ? 'Payment date unavailable — confirm manually'
      : confident ? 'Unique amount and currency match within 7 days'
      : competing.length > 1 ? 'Several bank transactions could match this payment'
      : 'Check the payment date and competing matches'
    return { payment, confident, reason, orders: store.orders.filter(o => o.marketplace === payment.marketplace && payment.order_ids.includes(o.id)) }
  }).sort((a, b) => Number(b.confident) - Number(a.confident) || distance(a.payment.date, t.date) - distance(b.payment.date, t.date))
}
export function automaticItems(candidate: AmazonCandidate): AmazonItem[] {
  if (!candidate.confident || candidate.orders.length !== candidate.payment.order_ids.length || candidate.orders.length !== 1) return []
  const order = candidate.orders[0]!
  // A one-product refund still needs quantity/amount review, but its product is
  // unambiguous. Never label a multi-product refund with the whole order.
  if (order.items.length === 1) return order.items
  if (!candidate.payment.refund && order.currency === candidate.payment.currency && order.total === Math.abs(candidate.payment.amount)) return order.items
  return []
}
export function amazonDescription(items: AmazonItem[], refund: boolean) {
  const titles = [...new Set(items.map(i => i.title.replace(/\s+/g, ' ').trim().toLowerCase()))]
  const description = titles.length ? `${refund ? 'refund for ' : ''}${titles.join('; ')}` : ''
  return [...description].length > 500 ? [...description].slice(0, 499).join('') + '…' : description
}
// Candidate combinations use ONLY recorded item prices. They are explicitly
// suggestions: unit prices can exclude tax, promotions, shipping and fees.
export function itemCombinations(items: AmazonItem[], amount: number): string[][] {
  if (!items.length || items.length > 15) return []
  const candidates: string[][] = []
  const target = Math.abs(amount)
  for (let bits = 1; bits < 2 ** items.length && candidates.length < 6; bits++) {
    const selected = items.filter((_, i) => bits & (1 << i))
    if (selected.some(i => i.unit_price === null)) continue
    const sum = selected.reduce((n, i) => n + i.unit_price! * i.quantity, 0)
    if (sum === target) candidates.push(selected.map(i => i.id))
  }
  return candidates
}
export function orderURL(value: string, marketplace: string) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port && [marketplace, `www.${marketplace}`].includes(u.hostname) && ['amazon.ca', 'amazon.com'].includes(marketplace) ? u.href : '' } catch { return '' }
}
