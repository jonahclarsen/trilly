<script lang="ts">
  import { untrack } from 'svelte'
  import Button from './Button.svelte'
  import AmazonOrderCard from './AmazonOrderCard.svelte'
  import { amazonCandidates, automaticItems, amazonDescription, itemCombinations, type AmazonStore } from './amazon'
  import type { Transaction } from './types'
  let { store, transaction, currency, targets, disabled, collecting = false, assignments = [], onchange }: { store: AmazonStore; transaction: Transaction; currency?: string; targets: Transaction[]; disabled: boolean; collecting?: boolean; assignments?: { payment_id: string; transaction_id: string }[]; onchange: (memo: string, marketplace: string | null, automatic: boolean, paymentId?: string) => void } = $props()
  const candidates = $derived(amazonCandidates(store, transaction, currency, targets, assignments))
  let choice = $state('')
  let selected = $state<string[]>([])
  let touched = $state(false)
  let search = $state('')
  let manualOrder = $state('')
  const candidate = $derived(candidates.find(c => c.payment.id === choice) ?? (!touched ? candidates.find(c => c.confident) : undefined))
  const orders = $derived(manualOrder ? store.orders.filter(o => `${o.marketplace}:${o.id}` === manualOrder) : candidate?.orders ?? [])
  const items = $derived(orders.flatMap(o => o.items))
  const combinations = $derived(itemCombinations(items, transaction.amount))
  const automatic = $derived(!touched && !collecting && candidate ? automaticItems(candidate) : [])
  const selectedIds = $derived(touched ? selected : automatic.map(i => i.id))
  const fallback = $derived(search.trim() ? store.orders.filter(o => `${o.id} ${o.items.map(i => i.title).join(' ')}`.toLowerCase().includes(search.toLowerCase())).slice(0, 20) : [])
  $effect(() => {
    const found = automatic
    const market = candidate?.payment.marketplace
    if (!touched) untrack(() => onchange(amazonDescription(found, transaction.amount > 0), candidate?.confident && !collecting ? market ?? null : null, true, candidate?.confident && !collecting ? candidate.payment.id : undefined))
  })
  function choose(id: string) { touched = true; choice = id; selected = []; manualOrder = ''; onchange('', candidates.find(c => c.payment.id === id)?.payment.marketplace ?? null, false, id) }
  function select(ids: string[]) {
    touched = true; selected = ids
    onchange(amazonDescription(items.filter(i => ids.includes(i.id)), transaction.amount > 0), orders[0]?.marketplace ?? null, false, candidate?.payment.id)
  }
</script>

<section class="amazon-review" aria-label="Amazon details">
  <h2>Amazon details</h2>
  {#if !candidates.length}<p class="field-note">No payment match yet. Fetch details, or search collected orders below. Different currencies and partial payments need manual review.</p>{/if}
  {#each candidates as c}
    <button class="amazon-candidate" class:selected={candidate?.payment.id === c.payment.id} {disabled} onclick={() => choose(c.payment.id)}>
      <strong>{c.payment.marketplace} · {c.payment.refund ? 'Refund' : 'Charge'} · {c.payment.date || 'Date unavailable'}</strong>
      <span>{new Intl.NumberFormat(undefined, { style: 'currency', currency: c.payment.currency }).format(c.payment.amount / 1000)} {c.payment.currency} · {c.payment.payment_method}</span>
      <small>{c.reason}</small>
    </button>
  {/each}
  {#if candidate}
    <details class="amazon-evidence"><summary>Payment details from Amazon</summary><p>{candidate.payment.evidence}</p></details>
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
    <AmazonOrderCard {order} payments={store.payments.filter(p => p.marketplace === order.marketplace && p.order_ids.includes(order.id))} selected={selectedIds} {disabled} onchange={select} />
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
    {#each fallback as order}<Button {disabled} onclick={() => { touched = true; choice = ''; selected = []; manualOrder = `${order.marketplace}:${order.id}`; onchange('', order.marketplace, false) }}>{order.marketplace} · {order.date} · {order.items.map(i => i.title.toLowerCase()).join('; ')}</Button>{/each}
  </details>
</section>
