import type { Transaction, Option } from './types'

export type Marketplace = 'amazon.ca' | 'amazon.com'
export function marketplaceLabel(marketplace: Marketplace) { return marketplace.replace(/^amazon/, 'Amazon') }
export type AmazonPayment = { id: string; marketplace: Marketplace; date: string; amount: number; currency: string; refund: boolean; payment_method: string; order_ids: string[]; order_marketplaces?: Record<string, Marketplace>; evidence: string }
export type AmazonItem = { id: string; title: string; quantity: number; unit_price: number | null; price_text: string; product_url: string; image: string; seller: string; status: string; details: string }
export type AmazonOrder = { id: string; marketplace: Marketplace; url: string; date: string; currency: string; total: number | null; payment_method: string; items: AmazonItem[]; totals: { label: string; value: string }[]; fetched_at: string }
export type AmazonStore = { payments: AmazonPayment[]; orders: AmazonOrder[] }
// A payment in another currency matched by converting at that day's Bank of
// Canada rate. `markup` is how far the bank charge is above that conversion.
export type Conversion = { rate: number; date: string; converted: number; markup: number }
export type AmazonCandidate = { payment: AmazonPayment; orders: AmazonOrder[]; confident: boolean; guess?: boolean; conversion?: Conversion; reason: string }
export type Rates = Record<string, number>
export type AmazonStatus = { running: boolean; pages: number; orders: number; queued: number; active: number; message: string; paused: { tab: number; marketplace: string; reason: string }[] }
export const emptyAmazon = (): AmazonStore => ({ payments: [], orders: [] })
export function amazonLinkSummary(targets: Transaction[], assignments: { transaction_id: string }[]) {
  const targetIds = new Set(targets.map(target => target.id))
  const linked = new Set(assignments.filter(assignment => targetIds.has(assignment.transaction_id)).map(assignment => assignment.transaction_id)).size
  if (!linked) return `${targets.length} ${targets.length === 1 ? 'transaction' : 'transactions'} to link`
  return `${linked} ${linked === 1 ? 'transaction' : 'transactions'} linked, ${targets.length - linked} unlinked`
}
const transactionPayeeNames = (t: Transaction) => [t.import_payee_name_original, t.import_payee_name, t.payee_name].filter(Boolean).join(' ').toLowerCase()
export function isAmazon(t: Transaction) {
  if (t.transfer_account_id || t.debt_transaction_type) return false
  const names = transactionPayeeNames(t)
  return !/amazon mbna card/.test(names) && /\b(?:amazon|amzn)|\bmktp\s*(?:ca|us)\b|kindle\s+svcs/.test(names)
}
export function automaticAmazonMarketplace(t: Transaction): Marketplace | null {
  if (!isAmazon(t)) return null
  return /kindle\s+svcs/.test(transactionPayeeNames(t)) ? 'amazon.ca' : null
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
export function paymentHasOrder(payment: AmazonPayment, order: AmazonOrder) {
  return payment.order_ids.includes(order.id) && (payment.order_marketplaces?.[order.id] ?? payment.marketplace) === order.marketplace
}
export function amazonPayee(payees: Option[], marketplace: string | null) {
  return payees.find(p => p.name.toLowerCase() === marketplace)
}
export function paymentMarketplace(payment: AmazonPayment): Marketplace | null {
  const markets = new Set(payment.order_ids.map(id => payment.order_marketplaces?.[id] ?? payment.marketplace))
  return markets.size === 1 ? [...markets][0]! : markets.size === 0 ? payment.marketplace : null
}
const shift = (date: string, days: number) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10)
// The latest published USD→CAD rate on or before the date, within a week.
export function rateOn(rates: Rates, from: string, to: string | undefined, date: string) {
  const inverse = from === 'CAD' && to === 'USD'
  if (!date || !(inverse || (from === 'USD' && to === 'CAD'))) return null
  for (let back = 0; back <= 7; back++) {
    const day = shift(date, -back), rate = rates[day]
    if (rate) return { rate: inverse ? 1 / rate : rate, date: day }
  }
  return null
}
// Cards convert near the published rate, often with a 2.5% foreign-currency fee.
const FEES = [0, 0.025]
function convert(payment: AmazonPayment, t: Transaction, currency: string | undefined, rates: Rates) {
  if (payment.currency === currency || payment.refund !== (t.amount > 0) || !payment.date || distance(payment.date, t.date) > 14) return null
  const found = rateOn(rates, payment.currency, currency, payment.date)
  if (!found) return null
  const converted = Math.round(payment.amount * found.rate / 10) * 10
  if (!converted) return null
  const markup = t.amount / converted - 1
  if (markup < -0.02 || markup > 0.05) return null
  return { conversion: { rate: found.rate, date: found.date, converted, markup }, gap: Math.min(...FEES.map(fee => Math.abs(markup - fee))) }
}
export function amazonCandidates(store: AmazonStore, t: Transaction, currency: string | undefined, targets: Transaction[], assignments: { payment_id: string; transaction_id: string }[] = [], rates: Rates = {}): AmazonCandidate[] {
  if (!isAmazon(t)) return []
  const free = store.payments.filter(p => !assignments.some(a => a.payment_id === p.id && a.transaction_id !== t.id))
  const eligible = free.filter(p => p.amount === t.amount && (p.refund === (t.amount > 0)) && (!p.date || distance(p.date, t.date) <= 14))
  const exact = eligible.filter(p => p.currency === currency && distance(p.date, t.date) <= 7)
  const matched = eligible.map(payment => {
    const competing = targets.filter(other => isAmazon(other) && other.amount === payment.amount && distance(other.date, payment.date) <= 7)
    const confident = exact.length === 1 && exact[0]?.id === payment.id && competing.length === 1 && competing[0]?.id === t.id
    const reason = payment.currency !== currency ? 'Currency differs or is unavailable — confirm manually'
      : !payment.date ? 'Payment date unavailable — confirm manually'
      : confident ? 'Unique amount and currency match within 7 days'
      : competing.length > 1 ? 'Several bank transactions could match this payment'
      : 'Check the payment date and competing matches'
    return { payment, confident, reason, orders: store.orders.filter(o => paymentHasOrder(payment, o)) }
  }).sort((a, b) => Number(b.confident) - Number(a.confident) || distance(a.payment.date, t.date) - distance(b.payment.date, t.date))
  // Foreign-currency payments never match exactly. Suggest the closest
  // conversions, and guess one only when it clearly stands out.
  const converted = free.filter(p => p.amount !== t.amount).flatMap(payment => { const c = convert(payment, t, currency, rates); return c ? [{ payment, ...c }] : [] })
    .sort((a, b) => a.gap - b.gap || distance(a.payment.date, t.date) - distance(b.payment.date, t.date)).slice(0, 5)
  const best = converted[0]
  const guess = !!best && !eligible.length && best.gap <= 0.005 && distance(best.payment.date, t.date) <= 7 && !(converted[1] && converted[1].gap < best.gap + 0.01) &&
    !targets.some(other => other.id !== t.id && isAmazon(other) && distance(other.date, best.payment.date) <= 7 && (convert(best.payment, other, currency, rates)?.gap ?? Infinity) < best.gap + 0.01)
  return [...matched, ...converted.map(({ payment, conversion }, i) => ({ payment, conversion, confident: false, guess: guess && i === 0,
    reason: guess && i === 0 ? 'Guessed from the exchange rate — check the order' : 'Similar after currency conversion — confirm manually',
    orders: store.orders.filter(o => paymentHasOrder(payment, o)) }))]
}
// The band of bank-to-Amazon amount ratios worth collecting for each foreign currency.
export function conversionBands(rates: Rates, currency: string | undefined): Record<string, [number, number]> {
  const values = Object.values(rates)
  const from = currency === 'CAD' ? 'USD' : currency === 'USD' ? 'CAD' : ''
  if (!from) return {}
  const [low, high] = values.length ? [Math.min(...values), Math.max(...values)] : [1.2, 1.6]
  const [min, max] = from === 'USD' ? [low, high] : [1 / high, 1 / low]
  return { [from]: [min * 0.98, max * 1.05] }
}
export function automaticItems(candidate: AmazonCandidate): AmazonItem[] {
  if (!(candidate.confident || candidate.guess) || candidate.orders.length !== candidate.payment.order_ids.length || candidate.orders.length !== 1) return []
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
export function paymentOrderURL(payment: AmazonPayment) {
  for (const id of payment.order_ids) {
    if (!/^\d{3}-\d{7}-\d{7}$/.test(id)) continue
    const marketplace = payment.order_marketplaces?.[id] ?? payment.marketplace
    const link = orderURL(`https://www.${marketplace}/gp/your-account/order-details?orderID=${id}`, marketplace)
    if (link) return link
  }
  return ''
}
