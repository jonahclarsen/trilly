<script lang="ts">
  import { paymentHasOrder, orderURL, type AmazonPayment, type AmazonOrder } from './amazon'
  let { payment, orders }: { payment: AmazonPayment; orders: AmazonOrder[] } = $props()
  const paymentOrders = $derived(orders.filter(order => paymentHasOrder(payment, order)))
</script>

<section class="amazon-evidence" aria-label="Payment details from Amazon">
  <strong>Payment details from Amazon</strong>
  {#if paymentOrders.some(order => order.items.length)}
    <div class="payment-products" aria-label="Products from linked orders">
      {#each paymentOrders as order (`${order.marketplace}:${order.id}`)}
        {#each order.items as item (item.id)}
          <div class="payment-product">
            {#if /^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(item.image)}
              <img src={item.image} alt="" width="48" height="48" loading="lazy" />
            {:else}
              <span class="image-unavailable">No image</span>
            {/if}
            <div class="amazon-item-copy">
              {#if orderURL(item.product_url, order.marketplace)}
                <a class="amazon-product" href={orderURL(item.product_url, order.marketplace)} target="_blank" rel="noreferrer">{item.title}</a>
              {:else}
                <strong>{item.title}</strong>
              {/if}
            </div>
          </div>
        {/each}
      {/each}
    </div>
  {/if}
</section>

<style>
  .amazon-evidence { margin: 0; }
  .payment-products { display: grid; gap: 8px; margin-top: 8px; }
  .payment-product { display: flex; align-items: center; gap: 10px; }
  .payment-product img { width: 48px; height: 48px; object-fit: contain; flex-shrink: 0; }
  .image-unavailable { display: grid; place-items: center; flex: 0 0 48px; height: 48px; color: var(--muted); font-size: 10px; }
</style>
