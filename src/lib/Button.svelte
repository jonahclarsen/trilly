<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon from './Icon.svelte'
  let { children, icon, label, shortcut, primary = false, disabled = false, onclick, type = 'button' }:
    { children?: Snippet; icon?: 'lock' | 'settings' | 'sync' | 'check' | 'skip' | 'undo' | 'close' | 'search' | 'keyboard' | 'chevron'; label?: string; shortcut?: string; primary?: boolean; disabled?: boolean; onclick?: () => void; type?: 'button' | 'submit' } = $props()
</script>
<button {type} class:primary class:icon-only={!children} {disabled} {onclick} aria-label={label} title={label ? `${label}${shortcut ? ` (${shortcut})` : ''}` : undefined}>
  {#if icon}<Icon name={icon} />{/if}
  {#if children}{@render children()}{/if}
  {#if shortcut && children}<kbd>{shortcut}</kbd>{/if}
</button>
