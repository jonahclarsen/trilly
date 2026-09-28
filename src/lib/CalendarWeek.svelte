<script lang="ts">
  import LookupLink from './LookupLink.svelte'
  import { calendarWeekKey } from './shortcuts'
  import { calendarWeekUrl, LOOKUP_PROVIDERS, type LookupProvider } from './lookup'

  let { provider, date }: { provider: LookupProvider; date: string } = $props()
  const name = $derived(LOOKUP_PROVIDERS.find(p => p.id === provider)?.calendar ?? 'calendar')
  let link = $state<{ open: () => void }>()
  export function open() { link?.open() }
</script>

<LookupLink bind:this={link} href={calendarWeekUrl(provider, date)} label={`Open ${name} on ${date}`} shortcut={calendarWeekKey}>
  {#if provider === 'proton'}
    <svg class="logo" width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#6D4AFF" d="M5 17h38v19a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5Z" />
      <path fill="#B7A6FF" d="M10 9h28a5 5 0 0 1 5 5v5H5v-5a5 5 0 0 1 5-5Z" />
      <rect fill="#6D4AFF" x="14" y="5" width="4" height="9" rx="2" />
      <rect fill="#6D4AFF" x="30" y="5" width="4" height="9" rx="2" />
      <g fill="#fff"><circle cx="15" cy="26" r="2.4" /><circle cx="24" cy="26" r="2.4" /><circle cx="33" cy="26" r="2.4" /><circle cx="15" cy="34" r="2.4" /><circle cx="24" cy="34" r="2.4" /></g>
    </svg>
  {:else}
    <svg class="logo" width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#fff" d="M12 12h24v24H12Z" />
      <path fill="#4285F4" d="M10 4h26v8H12v24H4V10a6 6 0 0 1 6-6Z" />
      <path fill="#FBBC04" d="M36 12h8v22h-8Z" />
      <path fill="#34A853" d="M12 36h22v8H10a6 6 0 0 1-6-6v-2Z" />
      <path fill="#1967D2" d="M36 4h2a6 6 0 0 1 6 6v2h-8Z" />
      <path fill="#EA4335" d="M34 44V34h10Z" />
      <path fill="#188038" d="M4 36h8v8H10a6 6 0 0 1-6-6Z" />
      <text x="24" y="31" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#4285F4">31</text>
    </svg>
  {/if}
</LookupLink>

<style>
  .logo { width: 20px; height: 20px; }
</style>
