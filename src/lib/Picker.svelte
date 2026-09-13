<script lang="ts">
  import { untrack } from 'svelte'
  import Modal from './Modal.svelte'
  import Icon from './Icon.svelte'
  import { pickerResults } from './picker-search'
  import type { Option } from './types'
  let { title, options, initialQuery = '', rankCategories = false, onpick, onclose, oncreate }: { title: string; options: Option[]; initialQuery?: string; rankCategories?: boolean; onpick: (id: string) => void; onclose: () => void; oncreate?: (name: string) => void } = $props()
  let query = $state(untrack(() => initialQuery))
  let selected = $state(0)
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
<Modal {title} {onclose}>
  <div class="search-input"><Icon name="search" /><input data-modal-focus aria-label={`Search ${title.toLowerCase()}`} placeholder="Search" bind:value={query} oninput={() => selected = 0} onkeydown={keydown} role="combobox" aria-expanded="true" aria-controls="picker-results" aria-activedescendant={selected < choiceCount ? `choice-${selected}` : undefined} autocomplete="off" /></div>
  <div class="picker-results" id="picker-results" role="listbox" aria-label={title}>
    {#each results as option, i (option.id)}
      <button id={`choice-${i}`} type="button" role="option" aria-selected={i === selected} class:selected={i === selected} onclick={() => onpick(option.id)} onpointermove={() => selected = i}>
        <span>{option.name}{#if option.detail}<small>{option.detail}</small>{/if}</span>
        {#if i === selected}<kbd>Enter</kbd>{/if}
      </button>
    {/each}
    {#if canCreate}
      <button id={`choice-${results.length}`} type="button" role="option" aria-selected={selected === results.length} class:selected={selected === results.length} onclick={() => oncreate?.(newName)} onpointermove={() => selected = results.length}>
        <strong>Create “{newName}”</strong>
        {#if selected === results.length}<kbd>Enter</kbd>{:else}<kbd>Tab</kbd>{/if}
      </button>
    {:else if !results.length}<p class="muted no-results">No matches</p>{/if}
    {#if oncreate && [...newName].length > 200}<p class="muted no-results">Payee names must be 200 characters or fewer.</p>{/if}
  </div>
</Modal>
