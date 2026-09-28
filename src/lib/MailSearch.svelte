<script lang="ts">
  import protonLogo from '../assets/proton/mail.svg'
  import LookupLink from './LookupLink.svelte'
  import { mailSearchKey } from './shortcuts'
  import { mailSearchUrl, LOOKUP_PROVIDERS, type LookupProvider } from './lookup'

  let { provider, payee }: { provider: LookupProvider; payee: string } = $props()
  const name = $derived(LOOKUP_PROVIDERS.find(p => p.id === provider)?.mail ?? 'mail')
  let link = $state<{ open: () => void }>()
  export function open() { link?.open() }
</script>

{#if payee.trim()}
  <LookupLink bind:this={link} href={mailSearchUrl(provider, payee)} label={`Search ${name} for ${payee}`} shortcut={mailSearchKey}>
    {#if provider === 'proton'}
      <img class="logo" src={protonLogo} width="20" height="20" alt="" aria-hidden="true" />
    {:else}
      <svg class="logo" width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#4285F4" d="M7 40h7V23L4 15.5V37a3 3 0 0 0 3 3Z" />
        <path fill="#34A853" d="M34 40h7a3 3 0 0 0 3-3V15.5L34 23Z" />
        <path fill="#FBBC04" d="M34 10v13l10-7.5v-4c0-3.7-4.2-5.8-7.2-3.6Z" />
        <path fill="#EA4335" d="M14 23V10l10 7.5L34 10v13l-10 7.5Z" />
        <path fill="#C5221F" d="M4 11.5v4L14 23V10l-2.8-2.1C8.2 5.7 4 7.8 4 11.5Z" />
      </svg>
    {/if}
  </LookupLink>
{/if}

<style>
  .logo { width: 20px; height: 20px; }
</style>
