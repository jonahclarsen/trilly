<script lang="ts">
  import LookupLink from './LookupLink.svelte'
  import amazonLogo from '../assets/amazon-logo.webp'
  import amazonLogoDark from '../assets/amazon-logo-dark.webp'
  import { amazonOrderKey } from './shortcuts'

  let { href, shortcut = true }: { href: string; shortcut?: boolean } = $props()
</script>

<LookupLink {href} label="Open Amazon order" shortcut={shortcut ? amazonOrderKey : undefined}>
  <img class="amazon-logo amazon-logo-light" src={amazonLogo} alt="" width="23" height="20" />
  <img class="amazon-logo amazon-logo-dark" src={amazonLogoDark} alt="" width="23" height="20" />
</LookupLink>

<style>
  .amazon-logo { width: 23px; height: 20px; object-fit: contain; }
  .amazon-logo-dark { display: none; }
  :global(:root[data-color-scheme='dark']) .amazon-logo-light { display: none; }
  :global(:root[data-color-scheme='dark']) .amazon-logo-dark { display: block; }
</style>
