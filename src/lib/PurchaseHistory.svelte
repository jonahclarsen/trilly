<script lang="ts">
  import { merchantLinkKey } from './shortcuts'
  import LookupLink from './LookupLink.svelte'
  import { purchaseHistoryLinks, purchaseHistoryUrl } from './purchase-history'
  import type { PurchaseHistoryRule } from './types'

  // Matches on the displayed payee; %s in a URL uses the search payee.
  let { rules = [], payee, query }: { rules?: PurchaseHistoryRule[]; payee: string; query: string } = $props()
  const links = $derived(purchaseHistoryLinks(rules, payee))
</script>

{#each links as link, index (link.id)}
  <LookupLink href={purchaseHistoryUrl(link, query)} label={`Open ${link.merchant}`} text={link.merchant} shortcut={index === 0 ? merchantLinkKey : undefined}>
    {#if link.icon}<img class="favicon" src={link.icon} alt="" width="20" height="20" />{/if}
  </LookupLink>
{/each}

<style>
  .favicon { width: 20px; height: 20px; object-fit: contain; }
</style>
