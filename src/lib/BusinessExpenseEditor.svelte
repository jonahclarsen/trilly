<script lang="ts">
  import { untrack } from 'svelte'
  import Button from './Button.svelte'
  import AmazonOrderCard from './AmazonOrderCard.svelte'
  import { paymentHasOrder, type AmazonOrder, type AmazonStore } from './amazon'
  import type { BusinessExpense, Transaction } from './types'
  import type { BusinessExpenseInput } from './business'

  let { transaction, saved, description, note, orders, store, currency, disabled, onsave }: {
    transaction: Transaction; saved: BusinessExpense[]; description: string; note: string;
    orders: AmazonOrder[]; store: AmazonStore; currency?: string; disabled: boolean;
    onsave: (rows: BusinessExpenseInput[]) => void;
  } = $props()
  type Row = Omit<BusinessExpenseInput, 'amount'> & { amount: number | undefined; included: boolean; reason: string }
  let referenceOrders = $state<AmazonOrder[]>(untrack(() => orders))
  let orderChoice = $state('')
  const products = $derived(referenceOrders.flatMap(order => order.items.map(item => ({
    key: JSON.stringify([order.marketplace, order.id, item.id]), item, currency: order.currency,
  }))))
  function isRefunded(status: string) {
    return /^(?:refunded|refund (?:issued|complete|completed|processed))(?:\b|$)/i.test(status.trim())
  }
  function productRows(): Row[] {
    return products.map(({ key, item }) => {
      // Payment-level refunds cannot identify a refunded product in a multi-item order.
      const refunded = isRefunded(item.status)
      const excluded = transaction.amount > 0 || refunded
      return {
        expense_id: crypto.randomUUID(), product_key: key, description: item.title.toLowerCase(),
        amount: undefined, note: '', included: !excluded,
        reason: refunded ? 'Refund confirmed by product status; unchecked by default.'
          : transaction.amount > 0 ? 'Refund transaction; unchecked by default.' : '',
      }
    })
  }
  function initialRows(): Row[] {
    if (saved.length) {
      const restored = saved.map(e => ({
        expense_id: e.expense_id ?? '', product_key: e.product_key ?? '', description: e.description,
        amount: e.amount / 1000, note: e.note, included: true, reason: e.archived ? 'Archived expense' : '',
      }))
      const omitted = saved.every(e => e.product_key)
        ? productRows().filter(row => !saved.some(e => e.product_key === row.product_key)).map(row => ({ ...row, included: false }))
        : []
      return [...restored, ...omitted]
    }
    if (products.length > 1) return productRows()
    const refunded = isRefunded(products[0]?.item.status ?? '')
    return [{
      expense_id: crypto.randomUUID(), product_key: products[0]?.key ?? '', description, note,
      amount: -transaction.amount / 1000, included: transaction.amount <= 0 && !refunded,
      reason: transaction.amount > 0 ? 'Refund transaction; unchecked by default.'
        : refunded ? 'Refund confirmed by product status; unchecked by default.' : '',
    }]
  }
  let rows = $state<Row[]>(untrack(initialRows))
  const canUseProducts = $derived(products.length > 1 && (
    rows.some(row => !row.product_key) || products.some(product => !rows.some(row => row.product_key === product.key))
  ))
  const selected = $derived(rows.filter(row => row.included))
  const valid = $derived(selected.every(row => row.description.trim() && typeof row.amount === 'number' && Number.isSafeInteger(Math.round(row.amount * 1000))))
  const total = $derived(selected.reduce((sum, row) => sum + Math.round((row.amount ?? 0) * 1000), 0))
  function money(amount: number) {
    return new Intl.NumberFormat(undefined, currency ? { style: 'currency', currency } : { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(amount / 1000)
  }
  function useProducts() {
    const drafts = productRows()
    // Preserve existing product edits; replacing a combined row is an explicit action.
    rows = drafts.map(draft => rows.find(row => row.product_key === draft.product_key) ?? draft)
  }
  function addReference() {
    const order = store.orders.find(order => JSON.stringify([order.marketplace, order.id]) === orderChoice)
    if (order && !referenceOrders.some(o => o.marketplace === order.marketplace && o.id === order.id)) referenceOrders = [...referenceOrders, order]
    orderChoice = ''
  }
  function textKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault(); save()
    }
  }
  function save() {
    if (disabled || !valid || (!selected.length && !saved.length)) return
    onsave(selected.map(({ expense_id, product_key, description, amount, note }) => ({
      expense_id, product_key, description, amount: Math.round(amount! * 1000), note,
    })))
  }
</script>

<p class="field-note">Choose the expenses to keep and enter the final price for each. Taxes, fees, discounts and refunds are not allocated automatically. Unchecked rows are not saved.</p>
{#if products.length > 1}
  <p class="field-note">Amazon item prices are reference data only. Calculate each selected product's share yourself; prices start blank when splitting by product.</p>
  {#if canUseProducts}
    <Button {disabled} onclick={useProducts}>Use separate product expenses</Button>
    <p class="field-note">This replaces combined or manual draft rows with products. Changes apply when you save.</p>
  {/if}
{/if}
<form onsubmit={(event) => { event.preventDefault(); save() }}>
  <div class="expense-entries">
    {#each rows as row (row.expense_id)}
      {@const product = products.find(product => product.key === row.product_key)}
      <fieldset>
        <label class="include-expense"><input type="checkbox" aria-label={`Include ${row.description || 'expense'}`} bind:checked={row.included} {disabled} />Include expense</label>
        {#if row.reason}<p class="field-note">{row.reason}</p>{/if}
        {#if product}
          <p class="field-note">Amazon reference: quantity {product.item.quantity} · {product.item.price_text || (product.item.unit_price === null ? 'Price unavailable' : new Intl.NumberFormat(undefined, { style: 'currency', currency: product.currency }).format(product.item.unit_price / 1000))} each · {product.currency}{product.item.status ? ` · ${product.item.status}` : ''}</p>
        {/if}
        <label>Description<textarea onkeydown={textKeydown} data-modal-focus={row.included ? true : undefined} bind:value={row.description} required={row.included} disabled={!row.included || disabled} maxlength="10000" rows="2"></textarea></label>
        <label>Price<input type="number" step="0.001" bind:value={row.amount} required={row.included} disabled={!row.included || disabled} placeholder="Enter your calculated amount" /></label>
        <label>Note (optional)<textarea onkeydown={textKeydown} bind:value={row.note} disabled={!row.included || disabled} maxlength="10000" rows="2"></textarea></label>
      </fieldset>
    {/each}
  </div>
  <Button {disabled} onclick={() => rows = [...rows, { expense_id: crypto.randomUUID(), product_key: '', description: '', amount: undefined, note: '', included: true, reason: '' }]}>Add expense</Button>
  <p class="field-note">Expenses are positive; refunds are negative. A refund on an order does not identify which product was refunded. Check the recorded product status and payment details below.</p>
  <p><strong>Selected total: {valid ? money(total) : 'Enter all selected prices'}</strong><br /><span class="field-note">Transaction: {money(-transaction.amount)}. Your selection can cover only part of the transaction.</span></p>
  {#if !selected.length && saved.length}<p class="field-note">Saving with everything unchecked removes this transaction's saved expenses.</p>{/if}
  <Button type="submit" primary shortcut="Enter" disabled={disabled || !valid || (!selected.length && !saved.length)}>Save expenses</Button>
</form>
{#if referenceOrders.length}
  <h3>Amazon reference</h3>
  <p class="field-note">Original order currencies are shown below. Orders can cover several charges and refunds; these totals may differ from this transaction.</p>
  {#each referenceOrders as order (`${order.marketplace}:${order.id}`)}
    <p class="field-note">Order currency: {order.currency}{order.total === null ? ' · Total unavailable' : ` · Order total: ${new Intl.NumberFormat(undefined, { style: 'currency', currency: order.currency }).format(order.total / 1000)}`}</p>
    <AmazonOrderCard {order} payments={store.payments.filter(payment => paymentHasOrder(payment, order))} />
  {/each}
{:else if /amazon|amzn/i.test(transaction.payee_name ?? '')}
  <p class="field-note">No confirmed order details are available. Fetch Amazon details during review, or choose a collected order below. You can also add expense rows manually.</p>
{/if}
{#if store.orders.length}
  <details>
    <summary>Choose another reference order</summary>
    <label>Collected order<select bind:value={orderChoice}><option value="">Choose an order</option>{#each store.orders as order}<option value={JSON.stringify([order.marketplace, order.id])}>{order.marketplace} · {order.id} · {order.items.map(item => item.title).join('; ')}</option>{/each}</select></label>
    <Button disabled={disabled || !orderChoice} onclick={addReference}>Show order details</Button>
  </details>
{/if}

<style>
  .expense-entries { display: grid; gap: 16px; }
  fieldset { display: grid; gap: 12px; min-width: 0; margin: 0; padding: 14px; border: 1px solid var(--line); border-radius: 10px; }
  .include-expense { display: flex; align-items: center; gap: 8px; }
  .include-expense input { width: auto; margin: 0; }
  details { margin-top: 18px; }
</style>
