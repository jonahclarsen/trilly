<script lang="ts">
  export let name: 'lock' | 'settings' | 'sync' | 'check' | 'skip' | 'undo' | 'close' | 'search' | 'keyboard' | 'chevron' | 'external'
  const paths = {
    lock: 'M7 10V7a5 5 0 0 1 10 0v3M6 10h12a1 1 0 0 1 1 1v9H5v-9a1 1 0 0 1 1-1Zm6 4v3',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Z',
    sync: 'M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5',
    check: 'm5 12 4 4L19 6', skip: 'm5 5 8 7-8 7M18 5v14',
    undo: 'M8 4 3 9l5 5M3 9h10a7 7 0 0 1 0 14',
    close: 'm6 6 12 12M6 18 18 6', search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6',
    keyboard: 'M3 5h18v14H3V5Zm3 4h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10',
    chevron: 'm8 10 4 4 4-4', external: 'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7',
  }
</script>
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
