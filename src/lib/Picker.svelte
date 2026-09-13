<script lang="ts">
  import Modal from './Modal.svelte'
  import Icon from './Icon.svelte'
  import type { Option } from './types'
  let { title, options, onpick, onclose, oncreate }: { title: string; options: Option[]; onpick: (id: string) => void; onclose: () => void; oncreate?: (name: string) => void } = $props()
  let query = $state('')
  let selected = $state(0)
  let results = $derived(options.filter(o => `${o.name} ${o.detail ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 60))
  const newName = $derived(query.trim())
  const canCreate = $derived(!!oncreate && !!newName && [...newName].length <= 200 && !options.some(o => o.name.toLowerCase() === newName.toLowerCase()))
  const choiceCount = $derived(results.length + (canCreate ? 1 : 0))
  function keydown(event: KeyboardEvent) {
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
        <span>Create “{newName}”<small>Created when you save &amp; approve</small></span>
        {#if selected === results.length}<kbd>Enter</kbd>{/if}
      </button>
    {:else if !results.length}<p class="muted no-results">No matches</p>{/if}
    {#if oncreate && [...newName].length > 200}<p class="muted no-results">Payee names must be 200 characters or fewer.</p>{/if}
  </div>
</Modal>
