<script lang="ts">
  import googleLogo from '../assets/google/google.svg'
  import protonLogo from '../assets/proton/proton.svg'
  import { LOOKUP_PROVIDERS, type LookupProvider } from './lookup'
  let { value, onchange }: { value: LookupProvider; onchange: (value: LookupProvider) => void } = $props()
</script>

<section class="settings-section">
  <h3>Mail and Calendar links open in</h3>
  <div class="providers" role="group" aria-label="Mail and Calendar links">
    {#each LOOKUP_PROVIDERS as provider (provider.id)}
      <button class="provider" class:chosen={value === provider.id} aria-pressed={value === provider.id} title={`${provider.mail} and ${provider.calendar}`} onclick={() => onchange(provider.id)}>
        {#if provider.id === 'google'}
          <img src={googleLogo} width="60" height="60" alt="" aria-hidden="true" />
        {:else}
          <img src={protonLogo} width="60" height="60" alt="" aria-hidden="true" />
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
  .provider img { width: 60px; height: 60px; }
  .provider span { font-size: 19.5px; font-weight: 600; }
</style>
