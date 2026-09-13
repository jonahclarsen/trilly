<script lang="ts">
  import Icon from './Icon.svelte'
  import { googlePayeeKey } from './shortcuts'

  let { payee }: { payee: string } = $props()
  const query = $derived(payee.trim())
  let link = $state<HTMLAnchorElement>()
  export function open() { link?.click() }
</script>

{#if query}
  <a bind:this={link} href={`https://www.google.com/search?q=${encodeURIComponent(query)}`} target="_blank" rel="noopener noreferrer" aria-label={`Search Google for ${query} (opens in a new tab)`} aria-keyshortcuts={googlePayeeKey} title={`Search payee on Google (new tab) · ${googlePayeeKey}`}>
    <svg class="google-logo" width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M43.61 24.46c0-1.36-.12-2.66-.35-3.92H24v7.42h11a9.4 9.4 0 0 1-4.08 6.18v5.14h6.61c3.87-3.57 6.08-8.83 6.08-14.82Z" />
      <path fill="#34A853" d="M24 44c5.51 0 10.13-1.83 13.51-4.96l-6.61-5.14c-1.83 1.23-4.17 1.97-6.9 1.97-5.32 0-9.84-3.59-11.46-8.43H5.72v5.3A20 20 0 0 0 24 44Z" />
      <path fill="#FBBC05" d="M12.54 27.44a12 12 0 0 1 0-6.88v-5.3H5.72a20 20 0 0 0 0 17.48l6.82-5.3Z" />
      <path fill="#EA4335" d="M24 12.13c3.01 0 5.69 1.04 7.82 3.09l5.86-5.86C34.12 6.04 29.51 4 24 4A20 20 0 0 0 5.72 15.26l6.82 5.3c1.62-4.84 6.14-8.43 11.46-8.43Z" />
    </svg>
    <Icon name="external" />
    <kbd>{googlePayeeKey}</kbd>
  </a>
{/if}

<style>
  a { justify-content: center; gap: 8px; min-height: 36px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--muted); }
  a:hover { background: var(--paper-strong); border-color: var(--line-strong); text-decoration: none; }
  .google-logo { width: 20px; height: 20px; }
</style>
