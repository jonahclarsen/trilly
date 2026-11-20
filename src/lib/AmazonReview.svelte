<script lang="ts">
  import { untrack } from 'svelte'
  import Button from './Button.svelte'
  import AmazonOrderCard from './AmazonOrderCard.svelte'
  import { amazonCandidates, paymentHasOrder, paymentMarketplace, paymentOrderURL, marketplaceLabel, automaticItems, amazonDescription, orderRefunded, orderLink, linksOrder, itemCombinations, type AmazonStore, type AmazonOrder, type AmazonCandidate, type Rates } from './amazon'
  import type { Transaction } from './types'
  let { store, transaction, currency, targets, rates = {}, disabled, collecting = false, assignments = [], onchange, onorderlink, onorders }: { store: AmazonStore; transaction: Transaction; currency?: string; targets: Transaction[]; rates?: Rates; disabled: boolean; collecting?: boolean; assignments?: { payment_id: string; transaction_id: string }[]; onchange: (memo: string, marketplace: string | null, automatic: boolean, paymentId?: string) => void; onorderlink?: (link: string) => void; onorders?: (orders: AmazonOrder[]) => void } = $props()
  const candidates = $derived(amazonCandidates(store, transaction, currency, targets, assignments, rates))
  // A reopened review starts from the payment it was matched to.
  let choice = $state(untrack(() => assignments.find(a => a.transaction_id === transaction.id)?.payment_id ?? ''))
  let selected = $state<string[]>([])
  let touched = $state(false)
  let search = $state('')
  let manualOrder = $state('')
  const candidate = $derived(candidates.find(c => c.payment.id === choice) ?? (!touched ? candidates.find(c => c.confident) ?? candidates.find(c => c.guess) : undefined))
  const paymentDetails = $derived(candidate ?? (candidates.length === 1 ? candidates[0] : undefined))
  const orders = $derived(manualOrder ? store.orders.filter(o => `${o.marketplace}:${o.id}` === manualOrder) : candidate?.orders ?? [])
  const items = $derived(orders.flatMap(o => o.items))
  const combinations = $derived(itemCombinations(items, transaction.amount))
  const automatic = $derived(!touched && !collecting && candidate ? automaticItems(candidate) : [])
  const selectedIds = $derived(touched ? selected : automatic.map(i => i.id))
  const fallback = $derived(search.trim() ? store.orders.filter(o => `${o.id} ${o.items.map(i => i.title).join(' ')}`.toLowerCase().includes(search.toLowerCase())).slice(0, 20) : [])
  $effect(() => { onorders?.(orders) })
  // The payment's order, else the first shown order; the A shortcut opens it.
  const link = $derived((paymentDetails ? paymentOrderURL(paymentDetails.payment) : '') || orders.map(orderLink).find(Boolean) || '')
  $effect(() => { onorderlink?.(link) })
  const describe = (found: typeof items) => amazonDescription(found, transaction.amount > 0, transaction.amount < 0 && orderRefunded(store, candidate?.payment))
  $effect(() => {
    const found = automatic
    const market = candidate ? paymentMarketplace(candidate.payment) : null
    const chosen = (candidate?.confident || candidate?.guess) && !collecting
    if (!touched) untrack(() => onchange(describe(found), chosen ? market ?? null : null, true, chosen ? candidate!.payment.id : undefined))
  })
  function choose(id: string) {
    touched = true; choice = id; selected = []; manualOrder = ''
    const payment = candidates.find(c => c.payment.id === id)?.payment
    onchange('', payment ? paymentMarketplace(payment) : null, false, id)
  }
  const money = (amount: number, code: string | undefined) => new Intl.NumberFormat(undefined, code ? { style: 'currency', currency: code } : { minimumFractionDigits: 2 }).format(amount / 1000)
  const percent = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value * 100).toFixed(1)}%`
  const conversion = (c: AmazonCandidate) => c.conversion ? `≈ ${money(c.conversion.converted, currency)} · ${percent(c.conversion.markup)}` : ''
  function select(ids: string[]) {
    touched = true; selected = ids
    onchange(describe(items.filter(i => ids.includes(i.id))), orders[0]?.marketplace ?? null, false, candidate?.payment.id)
  }
</script>

<section class="amazon-review" aria-label="Amazon details">
  {#if !candidates.length}<p class="field-note">No payment match yet. Fetch details, or search collected orders below. Partial payments need manual review.</p>{/if}
  {#if candidates.length > 1}
    {#each candidates as c}
      <button class="amazon-candidate" class:selected={candidate?.payment.id === c.payment.id} {disabled} onclick={() => choose(c.payment.id)}>
        <strong>{marketplaceLabel(c.payment.marketplace)} · {c.payment.refund ? 'Refund' : 'Charge'} · {c.payment.date || 'Date unavailable'}</strong>
        <span>{money(c.payment.amount, c.payment.currency)} {c.payment.currency}{c.conversion ? ` ${conversion(c)}` : ''} · {c.payment.payment_method}</span>
        <small>{c.reason}</small>
      </button>
    {/each}
  {/if}
  {#if paymentDetails && !candidate}
    <p class="field-note">{paymentDetails.reason}{paymentDetails.conversion ? ` · ${money(paymentDetails.payment.amount, paymentDetails.payment.currency)} ${conversion(paymentDetails)}` : ''}</p>
    <Button {disabled} onclick={() => choose(paymentDetails!.payment.id)}>Use this payment</Button>
  {/if}
  {#if candidate?.conversion}
    {@const guessed = candidate.guess && !touched && !choice}
    <p class="amazon-conversion" class:guess={guessed}><strong>{guessed ? 'Guess' : 'Converted'}</strong> {money(Math.abs(candidate.payment.amount), candidate.payment.currency)} × {candidate.conversion.rate.toFixed(4)} ({candidate.conversion.date}) = {money(Math.abs(candidate.conversion.converted), currency)} · charge {percent(candidate.conversion.markup)}{guessed ? '. Check the order.' : ''}</p>
  {/if}
  {#if candidate}
    {#if candidate.orders.length < candidate.payment.order_ids.length}<p class="field-note">Order details are still missing. Collection can continue while you review other transactions.</p>{/if}
  {/if}
  {#if items.length > 1}
    <p class="field-note">Select the products for this {transaction.amount > 0 ? 'refund' : 'charge'}. Item prices may exclude taxes, discounts and fees.</p>
    {#if combinations.length && !automatic.length}
      <div class="amazon-combinations"><small>These item-price combinations equal the payment. Confirm the allocation; equal amounts alone are not proof.</small>
        {#each combinations as ids}<Button {disabled} onclick={() => select(ids)}>{items.filter(i => ids.includes(i.id)).map(i => i.title.toLowerCase()).join(' + ')}</Button>{/each}
      </div>
    {/if}
  {/if}
  {#each orders as order (`${order.marketplace}:${order.id}`)}
    <AmazonOrderCard {order} shortcut={linksOrder(link, order)} payments={store.payments.filter(p => paymentHasOrder(p, order))} selected={selectedIds} {disabled} onchange={select} />
  {/each}
  {#if selectedIds.length > 1}
    <div class="amazon-allocation"><strong>For a category split</strong>
      {#each items.filter(i => selectedIds.includes(i.id)) as item}<div><span>{item.title.toLowerCase()}</span><span>{item.unit_price === null ? 'Price unavailable' : new Intl.NumberFormat(undefined, { style: 'currency', currency: orders[0]?.currency || 'CAD' }).format(item.unit_price * item.quantity / 1000)}</span></div>{/each}
      <p class="field-note">These are item subtotals, not allocated payment amounts. Confirm taxes, discounts and fees, then create the split in YNAB.</p>
      <a href="https://app.ynab.com/" target="_blank" rel="noreferrer">Edit split in YNAB</a>
    </div>
  {/if}
  <details class="amazon-search"><summary>Find another order</summary>
    <label>Order number or product<input type="search" bind:value={search} placeholder="Search collected orders" /></label>
    {#each fallback as order}<Button {disabled} onclick={() => { touched = true; choice = ''; selected = []; manualOrder = `${order.marketplace}:${order.id}`; onchange('', order.marketplace, false) }}>{marketplaceLabel(order.marketplace)} · {order.date} · {order.items.map(i => i.title.toLowerCase()).join('; ')}</Button>{/each}
  </details>
</section>
