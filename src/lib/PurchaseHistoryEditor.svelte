<script lang="ts">
  import { onMount } from 'svelte'
  import Modal from './Modal.svelte'
  import Button from './Button.svelte'
  import type { PurchaseHistoryRule } from './types'
  let { onclose, onsaved }: { onclose: () => void; onsaved: (rules: PurchaseHistoryRule[]) => void } = $props()
  type Row = PurchaseHistoryRule & { phrases: string; key: string }
  let rows = $state<Row[]>([])
  const blank = (): Row => ({ key: crypto.randomUUID(), id: '', merchant: '', url: '', priority: 10, payee_contains: [], phrases: '' })
  let dragging = $state<string | null>(null)
  let table: HTMLTableElement
  let revision = $state('')
  let busy = $state(false)
  let error = $state('')
  let message = $state('')
  function edited() {
    message = ''; error = ''
    const last = rows.at(-1)
    if (last && (last.id || last.merchant || last.url || last.phrases || last.priority !== 10)) rows.push(blank())
  }
  function move(key: string, target: number) {
    const from = rows.findIndex(row => row.key === key)
    if (from < 0 || target < 0 || target >= rows.length - 1 || from === target) return
    const [row] = rows.splice(from, 1)
    rows.splice(target, 0, row!)
    message = ''; error = ''
  }
  function drag(event: PointerEvent) {
    if (!dragging) return
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLTableRowElement>('tr[data-row]')
    if (target && table.contains(target)) move(dragging, rows.findIndex(row => row.key === target.dataset.row))
  }
  async function request(body?: object) {
    const response = await fetch('/__dev/purchase-history', { method: body ? 'POST' : 'GET', headers: { 'x-trilly-editor': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Unable to load rules.')
    return result
  }
  async function load() {
    busy = true; error = ''; message = ''
    try {
      const result = await request()
      rows = [...result.rules.map((rule: PurchaseHistoryRule) => ({ ...rule, key: crypto.randomUUID(), phrases: rule.payee_contains.join('\n') })), blank()]
      revision = result.revision
      onsaved(result.rules)
    } catch (e) { error = (e as Error).message } finally { busy = false }
  }
  async function save() {
    busy = true; error = ''; message = ''
    try {
      const rules = rows.slice(0, -1).map(({ phrases, key, ...rule }) => ({ ...rule, payee_contains: phrases.split('\n').map(p => p.trim()).filter(Boolean) }))
      const result = await request({ rules, revision })
      revision = result.revision
      onsaved(result.rules)
      error = result.error || ''; message = result.message || ''
    } catch (e) { error = (e as Error).message } finally { busy = false }
  }
  onMount(() => { void load() })
</script>

<svelte:window onpointermove={drag} onpointerup={() => dragging = null} onpointercancel={() => dragging = null} />

<Modal title="Purchase history links" width={1240} onclose={() => { if (!busy) onclose() }}>
  <form onsubmit={(event) => { event.preventDefault(); void save() }}>
    <fieldset disabled={busy}>
      <div class="table-scroll">
        <table bind:this={table} oninput={edited}>
          <colgroup><col class="control" /><col class="merchant" /><col class="id" /><col class="website" /><col class="phrases" /><col class="priority" /><col class="control" /></colgroup>
          <thead><tr><th scope="col"><span class="sr-only">Order</span></th><th scope="col">Merchant</th><th scope="col">ID</th><th scope="col">Website</th><th scope="col">Payee phrases</th><th scope="col">Priority</th><th scope="col"><span class="sr-only">Remove</span></th></tr></thead>
          <tbody>
            {#each rows as row, i (row.key)}
              {@const empty = i === rows.length - 1}
              <tr data-row={row.key} class:dragging={dragging === row.key}>
                <td>
                  {#if !empty}
                    <button type="button" class="handle icon-only" aria-label={`Reorder ${row.merchant || 'merchant'}`} title="Drag to reorder, or use Up and Down arrow keys"
                      onpointerdown={(event) => { if (event.button === 0) dragging = row.key }}
                      onkeydown={(event) => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); move(row.key, i + (event.key === 'ArrowUp' ? -1 : 1)) } }}>
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="7" cy="5" r="1.3" /><circle cx="13" cy="5" r="1.3" /><circle cx="7" cy="10" r="1.3" /><circle cx="13" cy="10" r="1.3" /><circle cx="7" cy="15" r="1.3" /><circle cx="13" cy="15" r="1.3" /></svg>
                    </button>
                  {/if}
                </td>
                <td><input aria-label={`Merchant ${i + 1}`} required={!empty} maxlength="200" bind:value={row.merchant} /></td>
                <td><input aria-label={`ID ${i + 1}`} required={!empty} maxlength="80" bind:value={row.id} /></td>
                <td><input aria-label={`Website ${i + 1}`} type="url" required={!empty} bind:value={row.url} /></td>
                <td><textarea aria-label={`Payee phrases ${i + 1}, one per line`} title="One phrase per line" required={!empty} rows="2" bind:value={row.phrases}></textarea></td>
                <td><input aria-label={`Priority ${i + 1}`} type="number" step="1" min="-2147483648" max="2147483647" required={!empty} bind:value={row.priority} /></td>
                <td>{#if !empty}<Button icon="close" label={`Remove ${row.merchant || 'merchant'}`} onclick={() => { rows = rows.filter(item => item.key !== row.key); edited() }} />{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </fieldset>
    {#if error}<p role="alert" class="modal-error">{error}</p>{/if}
    {#if message}<p role="status">{message}</p>{/if}
    <div class="actions">
      <Button type="submit" primary disabled={busy || !revision}>{busy ? 'Saving…' : 'Save and commit'}</Button>
    </div>
  </form>
</Modal>

<style>
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  .table-scroll { overflow-x: auto; }
  table { width: 100%; min-width: 980px; table-layout: fixed; border-collapse: collapse; }
  .control { width: 44px; }
  .merchant { width: 17%; }
  .id { width: 14%; }
  .website { width: 29%; }
  .phrases { width: 23%; }
  .priority { width: 90px; }
  th { text-align: left; color: var(--muted); font-size: 12px; font-weight: 500; }
  th, td { padding: 8px 5px; border-bottom: 1px solid var(--line); }
  td { vertical-align: middle; }
  input, textarea { width: 100%; min-width: 0; margin: 0; padding: 8px; font-size: 13px; }
  textarea { resize: vertical; display: block; }
  .handle { touch-action: none; cursor: grab; color: var(--muted); }
  .dragging { background: var(--paper-strong); }
  .dragging .handle { cursor: grabbing; }
  .actions { display: flex; justify-content: flex-end; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
