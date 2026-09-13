<script lang="ts">
  import { onMount } from 'svelte'
  import Modal from './Modal.svelte'
  import Button from './Button.svelte'
  import type { PurchaseHistoryRule } from './types'
  let { onclose, onsaved }: { onclose: () => void; onsaved: (rules: PurchaseHistoryRule[]) => void } = $props()
  let rows = $state<(PurchaseHistoryRule & { phrases: string })[]>([])
  let revision = $state('')
  let busy = $state(false)
  let error = $state('')
  let message = $state('')
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
      rows = result.rules.map((rule: PurchaseHistoryRule) => ({ ...rule, phrases: rule.payee_contains.join('\n') }))
      revision = result.revision
      onsaved(result.rules)
    } catch (e) { error = (e as Error).message } finally { busy = false }
  }
  async function save() {
    busy = true; error = ''; message = ''
    try {
      const rules = rows.map(({ phrases, ...rule }) => ({ ...rule, payee_contains: phrases.split('\n').map(p => p.trim()).filter(Boolean) }))
      const result = await request({ rules, revision })
      revision = result.revision
      onsaved(result.rules)
      error = result.error || ''; message = result.message || ''
    } catch (e) { error = (e as Error).message } finally { busy = false }
  }
  onMount(() => { void load() })
</script>

<Modal title="Purchase history links" wide onclose={() => { if (!busy) onclose() }}>
  <p class="field-note">Development only. Save updates and commits the entire rules file on the current branch. Other files are excluded. No push.</p>
  <p class="field-note">Payee phrases ignore case. Higher priority wins; ties follow this list’s order. Use public merchant URLs and matching phrases only.</p>
  <form onsubmit={(event) => { event.preventDefault(); void save() }}>
    <fieldset disabled={busy}>
      {#each rows as row, i}
        <section class="rule">
          <div class="pair">
            <label>Merchant<input required maxlength="200" bind:value={row.merchant} /></label>
            <label>ID<input required maxlength="80" bind:value={row.id} /></label>
          </div>
          <label>Website<input type="url" required bind:value={row.url} placeholder="https://example.com/orders" /></label>
          <div class="pair">
            <label>Payee phrases (one per line)<textarea required rows="3" bind:value={row.phrases}></textarea></label>
            <label>Priority<input type="number" step="1" min="-2147483648" max="2147483647" required bind:value={row.priority} /></label>
          </div>
          <div class="actions">
            <Button disabled={i === 0} onclick={() => { [rows[i - 1], rows[i]] = [rows[i]!, rows[i - 1]!] }}>Move up</Button>
            <Button disabled={i === rows.length - 1} onclick={() => { [rows[i], rows[i + 1]] = [rows[i + 1]!, rows[i]!] }}>Move down</Button>
            <Button icon="close" onclick={() => rows = rows.filter((_, index) => index !== i)}>Remove</Button>
          </div>
        </section>
      {/each}
      <Button onclick={() => rows.push({ id: '', merchant: '', url: '', priority: 10, payee_contains: [], phrases: '' })}>Add merchant</Button>
    </fieldset>
    {#if error}<p role="alert" class="modal-error">{error}</p>{/if}
    {#if message}<p role="status">{message}</p>{/if}
    <div class="actions">
      <Button type="submit" primary disabled={busy || !revision}>{busy ? 'Saving…' : 'Save and commit'}</Button>
      <Button disabled={busy} onclick={() => void load()}>Reload file</Button>
      <Button disabled={busy} onclick={onclose}>Done</Button>
    </div>
    <p class="field-note">Reload file discards this draft. If a commit fails, the saved rules still apply; retry to commit them.</p>
  </form>
</Modal>

<style>
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  .rule { padding: 16px 0; border-bottom: 1px solid var(--line); margin-bottom: 12px; display: grid; gap: 12px; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
  @media (max-width: 560px) { .pair { grid-template-columns: 1fr; } }
</style>
