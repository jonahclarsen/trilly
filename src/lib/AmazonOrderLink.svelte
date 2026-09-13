<script lang="ts">
  import Icon from './Icon.svelte'
  import amazonLogo from '../assets/amazon-logo.webp'
  import amazonLogoDark from '../assets/amazon-logo-dark.webp'
  import { amazonOrderKey } from './shortcuts'

  let { href }: { href: string } = $props()
  let link = $state<HTMLAnchorElement>()
  export function open() { link?.click() }
</script>

<a bind:this={link} {href} target="_blank" rel="noopener noreferrer" aria-label="Open Amazon order (opens in a new tab)" aria-keyshortcuts={amazonOrderKey} title={`Open Amazon order (new tab) · ${amazonOrderKey}`}>
  <img class="amazon-logo amazon-logo-light" src={amazonLogo} alt="" width="27" height="22" />
  <img class="amazon-logo amazon-logo-dark" src={amazonLogoDark} alt="" width="27" height="22" />
  <Icon name="external" />
  <kbd>{amazonOrderKey}</kbd>
</a>

<style>
  a { justify-content: center; gap: 8px; min-height: 36px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--muted); }
  a:hover { background: var(--paper-strong); border-color: var(--line-strong); text-decoration: none; }
  .amazon-logo { width: 27px; height: 22px; object-fit: contain; }
  .amazon-logo-dark { display: none; }
  :global(:root[data-color-scheme='dark']) .amazon-logo-light { display: none; }
  :global(:root[data-color-scheme='dark']) .amazon-logo-dark { display: block; }
</style>
