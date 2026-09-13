<script lang="ts">
  import type { Snippet } from 'svelte'
  let { children, minWidth = 980 }: { children: Snippet; minWidth?: number } = $props()
</script>

<div class="table-scroll">
  <div class="table-width" style:min-width={`${minWidth}px`}>{@render children()}</div>
</div>

<style>
  .table-scroll { overflow-x: auto; }
  .table-width { width: 100%; }
  .table-width :global(table) { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 13px; }
  .table-width :global(th) { text-align: left; color: var(--muted); font-size: 12px; font-weight: 500; }
  .table-width :global(th), .table-width :global(td) { padding: 8px 5px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  .table-width :global(input), .table-width :global(textarea) { width: 100%; min-width: 0; box-sizing: border-box; margin: 0; padding: 8px; font-size: 13px; }
  .table-width :global(textarea) { resize: vertical; display: block; }
</style>
