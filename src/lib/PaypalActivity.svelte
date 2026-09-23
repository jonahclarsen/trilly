<script lang="ts">
  import Icon from './Icon.svelte'
  import { paypalActivityKey } from './shortcuts'

  let link = $state<HTMLAnchorElement>()
  export function open() { link?.click() }
</script>

<a bind:this={link} href="https://www.paypal.com/myaccount/activities/" target="_blank" rel="noopener noreferrer" aria-label="Open PayPal activity (opens in a new tab)" aria-keyshortcuts={paypalActivityKey} title={`Open PayPal activity (new tab) · ${paypalActivityKey}`}>
  <svg class="paypal-logo" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <path class="paypal-back" d="M7.016 19.198h-4.2a.562.562 0 0 1-.555-.65L5.093.584A.692.692 0 0 1 5.776 0h7.222c3.417 0 5.904 2.488 5.846 5.5-.006.25-.027.5-.066.747A6.794 6.794 0 0 1 12.071 12H8.743a.69.69 0 0 0-.682.583l-.325 2.056-.013.083-.692 4.39-.015.087z" />
    <path class="paypal-front" d="M19.79 6.142c-.01.087-.01.175-.023.261a7.76 7.76 0 0 1-7.695 6.598H9.007l-.283 1.795-.013.083-.692 4.39-.134.843-.014.088H6.86l-.497 3.15a.562.562 0 0 0 .555.65h3.94c.34 0 .63-.249.683-.585l.952-6.031a.692.692 0 0 1 .683-.584h2.126a6.793 6.793 0 0 0 6.707-5.752c.306-1.95-.466-3.744-1.765-4.906z" />
  </svg>
  <Icon name="external" />
  <kbd>{paypalActivityKey}</kbd>
</a>

<style>
  a { justify-content: center; gap: 8px; min-height: 36px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--muted); }
  a:hover { background: var(--paper-strong); border-color: var(--line-strong); text-decoration: none; }
  .paypal-logo { width: 20px; height: 20px; }
  .paypal-back { fill: #003087; }
  .paypal-front { fill: #0070e0; }
  :global(:root[data-color-scheme='dark']) .paypal-back { fill: #8fb4ff; }
  :global(:root[data-color-scheme='dark']) .paypal-front { fill: #3d9bff; }
</style>
