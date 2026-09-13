<script lang="ts">
  import { paymentOrderURL, marketplaceLabel, type AmazonPayment } from './amazon'
  let { payment }: { payment: AmazonPayment } = $props()
  function link(id: string) {
    return paymentOrderURL({ ...payment, order_ids: [id] })
  }
</script>

<section class="amazon-evidence" aria-label="Payment details from Amazon">
  <strong>Payment details from Amazon</strong>
  <dl>
    <div><dt>Date</dt><dd>{payment.date || 'Unavailable'}</dd></div>
    <div><dt>{payment.refund ? 'Refund' : 'Charge'}</dt><dd>{new Intl.NumberFormat(undefined, { style: 'currency', currency: payment.currency }).format(payment.amount / 1000)} {payment.currency}</dd></div>
    <div><dt>Payment method</dt><dd>{payment.payment_method || 'Unavailable'}</dd></div>
    <div><dt>Payment source</dt><dd>{marketplaceLabel(payment.marketplace)}</dd></div>
    {#each payment.order_ids as id}
      <div><dt>Order</dt><dd>{#if link(id)}<a href={link(id)} target="_blank" rel="noreferrer">{id}</a>{:else}{id}{/if}</dd></div>
    {/each}
  </dl>
</section>

<style>
  .amazon-evidence { margin-block: .75rem; }
  dl { display: grid; gap: .4rem; margin: .5rem 0 0; }
  dl > div { display: flex; flex-wrap: wrap; gap: .25rem .75rem; }
  dt { min-width: 8rem; }
  dd { margin: 0; overflow-wrap: anywhere; }
</style>
