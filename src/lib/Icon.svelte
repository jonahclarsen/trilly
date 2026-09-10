<script lang="ts">
  export let name: 'lock' | 'settings' | 'sync' | 'check' | 'skip' | 'undo' | 'close' | 'search' | 'keyboard' | 'chevron' | 'external'
  const paths = {
    lock: 'M7 10V7a5 5 0 0 1 10 0v3M6 10h12a1 1 0 0 1 1 1v9H5v-9a1 1 0 0 1 1-1Zm6 4v3',
    settings: 'M4 7h3m4 0h9M4 17h9m4 0h3M7 4h4v6H7V4Zm6 10h4v6h-4v-6Z',
    sync: 'M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5',
    check: 'm5 12 4 4L19 6', skip: 'm5 5 8 7-8 7M18 5v14',
    undo: 'm8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12h-3',
    close: 'm6 6 12 12M6 18 18 6', search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6',
    keyboard: 'M3 5h18v14H3V5Zm3 4h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10',
    chevron: 'm8 10 4 4 4-4', external: 'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7',
  }
</script>
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
