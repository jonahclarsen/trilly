<script lang="ts">
  import type { Snippet } from 'svelte'
  import { altShortcutLabel } from './shortcuts'
  import Icon from './Icon.svelte'
  let { children, icon, label, shortcut, altKey, pressed, primary = false, disabled = false, onclick, type = 'button' }:
    { children?: Snippet; icon?: 'transaction' | 'list' | 'business' | 'lock' | 'settings' | 'sync' | 'check' | 'skip' | 'undo' | 'close' | 'search' | 'keyboard' | 'chevron'; label?: string; shortcut?: string; altKey?: string; pressed?: boolean; primary?: boolean; disabled?: boolean; onclick?: () => void; type?: 'button' | 'submit' } = $props()
</script>
<button {type} class:primary class:icon-only={!children} {disabled} {onclick} aria-label={label} aria-pressed={pressed} aria-keyshortcuts={altKey ? `Alt+${altKey}` : undefined} title={altKey ? `${label ?? ""} (Alt+${altKey})` : label ? `${label}${shortcut ? ` (${shortcut})` : ''}` : undefined}>
  {#if icon}<Icon name={icon} />{/if}
  {#if children}{@render children()}{/if}
  {#if altKey && children}<kbd>{altShortcutLabel(altKey)}</kbd>{:else if shortcut && children}<kbd>{shortcut}</kbd>{/if}
</button>
