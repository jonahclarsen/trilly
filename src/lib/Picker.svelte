<script lang="ts">
  import { tick, untrack } from 'svelte'
  import Modal from './Modal.svelte'
  import Icon from './Icon.svelte'
  import { pickerResults } from './picker-search'
  import type { Option } from './types'
  let { title, options, initialQuery = '', rankCategories = false, onpick, onclose, oncreate, onrename, renameFailed = false }: { title: string; options: Option[]; initialQuery?: string; rankCategories?: boolean; onpick: (id: string) => void; onclose: () => void; oncreate?: (name: string) => void; onrename?: (id: string, name: string) => void; renameFailed?: boolean } = $props()
  let query = $state(untrack(() => initialQuery))
  let selected = $state(0)
  let menu = $state<{ option: Option; x: number; y: number; trigger: HTMLButtonElement } | null>(null)
  let editing = $state<Option | null>(null)
  let searchInput: HTMLInputElement
  let draft = $state('')
  let renameError = $state('')
  function focusInput(node: HTMLInputElement | HTMLButtonElement) {
    node.focus()
    if (node instanceof HTMLInputElement) node.select()
  }
  function closeMenu() {
    const trigger = menu?.trigger
    menu = null
    trigger?.focus()
  }
  function close() {
    if (menu) { closeMenu(); return }
    if (editing) { editing = null; renameError = ''; void tick().then(() => searchInput.focus()); return }
    onclose()
  }
  function context(event: MouseEvent, option: Option) {
    if (!onrename || editing) return
    event.preventDefault(); event.stopPropagation()
    const trigger = event.currentTarget as HTMLButtonElement
    const rect = trigger.getBoundingClientRect()
    menu = { option, trigger, x: Math.max(8, Math.min(event.clientX || rect.left, window.innerWidth - 168)), y: Math.max(8, Math.min(event.clientY || rect.bottom, window.innerHeight - 60)) }
  }
  function rename() {
    if (!menu) return
    editing = menu.option; draft = menu.option.name; renameError = ''; menu = null
  }
  function saveRename() {
    if (!editing || renameFailed) return
    const name = draft.trim()
    if (!name || [...name].length > 200) { renameError = 'Use 1 to 200 characters.'; return }
    const option = editing
    editing = null; renameError = ''
    if (name !== option.name) { query = name; selected = 0; onrename?.(option.id, name) }
  }
  function renameKey(event: KeyboardEvent) {
    if (event.isComposing) return
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); saveRename(); if (!editing) void tick().then(() => searchInput.focus()) }
  }
  function dismissMenu(event: PointerEvent) {
    if (menu && !(event.target as Element).closest('.payee-context')) menu = null
  }
  let results = $derived(pickerResults(options, query.trim(), rankCategories))
  const newName = $derived(query.trim())
  const canCreate = $derived(!!oncreate && !!newName && [...newName].length <= 200 && !options.some(o => o.name.toLowerCase() === newName.toLowerCase()))
  const choiceCount = $derived(results.length + (canCreate ? 1 : 0))
  function keydown(event: KeyboardEvent) {
    if (event.isComposing) return
    if (event.key === 'Tab' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && canCreate) {
      event.preventDefault(); event.stopPropagation()
      oncreate?.(newName)
      return
    }
    if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation()
      if (event.key === 'Enter') { if (results[selected]) onpick(results[selected].id); else if (canCreate && selected === results.length) oncreate?.(newName); return }
      selected = Math.max(0, Math.min(choiceCount - 1, selected + (event.key === 'ArrowDown' ? 1 : -1)))
      document.getElementById(`choice-${selected}`)?.scrollIntoView({ block: 'nearest' })
    }
  }
</script>
<svelte:window onpointerdown={dismissMenu} onresize={() => menu = null} />
<Modal {title} onclose={close}>
  {#if renameFailed}<p role="alert">Save could not be confirmed. Close this picker, reload saved state, then sync before retrying.</p>{/if}
  <div class="search-input"><Icon name="search" /><input bind:this={searchInput} data-modal-focus aria-label={`Search ${title.toLowerCase()}`} placeholder="Search" bind:value={query} oninput={() => selected = 0} onkeydown={keydown} role="combobox" aria-expanded="true" aria-controls="picker-results" aria-activedescendant={selected < choiceCount ? `choice-${selected}` : undefined} autocomplete="off" /></div>
  <div class="picker-results" onscroll={() => menu = null} id="picker-results" role="listbox" aria-label={title}>
    {#each results as option, i (option.id)}
      {#if editing?.id === option.id}
        <div id={`choice-${i}`} class="payee-rename" role="option" aria-selected="true">
          <input aria-label="Payee name" aria-invalid={!!renameError} aria-describedby="rename-help" bind:value={draft} use:focusInput onkeydown={renameKey} onblur={saveRename} />
          <small id="rename-help" class:rename-error={!!renameError}>{renameError || 'Enter to save to YNAB · Esc to cancel'}</small>
        </div>
      {:else}
      <button oncontextmenu={(event) => context(event, option)} id={`choice-${i}`} type="button" role="option" aria-selected={i === selected} class:selected={i === selected} onclick={() => onpick(option.id)} onpointermove={() => selected = i}>
        <span>{option.name}{#if option.detail}<small>{option.detail}</small>{/if}</span>
        {#if i === selected}<kbd>Enter</kbd>{/if}
      </button>
      {/if}
    {/each}
    {#if canCreate}
      <button id={`choice-${results.length}`} type="button" role="option" aria-selected={selected === results.length} class:selected={selected === results.length} onclick={() => oncreate?.(newName)} onpointermove={() => selected = results.length}>
        <strong>Create “{newName}”</strong>
        {#if selected === results.length}<kbd>Enter</kbd>{:else}<kbd>Tab</kbd>{/if}
      </button>
    {:else if !results.length}<p class="muted no-results">No matches</p>{/if}
    {#if oncreate && [...newName].length > 200}<p class="muted no-results">Payee names must be 200 characters or fewer.</p>{/if}
  </div>
  {#if menu}
    <div class="payee-context" role="menu" aria-label="Payee actions" style:left={`${menu.x}px`} style:top={`${menu.y}px`}>
      <button type="button" role="menuitem" use:focusInput onclick={rename} onkeydown={(event) => { if (event.key === 'Tab') closeMenu(); if (event.key.startsWith('Arrow')) event.preventDefault() }}><Icon name="rename" />Rename</button>
    </div>
  {/if}
</Modal>

<style>
  .payee-context { position: fixed; z-index: 10; width: 160px; padding: 4px; border: 1px solid var(--line-strong); border-radius: 9px; background: var(--paper-strong); box-shadow: 0 8px 24px rgb(0 0 0 / .18); }
  .payee-context button { width: 100%; justify-content: flex-start; border: 0; background: transparent; }
  .payee-rename { padding: 6px 8px; display: grid; gap: 8px; }
  .rename-error { color: var(--danger); }
</style>
