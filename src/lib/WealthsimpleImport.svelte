<script lang="ts">
  import Button from './Button.svelte'
  import Modal from './Modal.svelte'
  import type { Option } from './types'
  import { parseWealthsimple, type WealthsimpleRow } from './wealthsimple'

  let { accounts, accountId, onclose, onimport }: {
    accounts: Option[]; accountId: string; onclose: () => void
    onimport: (account: string, rows: WealthsimpleRow[]) => Promise<{ added: number; duplicates: number }>
  } = $props()

  let account = $state('')
  let text = $state('')
  let submitting = $state(false)
  let error = $state('')
  let result = $state<{ added: number; duplicates: number }>()
  const destination = $derived(account || accountId)
  const preview = $derived.by(() => {
    if (!text.trim()) return {}
    try { return { rows: parseWealthsimple(text) } }
    catch (e) { return { error: e instanceof Error ? e.message : 'Could not read the pasted activity.' } }
  })
  const cad = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'CAD' })

  function edit() {
    error = ''
    result = undefined
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    if (submitting || result || !preview.rows || !accounts.some(item => item.id === destination)) return
    submitting = true
    error = ''
    try {
      result = await onimport(destination, preview.rows)
      text = ''
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not confirm the import. Retry the same transactions.'
    } finally {
      submitting = false
    }
  }
</script>

<Modal title="Import Wealthsimple" {onclose} dismissible={!submitting} wide>
  <form onsubmit={submit}>
    <fieldset disabled={submitting}>
      <legend>YNAB account</legend>
      <div class="accounts">
        {#each accounts as item (item.id)}
          <Button pressed={destination === item.id} onclick={() => { account = item.id; edit() }}>{item.name}</Button>
        {/each}
      </div>
    </fieldset>
    <label>
      Wealthsimple Activity
      <textarea rows="5" maxlength="150000" data-modal-focus placeholder="Paste transactions" bind:value={text} oninput={edit} disabled={submitting}></textarea>
    </label>
    {#if preview.rows}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to scroll the preview.) -->
      <div class="preview" tabindex="0" role="region" aria-label="Transactions to import">
        <table>
          <thead><tr><th>Date</th><th>Payee</th><th>Amount</th></tr></thead>
          <tbody>
            {#each preview.rows as row}
              <tr><td>{row.date}</td><td>{row.payee}{#if row.memo}<small>{row.memo}</small>{/if}</td><td>{cad.format(row.amount / 1000)}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
    {#if error || preview.error}<p role="alert">{error || preview.error}</p>{/if}
    {#if result}<p role="status">{result.added} added to YNAB{result.duplicates ? ` · ${result.duplicates} already imported` : ''}</p>{/if}
    <Button type="submit" primary disabled={submitting || !preview.rows || !accounts.some(item => item.id === destination)}>
      {submitting ? 'Importing…' : preview.rows ? `Import ${preview.rows.length} to YNAB` : 'Import to YNAB'}
    </Button>
  </form>
</Modal>

<style>
  form, label { display: grid; gap: 0.65rem; }
  fieldset { margin: 0; border: 0; padding: 0; min-width: 0; }
  legend { padding: 0; margin-bottom: 0.5rem; }
  textarea { width: 100%; resize: vertical; }
  .accounts { display: flex; flex-wrap: wrap; gap: 0.35rem; max-height: 8rem; overflow: auto; }
  .accounts :global(button[aria-pressed="true"]) { background: var(--active-nav); border-color: var(--accent); color: var(--accent-strong); }
  .preview { max-height: 35vh; overflow: auto; }
  table { width: 100%; border-collapse: collapse; text-align: left; }
  th, td { padding: 0.35rem; }
  td:first-child, td:last-child { white-space: nowrap; }
  th:last-child, td:last-child { text-align: right; }
  small { display: block; opacity: 0.75; }
  p { margin: 0; }
</style>
