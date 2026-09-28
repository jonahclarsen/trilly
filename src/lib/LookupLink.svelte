<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon from './Icon.svelte'

  // Shared lookup button: logo, optional label, external mark, optional shortcut.
  let { href, label, text, shortcut, children }: { href: string; label: string; text?: string; shortcut?: string; children?: Snippet } = $props()
  let link = $state<HTMLAnchorElement>()
  export function open() { link?.click() }
</script>

<a bind:this={link} {href} target="_blank" rel="noopener noreferrer" aria-label={`${label} (opens in a new tab)`} aria-keyshortcuts={shortcut} title={`${label} (new tab)${shortcut ? ` · ${shortcut}` : ''}`}>
  {@render children?.()}
  {#if text}<span class="text">{text}</span>{/if}
  <Icon name="external" />
  {#if shortcut}<kbd>{shortcut}</kbd>{/if}
</a>

<style>
  a { justify-content: center; gap: 8px; min-height: 36px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--muted); }
  a:hover { background: var(--paper-strong); border-color: var(--line-strong); text-decoration: none; }
  .text { font-size: 12px; color: var(--ink); white-space: nowrap; }
</style>
