<script lang="ts">
  import { api } from './api'
  import Button from './Button.svelte'
  import Modal from './Modal.svelte'
  import type { Option } from './types'
  import { parseWealthsimple, type WealthsimpleRow } from './wealthsimple'

  let { accounts, planId, syncedAt, onclose, onimport }: {
    accounts: Option[]; planId: string; syncedAt: string | null; onclose: () => void
    onimport: (account: string, rows: WealthsimpleRow[]) => Promise<{ added: number; duplicates: number }>
  } = $props()

  let account = $state('')
  let text = $state('')
  let submitting = $state(false)
  let error = $state('')
  let result = $state<{ added: number; duplicates: number }>()
  const groups = $derived.by(() => {
    const matching: Option[] = []
    const other: Option[] = []
    for (const item of accounts) {
      const group = /wealth[\s-]*simple|\bws\b/i.test(item.name) ? matching : other
      group.push(item)
    }
    return [
      { label: 'Wealthsimple', accounts: matching },
      { label: 'Other accounts', accounts: other },
    ].filter(group => group.accounts.length)
  })
  const destination = $derived(accounts.find(item => item.id === account)?.id ?? groups[0]?.accounts[0]?.id ?? '')
  type RecentRow = { date: string; payee: string | null; amount: number }
  let recent = $state<RecentRow[]>([])
  let recentStatus = $state<'loading' | 'ready' | 'error'>('loading')
  $effect(() => {
    const query = new URLSearchParams({ plan_id: planId, account_id: destination })
    if (syncedAt) query.set('synced_at', syncedAt)
    if (!destination) return
    let active = true
    recentStatus = 'loading'
    void api<{ rows: RecentRow[] }>(`wealthsimple?${query}`).then(({ rows }) => {
      if (!active) return
      recent = rows
      recentStatus = 'ready'
    }).catch(() => {
      if (active) recentStatus = 'error'
    })
    return () => { active = false }
  })

  const preview = $derived.by<{ rows?: WealthsimpleRow[]; skippedText?: boolean; error?: string }>(() => {
    if (!text.trim()) return {}
    try { return parseWealthsimple(text) }
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
      <div class="account-groups">
        {#each groups as group (group.label)}
          <div role="group" aria-label={group.label}>
            <p class="field-note">{group.label}</p>
            <div class="accounts">
              {#each group.accounts as item (item.id)}
                <Button pressed={destination === item.id} onclick={() => { account = item.id; edit() }}>{item.name}</Button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </fieldset>
    {#if destination}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to scroll account history.) -->
      <section class="recent" tabindex="0" aria-label="Recent YNAB transactions">
        <p class="field-note">Recent in YNAB</p>
        {#if recentStatus === 'loading'}
          <p role="status">Loading…</p>
        {:else if recentStatus === 'error'}
          <p role="status">Couldn’t load recent transactions.</p>
        {:else if !recent.length}
          <p role="status">No transactions in this account.</p>
        {:else}
          {@render transactionTable(recent)}
        {/if}
      </section>
    {/if}
    <label>
      Wealthsimple Activity
      <textarea rows="5" maxlength="150000" data-modal-focus placeholder="Paste transactions" bind:value={text} oninput={edit} disabled={submitting}></textarea>
    </label>
    {#if preview.rows}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to scroll the preview.) -->
      <div class="preview" tabindex="0" role="region" aria-label="Transactions to import">
        {@render transactionTable(preview.rows)}
      </div>
    {/if}
    {#if preview.skippedText}<p role="status">Some text didn’t form complete transactions. Check the preview before importing.</p>{/if}
    {#if error || preview.error}<p role="alert">{error || preview.error}</p>{/if}
    {#if result}<p role="status">{result.added} added to YNAB{result.duplicates ? ` · ${result.duplicates} already imported` : ''}</p>{/if}
    <Button type="submit" primary disabled={submitting || !preview.rows || !accounts.some(item => item.id === destination)}>
      {submitting ? 'Importing…' : preview.rows ? `Import ${preview.rows.length} to YNAB` : 'Import to YNAB'}
    </Button>
  </form>
</Modal>

{#snippet transactionTable(rows: (RecentRow | WealthsimpleRow)[])}
  <table>
    <thead><tr><th>Date</th><th>Payee</th><th>Amount</th></tr></thead>
    <tbody>
      {#each rows as row}
        <tr><td>{row.date}</td><td>{row.payee || '—'}{#if 'memo' in row && row.memo}<small>{row.memo}</small>{/if}</td><td>{cad.format(row.amount / 1000)}</td></tr>
      {/each}
    </tbody>
  </table>
{/snippet}

<style>
  form, label { display: grid; gap: 0.65rem; }
  fieldset { margin: 0; border: 0; padding: 0; min-width: 0; }
  legend { padding: 0; margin-bottom: 0.5rem; }
  textarea { width: 100%; resize: vertical; }
  .account-groups { display: grid; gap: 0.65rem; max-height: 10rem; overflow: auto; }
  .account-groups p { margin-bottom: 0.25rem; }
  .accounts { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .accounts :global(button[aria-pressed="true"]) { background: var(--active-nav); border-color: var(--accent); color: var(--accent-strong); }
  .recent { max-height: 225px; overflow: auto; }
  .preview { max-height: 35vh; overflow: auto; }
  table { width: 100%; border-collapse: collapse; text-align: left; }
  th, td { padding: 0.35rem; }
  td:first-child, td:last-child { white-space: nowrap; }
  th:last-child, td:last-child { text-align: right; }
  small { display: block; opacity: 0.75; }
  p { margin: 0; }
</style>
