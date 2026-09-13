<script lang="ts">
  import Icon from './Icon.svelte'
  import { amazonOrderKey } from './shortcuts'

  let { href }: { href: string } = $props()
  let link = $state<HTMLAnchorElement>()
  export function open() { link?.click() }
</script>

<a bind:this={link} {href} target="_blank" rel="noopener noreferrer" aria-label="Open Amazon order (opens in a new tab)" aria-keyshortcuts={amazonOrderKey} title={`Open Amazon order (new tab) · ${amazonOrderKey}`}>
  <svg class="amazon-logo" viewBox="0 0 92 132" aria-hidden="true">
    <path d="M55.3 59.8v-4.1c-13.5 0-27.7 2.9-27.7 18.8 0 8 4.1 13.5 11.3 13.5 5.3 0 10-3.2 12.9-8.5 3.7-6.4 3.5-12.5 3.5-19.7m18.8 45.4c-1.2 1.1-3 1.2-4.4.4-6.2-5.1-7.3-7.5-10.7-12.4-10.2 10.4-17.5 13.6-30.7 13.6C12.6 106.8.4 97.1.4 77.7c0-15.1 8.2-25.4 19.9-30.4 10.1-4.5 24.2-5.3 35-6.5v-2.4c0-4.4.4-9.7-2.3-13.5-2.2-3.4-6.6-4.9-10.4-4.9-7.1 0-13.5 3.7-15 11.2-.3 1.7-1.6 3.3-3.2 3.4L6.3 32.7c-1.6-.4-3.2-1.6-2.8-3.9C7.7 6.9 27.4.2 45.2.2c9.1 0 20.9 2.5 28 9.3 9.1 8.5 8.3 19.8 8.3 32.1v29c0 8.8 3.6 12.6 7 17.3 1.2 1.7 1.5 3.7 0 5-3.8 3.1-10.6 9-14.3 12.3z" />
    <path class="smile" d="M13 113c18 13 43 17 68 5" />
    <path class="arrow" d="M72 114c7-1 12 0 16 3-1 6-4 11-9 15 2-6 3-10 1-12-1-2-4-3-8-6" />
  </svg>
  <Icon name="external" />
  <kbd>{amazonOrderKey}</kbd>
</a>

<style>
  a { justify-content: center; gap: 8px; min-height: 36px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--muted); }
  a:hover { background: var(--paper-strong); border-color: var(--line-strong); text-decoration: none; }
  .amazon-logo { width: 18px; height: 22px; fill: currentColor; }
  .smile { fill: none; stroke: #f90; stroke-width: 5; stroke-linecap: round; }
  .arrow { fill: #f90; }
</style>
