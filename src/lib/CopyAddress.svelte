<script lang="ts">
  import { onDestroy } from 'svelte'

  let { address }: { address: string } = $props()
  let feedback = $state('')
  let announcement = $state('')
  let revision = $state(0)
  let copying = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let destroyed = false

  onDestroy(() => { destroyed = true; clearTimeout(timer) })

  async function copy() {
    if (copying) return
    copying = true
    let result = 'Copied'
    try { await navigator.clipboard.writeText(address) }
    catch { result = 'Copy failed' }
    copying = false
    if (destroyed) return
    clearTimeout(timer)
    feedback = result
    announcement = result === 'Copied' ? 'Address copied.' : 'Copy failed. Select the address and copy it manually.'
    revision++
    timer = setTimeout(() => { feedback = '' }, 1100)
  }
</script>

<button type="button" class="copy-address" class:showing={!!feedback}
  aria-label={`Copy ${address}`}
  title={announcement.startsWith('Copy failed') ? announcement : 'Copy address, then paste into Chrome’s address bar'}
  onclick={() => void copy()}>
  <span class="address">{address}</span>
  {#if feedback}{#key revision}<span class="feedback" aria-hidden="true">{feedback}</span>{/key}{/if}
</button>
<span class="sr-only" role="status">{announcement}</span>

<style>
  .copy-address, .copy-address:hover:not(:disabled) {
    position: relative;
    display: inline;
    padding: 0;
    border: 0;
    border-radius: 2px;
    background: transparent;
    color: inherit;
    font: inherit;
    vertical-align: baseline;
    cursor: pointer;
    user-select: text;
    white-space: nowrap;
  }
  .address {
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
    transition: opacity 160ms ease, filter 160ms ease;
  }
  .showing .address { opacity: .2; filter: blur(1px); }
  .feedback {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    white-space: nowrap;
    animation: confirmation 1.1s ease both;
  }
  @keyframes confirmation {
    0% { opacity: 0; filter: blur(3px); transform: translateY(3px); }
    15%, 72% { opacity: 1; filter: blur(0); transform: translateY(0); }
    100% { opacity: 0; filter: blur(3px); transform: translateY(-2px); }
  }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  @media (prefers-reduced-motion: reduce) {
    .address { transition: none; }
    .showing .address { filter: none; }
    .feedback { animation: none; }
  }
</style>
