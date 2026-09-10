<script lang="ts">
  import Modal from './Modal.svelte'
  import Icon from './Icon.svelte'
  import type { Option } from './types'
  let { title, options, onpick, onclose }: { title: string; options: Option[]; onpick: (id: string) => void; onclose: () => void } = $props()
  let query = $state('')
  let selected = $state(0)
  let results = $derived(options.filter(o => `${o.name} ${o.detail ?? ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 60))
  function keydown(event: KeyboardEvent) {
    if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation()
      if (event.key === 'Enter') { if (results[selected]) onpick(results[selected].id); return }
      selected = Math.max(0, Math.min(results.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1)))
      document.getElementById(`choice-${selected}`)?.scrollIntoView({ block: 'nearest' })
    }
  }
</script>
<Modal {title} {onclose}>
  <div class="search-input"><Icon name="search" /><input data-modal-focus aria-label={`Search ${title.toLowerCase()}`} placeholder="Search" bind:value={query} oninput={() => selected = 0} onkeydown={keydown} role="combobox" aria-expanded="true" aria-controls="picker-results" aria-activedescendant={results[selected] ? `choice-${selected}` : undefined} autocomplete="off" /></div>
  <div class="picker-results" id="picker-results" role="listbox" aria-label={title}>
    {#each results as option, i (option.id)}
      <button id={`choice-${i}`} type="button" role="option" aria-selected={i === selected} class:selected={i === selected} onclick={() => onpick(option.id)} onpointermove={() => selected = i}>
        <span>{option.name}{#if option.detail}<small>{option.detail}</small>{/if}</span>
        {#if i === selected}<kbd>Enter</kbd>{/if}
      </button>
    {:else}<p class="muted no-results">No matches</p>{/each}
  </div>
</Modal>
