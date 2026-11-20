<script lang="ts">
  import { api } from './api'
  import Button from './Button.svelte'
  import Modal from './Modal.svelte'
  import type { Option } from './types'
  import { parseWealthsimple, type WealthsimpleRow, type WealthsimplePreview } from './wealthsimple'

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

  const preview = $derived.by<WealthsimplePreview>(() => {
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

<Modal title="Import Wealthsimple" {onclose} dismissible={!submitting} width={1000}>
  <form onsubmit={submit}>
    <fieldset class="destination" disabled={submitting}>
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
    <div class="activity-panels">
      {#if destination}
        <section class="panel" aria-labelledby="import-history-heading">
          <h3 id="import-history-heading">Recent in YNAB</h3>
          {#if recentStatus === 'loading'}
            <p class="panel-note" role="status">Loading…</p>
          {:else if recentStatus === 'error'}
            <p class="panel-note" role="status">Couldn’t load recent transactions.</p>
          {:else if !recent.length}
            <p class="panel-note" role="status">No transactions in this account.</p>
          {:else}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to scroll account history.) -->
            <div class="table-scroll" tabindex="0" role="region" aria-labelledby="import-history-heading">
              {@render transactionTable(recent)}
            </div>
          {/if}
        </section>
      {/if}
      <section class="panel source" aria-labelledby="import-source-heading">
        <h3 id="import-source-heading"><label for="wealthsimple-activity">Wealthsimple Activity</label></h3>
        <div class="paste">
          <textarea id="wealthsimple-activity" rows="4" maxlength="150000" data-modal-focus placeholder="Paste transactions" bind:value={text} oninput={edit} disabled={submitting}></textarea>
        </div>
        {#if preview.rows}
          <h4 id="import-preview-heading">Preview <span class="muted">· {preview.rows.length}</span></h4>
          <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to scroll the preview.) -->
          <div class="table-scroll" tabindex="0" role="region" aria-labelledby="import-preview-heading">
            {@render transactionTable(preview.rows)}
          </div>
        {/if}
        {#if preview.skipped?.length}
          <div class="skipped">
            <h4>Skipped text</h4>
            {#each preview.skipped as lines}
              <pre>{lines.join('\n')}</pre>
            {/each}
          </div>
        {/if}
        {#if preview.error}<p class="panel-note" role="alert">{preview.error}</p>{/if}
      </section>
    </div>
    <div class="import-actions">
      {#if error}<p role="alert">{error}</p>{/if}
      {#if result}<p role="status">{result.added} added to YNAB{result.duplicates ? ` · ${result.duplicates} already imported` : ''}</p>{/if}
      <Button type="submit" primary disabled={submitting || !preview.rows || !accounts.some(item => item.id === destination)}>
        {submitting ? 'Importing…' : preview.rows ? `Import ${preview.rows.length} to YNAB` : 'Import to YNAB'}
      </Button>
    </div>
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
  form { gap: 16px; }
  .destination { margin: 0; min-width: 0; border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px 12px; }
  legend { padding: 0 5px; font-weight: 600; }
  .account-groups { display: grid; gap: 10px; max-height: 10rem; overflow: auto; padding: 3px; }
  .account-groups p { margin-bottom: 5px; }
  .accounts { display: flex; flex-wrap: wrap; gap: 5px; }
  .accounts :global(button) { padding: 6px 10px; }
  .accounts :global(button[aria-pressed="true"]) { background: var(--active-nav); border-color: var(--accent); color: var(--accent-strong); }

  .activity-panels { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 14px; }
  .panel { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 10px; }
  h3, h4 { margin: 0; padding: 10px 12px; font-size: 13px; font-weight: 650; }
  h3 { background: var(--paper-strong); border-bottom: 1px solid var(--line); }
  h4 { border-top: 1px solid var(--line); }
  .source h3 { background: var(--active-nav); }
  .source h3 label { display: block; font: inherit; }
  .panel-note, .paste { padding: 12px; }
  textarea { display: block; }
  .table-scroll { max-height: min(35vh, 300px); overflow: auto; }
  table { width: 100%; border-spacing: 0; text-align: left; font-variant-numeric: tabular-nums; }
  th, td { padding: 7px 10px; vertical-align: top; }
  th { position: sticky; top: 0; background: var(--paper); border-bottom: 1px solid var(--line); color: var(--muted); font-size: 11px; font-weight: 600; }
  td { border-bottom: 1px solid var(--line); }
  tr:last-child td { border-bottom: 0; }
  td:nth-child(2) { width: 100%; overflow-wrap: anywhere; }
  td:first-child, td:last-child { white-space: nowrap; }
  th:last-child, td:last-child { text-align: right; }
  small { display: block; }

  .skipped { border-top: 1px solid var(--line); background: var(--paper-strong); padding-bottom: 10px; }
  .skipped h4 { border-top: 0; }
  pre { margin: 0 10px; padding: 8px; background: var(--paper); border: 1px solid var(--line); border-radius: 6px; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px var(--font-mono); }
  pre + pre { margin-top: 6px; }
  .import-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
  .import-actions :global(button) { margin-inline-start: auto; }

  @media (max-width: 740px) {
    .activity-panels { grid-template-columns: minmax(0, 1fr); }
    .table-scroll { max-height: 200px; }
  }
</style>
