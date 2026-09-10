<script lang="ts">
  import { onMount, tick, untrack } from 'svelte'
  import Button from './lib/Button.svelte'
  import Icon from './lib/Icon.svelte'
  import Modal from './lib/Modal.svelte'
  import Picker from './lib/Picker.svelte'
  import { api, ApiError, setSession } from './lib/api'
  import { applyAppearance, readPreferences, type Appearance } from './lib/appearance'
  import { THEME_OPTIONS, type ThemeId } from './lib/themes'
  import { shortcuts } from './lib/shortcuts'
  import { special, type Snapshot, type Suggestion, type Option } from './lib/types'

  const preferences = readPreferences()
  let theme = $state<ThemeId>(preferences.theme)
  let appearance = $state<Appearance>(preferences.appearance)
  let ready = $state(false)
  let exists = $state(false)
  let data = $state<Snapshot | null>(null)
  let password = $state('')
  let confirmation = $state('')
  let token = $state('')
  let busy = $state(false)
  let syncing = $state(false)
  let error = $state('')
  let modal = $state<'settings' | 'shortcuts' | 'category' | 'payee' | 'account' | null>(null)
  let skipped = $state<string[]>([])
  let picks = $state<Suggestion[]>([])
  let payee = $state<string | null>(null)
  let category = $state<string | null>(null)
  let edited = $state(false)
  let sessionEpoch = 0
  let syncTimer: ReturnType<typeof setTimeout>
  let lastActivity = Date.now()
  let reviewElement = $state<HTMLElement>()
  const current = $derived(data?.queue.find(t => !skipped.includes(t.id)))
  const currentId = $derived(current?.id)
  const remaining = $derived(data?.queue.filter(t => !skipped.includes(t.id)).length ?? 0)
  const currentAccount = $derived(data?.accounts.find(a => a.id === data?.account_id))
  const currentPlan = $derived(data?.plans.find(p => p.id === data?.plan_id))
  const currency = $derived(currentPlan?.currency_format?.iso_code)
  const categoryName = $derived(data?.categories.find(c => c.id === category)?.name ?? current?.category_name ?? 'Choose category')
  const payeeName = $derived(data?.payees.find(p => p.id === payee)?.name ?? current?.payee_name ?? 'Choose payee')

  $effect(() => { applyAppearance(theme, appearance) })
  $effect(() => {
    if (ready && !data && !modal) queueMicrotask(() => document.querySelector<HTMLInputElement>('.unlock-card input')?.focus())
  })
  $effect(() => {
    const id = currentId
    untrack(() => {
      const t = current
      payee = t?.payee_id ?? null; category = t?.category_id ?? null; edited = false; picks = []
      if (id && t && !special(t)) {
        const epoch = sessionEpoch
        api<Suggestion[]>(`suggestions/${encodeURIComponent(id)}`).then(result => {
          if (sessionEpoch === epoch && currentId === id) picks = result
        }).catch(e => { if (sessionEpoch === epoch) handleError(e) })
      }
    })
  })

  onMount(() => {
    api<{ exists: boolean }>('status').then(result => { exists = result.exists; ready = true }).catch(handleError)
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => applyAppearance(theme, appearance)
    media.addEventListener('change', update)
    const timer = setInterval(() => {
      update()
      if (data && Date.now() - lastActivity >= 600_000) void lock()
    }, 10_000)
    const wake = () => {
      if (data && Date.now() - lastActivity >= 600_000) void lock()
    }
    document.addEventListener('visibilitychange', wake)
    return () => { media.removeEventListener('change', update); clearInterval(timer); clearTimeout(syncTimer); document.removeEventListener('visibilitychange', wake) }
  })

  function forget() {
    sessionEpoch++; setSession(''); data = null; password = ''; confirmation = ''; token = ''; modal = null
    picks = []; skipped = []; payee = null; category = null; clearTimeout(syncTimer); busy = false; syncing = false
  }
  function handleError(e: unknown) {
    if (e instanceof ApiError && e.status === 401) forget()
    error = e instanceof Error ? e.message : 'Something went wrong'
  }
  async function unlock() {
    if (busy) return
    error = ''
    if (!exists && password !== confirmation) { error = 'Passphrases don’t match'; return }
    busy = true
    try {
      const result = await api<{ session: string; state: Snapshot }>('unlock', { password, create: !exists })
      setSession(result.session); sessionEpoch++; data = result.state; exists = true; lastActivity = Date.now()
      password = ''; confirmation = ''
      if (!data.connected) modal = 'settings'
      if (data.plan_id) scheduleSync(50)
    } catch (e) { handleError(e); password = ''; confirmation = '' }
    finally { busy = false }
  }
  async function act(action: Record<string, unknown>): Promise<boolean> {
    if (busy || !data) return false
    error = ''; busy = true
    const epoch = sessionEpoch
    try {
      const result = await api<Snapshot>('action', action)
      if (epoch !== sessionEpoch) return false
      data = result
      if (result.sync_error) error = result.sync_error
      return !result.sync_error
    } catch (e) { if (epoch === sessionEpoch) handleError(e); return false }
    finally { if (epoch === sessionEpoch) busy = false }
  }
  function scheduleSync(delay = 3000) {
    clearTimeout(syncTimer)
    syncTimer = setTimeout(() => { if (busy) scheduleSync(500); else void sync(false) }, delay)
  }
  async function sync(full = true) {
    if (busy || !data?.plan_id) return
    clearTimeout(syncTimer); syncing = true
    await act({ action: 'sync', full }); syncing = false
  }
  async function approve(suggestion?: Suggestion) {
    if (!current || busy || !data) return
    const success = await act({ action: 'review', id: current.id,
      payee_id: suggestion ? suggestion.payee_id : payee,
      category_id: suggestion ? suggestion.category_id : category })
    if (success) { scheduleSync(); reviewElement?.focus() }
  }
  async function undo() {
    if (!data?.can_undo || busy) return
    if (await act({ action: 'undo' })) { skipped = []; scheduleSync(50) }
  }
  function skip() {
    if (current && !busy) { skipped = [...skipped, current.id]; reviewElement?.focus() }
  }
  async function lock() {
    const request = api('action', { action: 'lock' })
    forget(); error = ''
    try { await request } catch { error = 'Browser locked. If the server is unreachable, it locks after 10 minutes.' }
  }
  function pickerOptions(): Option[] {
    if (!data) return []
    if (modal === 'category') return data.categories.map(c => ({ id: c.id, name: c.name, detail: c.category_group_name }))
    if (modal === 'payee') return data.payees
    if (modal === 'account') return data.accounts
    return []
  }
  async function pick(id: string) {
    if (modal === 'account') { skipped = []; await act({ action: 'account', id }) }
    if (modal === 'category') { category = id; edited = true }
    if (modal === 'payee') { payee = id; edited = true }
    modal = null; await tick(); reviewElement?.focus()
  }
  function openPicker(kind: 'category' | 'payee') { if (current && !special(current) && !busy) modal = kind }
  function keydown(event: KeyboardEvent) {
    lastActivity = Date.now()
    if (event.repeat || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || !data) return
    if (modal) return
    if ((event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]')) return
    const key = event.key.toLowerCase()
    const actions: Record<string, () => void> = {
      enter: () => void approve(), '1': () => { if (picks[0]) void approve(picks[0]) },
      '2': () => { if (picks[1]) void approve(picks[1]) }, '3': () => { if (picks[2]) void approve(picks[2]) },
      c: () => openPicker('category'), p: () => openPicker('payee'), s: skip, u: () => void undo(),
      a: () => { if (!busy) modal = 'account' }, r: () => void sync(),
      ',': () => modal = 'settings', l: () => void lock(), '?': () => modal = 'shortcuts',
    }
    // Native focused buttons retain Enter/Space activation.
    if (key === 'enter' && (event.target as HTMLElement)?.closest('button, a')) return
    if (actions[key]) { event.preventDefault(); actions[key]() }
  }
  function money(amount: number) {
    return new Intl.NumberFormat(undefined, currency ? { style: 'currency', currency } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount / 1000)
  }
  function dateLabel(date: string) { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T12:00:00`)) }
  function focus(node: HTMLElement) { node.focus() }
</script>

<svelte:window onkeydown={keydown} onpointerdown={() => lastActivity = Date.now()} />

<div class="app-shell">
  <header>
    <span class="brand">YNAB Plus</span>
    <nav aria-label="App controls">
      {#if data}
        <span class="sync-state" aria-live="polite">{syncing ? 'Syncing' : data.pending ? `${data.pending} pending` : data.synced_at ? 'Synced' : ''}</span>
        <Button icon="sync" label="Sync" shortcut="R" disabled={busy || !data.plan_id} onclick={() => void sync()} />
        <Button icon="undo" label="Undo" shortcut="U" disabled={busy || !data.can_undo} onclick={() => void undo()} />
        <span class="nav-divider"></span>
        <Button icon="keyboard" label="Shortcuts" shortcut="?" onclick={() => modal = 'shortcuts'} />
      {/if}
      <Button icon="settings" label="Settings" shortcut="," onclick={() => modal = 'settings'} />
      {#if data}<Button icon="lock" label="Lock" shortcut="L" onclick={() => void lock()} />{/if}
    </nav>
  </header>

  {#if error}<div class="error" role="alert"><span>{error}</span><Button icon="close" label="Dismiss error" onclick={() => error = ''} /></div>{/if}

  {#if !data}
    <main class="unlock-page">
      <form class="unlock-card" onsubmit={(event) => { event.preventDefault(); void unlock() }}>
        <div class="lock-mark"><Icon name="lock" /></div>
        <h1>{exists ? 'Unlock' : 'Create your vault'}</h1>
        <p class="muted">{exists ? 'Your data stays on this computer.' : 'Encrypted locally. Only your passphrase unlocks it.'}</p>
        <label>Passphrase<input use:focus type="password" bind:value={password} autocomplete={exists ? 'current-password' : 'new-password'} minlength={exists ? 1 : 14} required disabled={!ready || busy} /></label>
        {#if !exists}
          <label>Confirm passphrase<input type="password" bind:value={confirmation} autocomplete="new-password" minlength="14" required disabled={!ready || busy} /></label>
          <p class="field-note">At least 14 characters. No reset if you lose it.</p>
        {/if}
        <Button type="submit" primary disabled={!ready || busy}>{busy ? 'Unlocking…' : exists ? 'Unlock' : 'Create vault'}</Button>
      </form>
    </main>
  {:else}
    <main class="workspace" bind:this={reviewElement} tabindex="-1">
      <div class="queue-heading">
        <div>
          <span class="eyebrow">{currentPlan?.name ?? 'Review'}</span>
          <button class="account-button" disabled={busy || !data.accounts.length} onclick={() => modal = 'account'} title="Choose account (A)">{currentAccount?.name ?? 'Choose account'}<Icon name="chevron" /></button>
        </div>
        {#if data.plan_id}<span class="count">{remaining} to review</span>{/if}
      </div>

      {#if data.conflicts}
        <div class="conflict-banner"><span>{data.conflicts} changed in YNAB</span><Button disabled={busy} onclick={() => void act({ action: 'discard_conflicts' })}>Discard conflicting edits</Button></div>
      {/if}

      {#if !data.connected || !data.plan_id}
        <section class="empty-state"><h1>{data.connected ? 'Choose your plan' : 'Connect YNAB'}</h1><Button primary onclick={() => modal = 'settings'}>{data.connected ? 'Choose plan' : 'Connect'}</Button></section>
      {:else if current}
        <article class="transaction" aria-label="Transaction to review">
          <div class="transaction-top"><time datetime={current.date}>{dateLabel(current.date)}</time>{#if !currency}<span>Currency unavailable</span>{/if}</div>
          <div class="amount">{money(current.amount)}</div>
          <h1 class="payee-title">{payeeName}</h1>
          {#if current.import_payee_name_original || current.import_payee_name}<p class="bank-description">{current.import_payee_name_original ?? current.import_payee_name}</p>{/if}
          {#if current.memo}<p class="memo">{current.memo}</p>{/if}

          {#if special(current)}
            <div class="special-transaction">
              <span>{current.subtransactions.length ? 'Split transaction' : current.transfer_account_id ? 'Transfer' : current.cleared === 'reconciled' ? 'Reconciled' : 'Loan transaction'}</span>
              <a href="https://app.ynab.com/" target="_blank" rel="noreferrer">Edit in YNAB<Icon name="external" /></a>
            </div>
            {#if current.subtransactions.length}
              <div class="splits">{#each current.subtransactions.filter(s => !s.deleted) as split}<div><span>{data.categories.find(c => c.id === split.category_id)?.name ?? 'Uncategorized'}</span><span>{money(split.amount)}</span></div>{/each}</div>
            {/if}
          {:else}
            <div class="fields">
              <button class="field-button" disabled={busy} onclick={() => openPicker('payee')}><span><small>Payee</small><strong>{payeeName}</strong></span><kbd>P</kbd></button>
              <button class="field-button" disabled={busy} onclick={() => openPicker('category')}><span><small>Category</small><strong>{categoryName}</strong></span><kbd>C</kbd></button>
            </div>
          {/if}

          <div class="review-actions">
            <Button icon="skip" shortcut="S" disabled={busy} onclick={skip}>Skip</Button>
            <Button primary icon="check" shortcut="Enter" disabled={busy || (!special(current) && (!payee || !category))} onclick={() => void approve()}>{edited ? 'Save & approve' : 'Approve'}</Button>
          </div>
        </article>

        {#if picks.length}
          <section class="suggestions" aria-label="Suggestions">
            <div class="suggestion-heading"><h2>Suggestions</h2><small>Choose & approve</small></div>
            {#each picks as suggestion, i}
              <button class="suggestion" disabled={busy} onclick={() => void approve(suggestion)}>
                <kbd>{i + 1}</kbd><span class="suggestion-copy"><strong>{suggestion.category}</strong><span>{suggestion.payee}</span></span><small>{suggestion.reason}</small><Icon name="check" />
              </button>
            {/each}
          </section>
        {/if}
      {:else}
        <section class="empty-state">
          <div class="complete-mark"><Icon name="check" /></div>
          <h1>{data.queue.length ? 'All remaining skipped' : data.pending ? 'Review complete' : 'All caught up'}</h1>
          {#if data.pending}<p class="muted">{data.pending} {data.pending === 1 ? 'change' : 'changes'} waiting to sync</p><Button primary icon="sync" disabled={busy} onclick={() => void sync()}>Sync now</Button>{/if}
          {#if data.queue.length}<Button primary onclick={() => skipped = []}>Review skipped</Button>{/if}
        </section>
      {/if}
      <footer>
        <span>{data.history_count ? `${data.history_count.toLocaleString()} past transactions` : ''}</span>
        {#if skipped.length && current}<button class="text-button" onclick={() => skipped = []}>{skipped.length} skipped</button>{/if}
      </footer>
    </main>
  {/if}
</div>

{#if modal === 'settings'}
  <Modal title="Settings" onclose={() => { modal = null; token = '' }} wide>
    {#if error}<p class="modal-error" role="alert">{error}</p>{/if}
    <section class="settings-section">
      <label class="setting-row">Appearance<select bind:value={appearance}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <div class="setting-label">Theme</div>
      <div class="theme-grid">
        {#each THEME_OPTIONS as preset}
          <button class="theme-option" class:chosen={theme === preset.id} aria-pressed={theme === preset.id} onclick={() => theme = preset.id}>
            <span class="swatches">{#each preset.swatches as swatch}<span style:background={swatch}></span>{/each}</span><span>{preset.name}</span>
          </button>
        {/each}
      </div>
      {#if theme === 'random'}<p class="field-note">A different theme each day.</p>{/if}
    </section>
    {#if data}
      <section class="settings-section">
        <h3>YNAB</h3>
        <form onsubmit={async (event) => { event.preventDefault(); if (await act({ action: 'token', token })) token = '' }}>
          <label>{data.connected ? 'Replace access token' : 'Personal access token'}<input type="password" bind:value={token} autocomplete="off" spellcheck="false" required placeholder={data.connected ? 'New token' : 'Paste token'} /></label>
          <div class="token-actions"><a href="https://app.ynab.com/settings/developer" target="_blank" rel="noreferrer">Get a token<Icon name="external" /></a><Button type="submit" primary disabled={busy || !token}>{data.connected ? 'Replace' : 'Connect'}</Button></div>
        </form>
        {#if data.connected}
          <label class="setting-row">Plan<select value={data.plan_id} disabled={busy || !!data.pending} onchange={async (event) => { skipped = []; if (await act({ action: 'plan', id: event.currentTarget.value })) modal = null }}><option value="" disabled>Choose plan</option>{#each data.plans as plan}<option value={plan.id}>{plan.name}</option>{/each}</select></label>
        {/if}
      </section>
      <p class="field-note">Locks after 10 minutes of inactivity. Your passphrase is never saved.</p>
    {/if}
  </Modal>
{:else if modal === 'shortcuts'}
  <Modal title="Shortcuts" onclose={() => modal = null}>
    <div class="shortcut-list">{#each shortcuts as [key, label]}<div><span>{label}</span><kbd>{key}</kbd></div>{/each}</div>
  </Modal>
{:else if modal}
  <Picker title={modal === 'category' ? 'Category' : modal === 'payee' ? 'Payee' : 'Account'} options={pickerOptions()} onpick={(id) => void pick(id)} onclose={() => modal = null} />
{/if}
