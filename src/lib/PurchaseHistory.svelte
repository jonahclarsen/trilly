<script lang="ts">
  import Icon from './Icon.svelte'
  import { purchaseHistoryLinks } from './purchase-history'
  import type { PurchaseHistoryRule } from './types'

  let { rules = [], payee }: { rules?: PurchaseHistoryRule[]; payee: string } = $props()
  const links = $derived(purchaseHistoryLinks(rules, payee))
</script>

{#if links.length}
  <div class="purchase-history">
    {#each links as link (link.id)}
      <a href={link.url} target="_blank" rel="noopener noreferrer">View {link.merchant} purchase history<Icon name="external" /></a>
    {/each}
  </div>
{/if}

<style>
  .purchase-history { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  a { border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; font-size: 12px; background: transparent; }
  a:hover { background: var(--paper-strong); border-color: var(--line-strong); text-decoration: none; }
</style>
