<script lang="ts">
  import { LOOKUP_PROVIDERS, type LookupProvider } from './lookup'
  let { value, onchange }: { value: LookupProvider; onchange: (value: LookupProvider) => void } = $props()
</script>

<section class="settings-section">
  <h3>Mail and Calendar links open in</h3>
  <div class="providers" role="group" aria-label="Mail and Calendar links">
    {#each LOOKUP_PROVIDERS as provider (provider.id)}
      <button class="provider" class:chosen={value === provider.id} aria-pressed={value === provider.id} title={`${provider.mail} and ${provider.calendar}`} onclick={() => onchange(provider.id)}>
        {#if provider.id === 'google'}
          <svg width="60" height="60" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#4285F4" d="M43.61 24.46c0-1.36-.12-2.66-.35-3.92H24v7.42h11a9.4 9.4 0 0 1-4.08 6.18v5.14h6.61c3.87-3.57 6.08-8.83 6.08-14.82Z" />
            <path fill="#34A853" d="M24 44c5.51 0 10.13-1.83 13.51-4.96l-6.61-5.14c-1.83 1.23-4.17 1.97-6.9 1.97-5.32 0-9.84-3.59-11.46-8.43H5.72v5.3A20 20 0 0 0 24 44Z" />
            <path fill="#FBBC05" d="M12.54 27.44a12 12 0 0 1 0-6.88v-5.3H5.72a20 20 0 0 0 0 17.48l6.82-5.3Z" />
            <path fill="#EA4335" d="M24 12.13c3.01 0 5.69 1.04 7.82 3.09l5.86-5.86C34.12 6.04 29.51 4 24 4A20 20 0 0 0 5.72 15.26l6.82 5.3c1.62-4.84 6.14-8.43 11.46-8.43Z" />
          </svg>
        {:else}
          <svg width="60" height="60" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#A995FF" d="M10 16A12 12 0 0 1 22 4h8a12 12 0 0 1 0 24H18v-8h12a4 4 0 0 0 0-8h-8a4 4 0 0 0-4 4Z" />
            <path fill="#6D4AFF" d="M10 16h8v24a4 4 0 0 1-4 4h-4Z" />
          </svg>
        {/if}
        <span>{provider.name}</span>
      </button>
    {/each}
  </div>
</section>

<style>
  .providers { display: flex; justify-content: center; gap: 15px; }
  .provider { display: grid; justify-items: center; gap: 12px; min-width: 173px; padding: 21px 27px 16px; border: 1px solid var(--line); border-radius: 16px; background: transparent; color: var(--ink); }
  .provider:hover { border-color: var(--line-strong); }
  .provider.chosen { border-color: var(--theme-checkbox); box-shadow: 0 0 0 1px var(--theme-checkbox); }
  .provider svg { width: 60px; height: 60px; }
  .provider span { font-size: 19.5px; font-weight: 600; }
</style>
