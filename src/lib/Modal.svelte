<script lang="ts">
  import type { Snippet } from 'svelte'
  import Button from './Button.svelte'
  let { title, onclose, children, wide = false, subtitle }: { title: string; onclose: () => void; children: Snippet; wide?: boolean; subtitle?: string } = $props()
  function open(node: HTMLDialogElement) {
    window.addEventListener('keydown', keydown, true)
    node.showModal()
    // showModal focuses its first control; move to the picker only after opening.
    queueMicrotask(() => {
      if (!node.open) return
      const input = node.querySelector<HTMLInputElement>('[data-modal-focus]')
      input?.focus(); input?.select()
    })
    return { destroy() { window.removeEventListener('keydown', keydown, true); node.close() } }
  }
  function keydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.isComposing) return
    event.preventDefault()
    event.stopPropagation()
    onclose()
  }
  let outsidePress = false
  function outside(event: PointerEvent | MouseEvent) {
    const node = event.currentTarget as HTMLDialogElement
    const rect = node.getBoundingClientRect()
    return event.target === node && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)
  }
</script>
<dialog onpointerdown={(event) => outsidePress = outside(event)} onclick={(event) => { if (outsidePress && outside(event)) onclose(); outsidePress = false }} use:open class:wide oncancel={(event) => { event.preventDefault(); onclose() }} aria-label={title}>
  <div class="modal-heading" class:with-subtitle={!!subtitle}><h2>{title}</h2><Button icon="close" label="Close" shortcut="Esc" onclick={onclose} /></div>
  {#if subtitle}<p class="modal-subtitle muted">{subtitle}</p>{/if}
  {@render children()}
</dialog>
