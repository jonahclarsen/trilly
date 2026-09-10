<script lang="ts">
  import Icon from './Icon.svelte'
  import { orderURL, type AmazonOrder, type AmazonPayment } from './amazon'
  let { order, payments, selected = [], onchange, disabled = false }: { order: AmazonOrder; payments: AmazonPayment[]; selected?: string[]; onchange?: (ids: string[]) => void; disabled?: boolean } = $props()
  function money(value: number, currency: string) { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value / 1000) }
  function toggle(id: string) { onchange?.(selected.includes(id) ? selected.filter(i => i !== id) : [...selected, id]) }
</script>

<article class="amazon-order" aria-label={`Amazon order ${order.id}`}>
  <div class="amazon-order-heading">
    <div><strong>{order.marketplace}</strong><span>Order placed {order.date || 'date unavailable'}</span><small>Order {order.id}</small></div>
    <a href={orderURL(order.url, order.marketplace)} target="_blank" rel="noreferrer">Open order<Icon name="external" /></a>
  </div>
  {#if order.payment_method}<p class="amazon-method">{order.payment_method}</p>{/if}
  <div class="amazon-items">
    {#each order.items as item (item.id)}
      <div class="amazon-item">
        {#if onchange}<input type="checkbox" aria-label={`Include ${item.title.toLowerCase()} in description`} checked={selected.includes(item.id)} {disabled} onchange={() => toggle(item.id)} />{/if}
        {#if /^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(item.image)}<img src={item.image} alt="" width="80" height="80" loading="lazy" />{/if}
        <div class="amazon-item-copy">
          {#if orderURL(item.product_url, order.marketplace)}<a class="amazon-product" href={orderURL(item.product_url, order.marketplace)} target="_blank" rel="noreferrer">{item.title.toLowerCase()}</a>{:else}<strong>{item.title.toLowerCase()}</strong>{/if}
          <span>Quantity {item.quantity}{item.price_text ? ` · ${item.price_text} each` : ''}</span>
          {#if item.seller}<small>{item.seller}</small>{/if}
          {#if item.status}<span class="amazon-shipment">{item.status}</span>{/if}
          {#if item.details}<small>{item.details}</small>{/if}
        </div>
      </div>
    {/each}
  </div>
  {#if order.totals.length}<dl class="amazon-totals">{#each order.totals as total}<div><dt>{total.label}</dt><dd>{total.value}</dd></div>{/each}</dl>{/if}
  {#if payments.length}
    <div class="amazon-payments"><strong>Payments and refunds found for this order</strong>
      {#each payments as payment}<div><span>{payment.refund ? 'Refund' : 'Charge'} · {payment.date || 'Date unavailable'}<small>{payment.payment_method}</small></span><span>{money(payment.amount, payment.currency)} {payment.currency}</span></div>{/each}
    </div>
  {/if}
  <small class="amazon-fetched">Collected {new Date(order.fetched_at).toLocaleString()}. Order totals and item quantities may cover several payments.</small>
</article>
