<script lang="ts">
  import type { Snippet } from 'svelte'
  import Button from './Button.svelte'
  let { title, onclose, children, wide = false }: { title: string; onclose: () => void; children: Snippet; wide?: boolean } = $props()
  function open(node: HTMLDialogElement) { node.showModal(); return { destroy() { node.close() } } }
</script>
<dialog use:open class:wide oncancel={(event) => { event.preventDefault(); onclose() }} aria-label={title}>
  <div class="modal-heading"><h2>{title}</h2><Button icon="close" label="Close" shortcut="Esc" onclick={onclose} /></div>
  {@render children()}
</dialog>
