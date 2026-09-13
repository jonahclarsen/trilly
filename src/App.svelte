<script lang="ts">
  import { onMount, tick, untrack } from 'svelte'
  import { diagnosticsReport, diagnosticVersion, receiveDiagnostics, recordDiagnostic } from './lib/diagnostics'
  import extensionManifest from '../chromium-extension/manifest.json'
  import { reviewColumns, sortReviewRows, orderedReviewQueue, type ReviewSortColumn, type ReviewSortDirection } from './lib/review-sort'
  import { businessRows } from './lib/business'
  import Button from './lib/Button.svelte'
  import { purchaseHistoryLinks, paypalDescription } from './lib/purchase-history'
  import PurchaseHistory from './lib/PurchaseHistory.svelte'
  import GooglePayee from './lib/GooglePayee.svelte'
  import CopyAddress from './lib/CopyAddress.svelte'
  import AmazonReview from './lib/AmazonReview.svelte'
  import { amazonPayee, emptyAmazon, isAmazon, mergeAmazon, type AmazonStore, type AmazonStatus } from './lib/amazon'
  import { amazonCommand, listenAmazon } from './lib/amazon-bridge'
  import '../chromium-extension/parser.js'
  import Icon from './lib/Icon.svelte'
  import Modal from './lib/Modal.svelte'
  import Picker from './lib/Picker.svelte'
  import { titleCase } from './lib/title-case'
  import LogoSettings from './lib/LogoSettings.svelte'
  import Wordmark from './lib/Wordmark.svelte'
  import { project, type QueuedAction } from './lib/optimistic'
  import { readLogo, saveLogo } from './lib/logo'
  import { api, ApiError, setSession, hasSession, shouldAutoUnlock } from './lib/api'
  import { applyAppearance, readPreferences, localDate, tomorrow, type Appearance } from './lib/appearance'
  import { THEME_OPTIONS, type ThemeId } from './lib/themes'
  import { reviewSelection } from './lib/review-selection'
  import { shortcuts, suggestionIndex, menuKeys, merchantLinkKey, googlePayeeKey } from './lib/shortcuts'
  import { special, type Snapshot, type Suggestion, type Option, type Transaction } from './lib/types'

  let amazon = $state<AmazonStore>(emptyAmazon())
  let amazonReady = $state(false)
  let amazonVersionWarning = $state('')
  let amazonJob = $state('')
  let amazonCollectedTargets = $state<string[]>([])
  let amazonJobTargets: string[] = []
  let amazonCompleting = ''
  let amazonStatus = $state<AmazonStatus>({ running: false, pages: 0, orders: 0, queued: 0, active: 0, message: '', paused: [] })
  let amazonMessage = $state('')
  let amazonSetup = $state(false)
  let amazonHTML = $state('')
  let amazonOrderURL = $state('')
  let amazonPasteMarket = $state('amazon.ca')
  let amazonPasteBusy = $state(false)
  let amazonDraft = $state<string | null>(null)
  let amazonMarket = $state<string | null>(null)
  let amazonPayment = $state<string | undefined>()
  let amazonMemoTouched = $state(false)
  let amazonPayeeTouched = $state(false)
  let amazonScope = ''
  let amazonGeneration = 0
  let amazonImports = Promise.resolve()
  const amazonPackets = new Set<string>()
  const amazonPendingPackets = new Set<string>()
  function stopAmazon() {
    if (amazonJob) amazonCommand('STOP', { job: amazonJob })
    amazonJob = ''; amazonStatus = { ...amazonStatus, running: false, paused: [] }
  }
  async function startAmazon() {
    if (!data || !amazonTargets.length || amazonPasteBusy || busy || saving || syncing || saveFailed) return
    if (!amazonReady) { amazonSetup = true; amazonCommand('PING'); return }
    // Invalidate old packets and finish their writes before clearing the vault.
    // Never start a replacement job unless that deletion has been confirmed.
    if (!await clearAmazon() || !data || !amazonTargets.length) return
    amazonJob = crypto.randomUUID(); amazonMessage = ''
    amazonJobTargets = amazonTargets.map(t => t.id)
    amazonStatus = { running: true, pages: 0, orders: 0, queued: 0, active: 0, message: 'Opening Amazon…', paused: [] }
    amazonCommand('START', { job: amazonJob, oldest: amazonTargets.map(t => t.date).sort()[0], priority: current?.amount, cached: [] })
  }
  async function saveAmazon(records: AmazonStore, plan: string, generation: number) {
    if (generation !== amazonGeneration || data?.plan_id !== plan) return false
    const saved = await api<{ retained: boolean }>('amazon', { plan_id: plan, ...records })
    if (generation !== amazonGeneration || data?.plan_id !== plan) return false
    amazon = saved.retained ? mergeAmazon(amazon, records) : emptyAmazon()
    return true
  }
  $effect(() => {
    if (data?.amazon_cleared) untrack(() => {
      stopAmazon(); amazonGeneration++; amazonPackets.clear(); amazon = emptyAmazon(); amazonCollectedTargets = []
      amazonDraft = null; amazonMarket = null; amazonPayment = undefined
    })
  })
  function receiveAmazon(message: Record<string, any>) {
    if (message.type === 'DIAGNOSTICS') { receiveDiagnostics(message.events); return }
    if (message.type === 'READY') {
      diagnosticVersion(message.version)
      amazonReady = message.version === extensionManifest.version
      amazonVersionWarning = amazonReady ? '' : `(installed: ${typeof message.version === 'string' ? message.version.slice(0, 32) : 'unknown'}; required: ${extensionManifest.version})`
      if (!amazonReady && amazonJob) stopAmazon()
      return
    }
    if (message.type === 'STATUS' && message.job !== amazonJob) { if (message.running) amazonCommand('STOP', { job: message.job }); return }
    if (!data || !amazonJob || message.job !== amazonJob) return
    if (message.type === 'STATUS') {
      amazonStatus = message as AmazonStatus
      if (message.complete === true && amazonCompleting !== amazonJob) {
        const job = amazonJob, generation = amazonGeneration, plan = data.plan_id, targets = [...amazonJobTargets]
        amazonCompleting = job
        amazonImports = amazonImports.then(async () => {
          if (generation !== amazonGeneration || data?.plan_id !== plan) return
          const saved = await api<{ retained: boolean }>('amazon', { plan_id: plan, completed_targets: targets })
          if (generation !== amazonGeneration || data?.plan_id !== plan) return
          amazonCollectedTargets = saved.retained ? [...new Set([...amazonCollectedTargets, ...targets])] : []
          if (amazonJob === job) stopAmazon()
        }).catch(e => { amazonCompleting = ''; handleError(e) })
      }
      return
    }
    if (message.type === 'ERROR') { recordDiagnostic('BRIDGE', 'error', new Error(String(message.message))); amazonMessage = String(message.message); stopAmazon(); return }
    if (message.type !== 'DATA' || typeof message.packet !== 'string' || !Array.isArray(message.orders) || !Array.isArray(message.payments)) return
    const packet = message.packet, job = amazonJob, generation = amazonGeneration, plan = data.plan_id
    if (amazonPackets.has(packet)) { amazonCommand('ACK', { job, packet }); return }
    if (amazonPendingPackets.has(packet)) return
    amazonPendingPackets.add(packet)
    amazonImports = amazonImports.then(async () => {
      if (generation !== amazonGeneration || data?.plan_id !== plan) return
      if (amazonPackets.has(packet)) { amazonCommand('ACK', { job, packet }); return }
      if (await saveAmazon({ orders: message.orders, payments: message.payments }, plan, generation)) {
        amazonPackets.add(packet); amazonCommand('ACK', { job, packet })
      }
    }).catch(e => { if (generation === amazonGeneration) { amazonMessage = 'Amazon details could not be saved. Fetch again to retry.'; stopAmazon(); amazonGeneration++; handleError(e) } }).finally(() => amazonPendingPackets.delete(packet))
  }
  async function pasteAmazon() {
    if (!data || amazonPasteBusy || !amazonHTML.trim()) return
    amazonPasteBusy = true; amazonMessage = ''
    const plan = data.plan_id, generation = amazonGeneration
    try {
      if (amazonHTML.length > 5_000_000) throw new Error('Paste one Amazon page at a time (up to 5 MB).')
      // Template contents stay inert: no scripts execute and no images are loaded.
      const template = document.createElement('template'); template.innerHTML = amazonHTML
      const parser = (globalThis as any).TrillyAmazonParser
      const base = `https://www.${amazonPasteMarket}/`
      const payments = parser.payments(template.content, base).payments
      if (amazonOrderURL && parser.market(amazonOrderURL) !== amazonPasteMarket) throw new Error('Order URL must belong to the selected Amazon marketplace.')
      const order = parser.order(template.content, amazonOrderURL || base)
      if (order) for (const item of order.items) delete item.image_url
      if (!payments.length && !order) throw new Error('No supported details found. For an order fragment, include its Amazon order URL.')
      if (await saveAmazon({ payments, orders: order ? [order] : [] }, plan, generation)) { amazonHTML = ''; amazonOrderURL = ''; amazonMessage = 'Amazon details saved.' }
    } catch (e) { amazonMessage = e instanceof Error ? e.message : 'Could not read Amazon HTML.' }
    finally { amazonPasteBusy = false }
  }
  async function clearAmazon(): Promise<boolean> {
    if (!data || amazonPasteBusy) return false
    stopAmazon(); amazonGeneration++; amazonPasteBusy = true
    const plan = data.plan_id, generation = amazonGeneration
    try {
      await amazonImports
      if (generation !== amazonGeneration || data?.plan_id !== plan) return false
      await api('amazon', { plan_id: plan, clear: true, payments: [], orders: [] })
      if (generation !== amazonGeneration || data?.plan_id !== plan) return false
      data = { ...data, amazon_assignments: [] }
      amazon = emptyAmazon(); amazonDraft = null; amazonMarket = null; amazonPayment = undefined
      amazonCollectedTargets = []; amazonPackets.clear(); amazonCompleting = ''; amazonJobTargets = []
      amazonMessage = 'Collected Amazon data cleared.'
      return true
    } catch (e) { if (generation === amazonGeneration) handleError(e); return false }
    finally { amazonPasteBusy = false }
  }
  function applyAmazonDraft(memo: string, marketplace: string | null, automatic: boolean, paymentId?: string) {
    if (!current) return
    amazonPayment = paymentId
    if (!automatic || !amazonMemoTouched) {
      if (!automatic && memo) amazonMemoTouched = true
      if (!current.memo || !automatic) amazonDraft = memo || null
    }
    if (!amazonPayeeTouched && !special(current)) {
      amazonMarket = marketplace
      const found = amazonPayee(data?.payees ?? [], marketplace)
      payee = found?.id ?? current.payee_id
    }
  }
  $effect(() => {
    const plan = data?.plan_id ?? ''
    untrack(() => {
      if (plan === amazonScope) return
      stopAmazon(); amazonScope = plan; amazonGeneration++; amazon = emptyAmazon(); amazonCollectedTargets = []; amazonPackets.clear(); amazonHTML = ''
      const generation = amazonGeneration
      if (plan) void api<AmazonStore & { plan_id: string; collected_targets?: string[] }>('amazon').then(result => {
        if (generation === amazonGeneration && result.plan_id === plan) { amazon = mergeAmazon(result, amazon); amazonCollectedTargets = result.collected_targets ?? [] }
      }).catch(e => { if (generation === amazonGeneration) handleError(e) })
    })
  })
  $effect(() => { const amount = current?.amount; if (amazonJob) amazonCommand('PRIORITY', { job: amazonJob, amount }) })

  const preferences = readPreferences()
  let theme = $state<ThemeId>(preferences.theme)
  let appearance = $state<Appearance>(preferences.appearance)
  let systemDark = $state(matchMedia('(prefers-color-scheme: dark)').matches)
  let randomStart = $state(preferences.randomStart)
  let logo = $state(readLogo())
  let replacingToken = $state(false)
  let now = $state(Date.now())
  const IDLE_TIMEOUT_MS = 6 * 60 * 60 * 1000
  let ready = $state(false)
  // Keep startup covered until the first review is ready; later navigation stays immediate.
  let workspaceReady = $state(false)
  let unlockMode = $state<'macos' | 'migration' | 'unsupported'>('macos')
  let data = $state<Snapshot | null>(null)
  let legacyPassphrase = $state('')
  let token = $state('')
  let busy = $state(false)
  const startupLoading = $derived(!workspaceReady && unlockMode === 'macos' && (!ready || busy || !!data))
  let syncing = $state(false)
  // Replay pending edits over each server response so older responses cannot erase newer edits.
  let saving = $state(0)
  let saveFailed = $state(false)
  let confirmed: Snapshot | null = null
  let events: QueuedAction[] = []
  let draining = false
  const suggestionCache = new Map<string, Promise<Suggestion[]>>()
  let suggestionVersion = $state(0)
  function matches(id: string) {
    let request = suggestionCache.get(id)
    if (!request) {
      request = api<Suggestion[]>(`suggestions/${encodeURIComponent(id)}`)
      suggestionCache.set(id, request)
      request.catch(() => { if (suggestionCache.get(id) === request) suggestionCache.delete(id) })
    }
    return request
  }
  let error = $state('')
  let modal = $state<'settings' | 'shortcuts' | 'category' | 'payee' | 'account' | 'business' | 'expense' | 'description' | null>(null)
  let memoDraft = $state('')
  let memoId = $state('')
  let expenseId = $state('')
  let description = $state('')
  let expenseNote = $state('')
  let businessMessage = $state('')
  let showArchived = $state(false)
  const expenses = $derived(data?.business_expenses ?? [])
  const activeExpenses = $derived(expenses.filter(e => !e.archived))
  const expenseSaved = $derived(expenses.some(e => e.plan_id === data?.plan_id && e.transaction_id === currentId))
  function openExpense() {
    if (!current || busy || saveFailed || expenseSaved) return
    expenseId = current.id; description = newPayee ?? data?.payees.find(p => p.id === payee)?.name ?? current.payee_name ?? ''; expenseNote = ''; modal = 'expense'
  }
  function openDescription() {
    if (!current || busy || saveFailed) return
    memoId = current.id; memoDraft = displayedMemo; modal = 'description'
  }
  async function saveDescription() {
    if (!data || busy || saveFailed || !memoId) return
    const amazonEdit = !!current && current.id === memoId && isAmazon(current)
    if (amazonEdit) memoDraft = memoDraft.toLowerCase()
    enqueue({ body: { action: 'description', id: memoId, description: memoDraft } })
    reviewHistory = [...activeReviewHistory, { type: 'edit' }]
    if (current?.id === memoId) descriptionFixed = true
    if (amazonEdit) { amazonDraft = null; amazonMemoTouched = true }
    modal = null; memoDraft = ''; memoId = ''; await tick(); reviewElement?.focus()
  }
  async function saveExpense() {
    if (!data || busy || saveFailed || !expenseId || !description.trim() || expenseSaved) return
    enqueue({ body: { action: 'business_expense', id: expenseId, description, note: expenseNote } })
    modal = null; description = ''; expenseNote = ''; expenseId = ''; await tick(); reviewElement?.focus()
  }
  async function copyExpenses() {
    try { await navigator.clipboard.writeText(businessRows(activeExpenses)); businessMessage = 'Copied. Paste into your sheet.' }
    catch { businessMessage = 'Copy failed. Allow clipboard access and try again.' }
  }
  async function archiveExpenses() {
    if (await act({ action: 'archive_business_expenses' })) businessMessage = 'Archived. Undo restores this batch.'
  }
  async function undoBusiness() {
    if (!data?.can_undo_business && !data?.can_undo_archive) return
    if (await act({ action: 'undo_business_expense' })) businessMessage = 'Business expense change undone.'
  }
  async function removeExpense(plan_id: string, id: string) {
    if (await act({ action: 'remove_business_expense', plan_id, id })) businessMessage = 'Expense removed. Undo restores it.'
  }
  let view = $state<'transaction' | 'list'>('transaction')
  let selectedId = $state<string | null>(null)
  let skipped = $state<string[]>([])
  // Local skips share ordering with persisted edits, but never change backend data.
  let reviewHistory = $state<({ type: 'skip'; id: string } | { type: 'edit' })[]>([])
  const activeReviewHistory = $derived(reviewHistory.filter(event => event.type === 'edit' ||
    (skipped.includes(event.id) && data?.queue.some(t => t.id === event.id))))
  const canUndoSkip = $derived(activeReviewHistory.at(-1)?.type === 'skip')
  function clearSkipped() { skipped = []; reviewHistory = []; selectedId = null }

  let sortColumn = $state<ReviewSortColumn>('date')
  let sortDirection = $state<ReviewSortDirection>('ascending')
  const reviewRows = $derived(sortReviewRows(data?.review_rows ?? data?.queue ?? [], sortColumn, sortDirection, skipped))
  const reviewQueue = $derived(orderedReviewQueue(reviewRows, data?.queue ?? []))
  function sortBy(column: ReviewSortColumn) {
    sortDirection = column === sortColumn && sortDirection === 'ascending' ? 'descending' : 'ascending'
    sortColumn = column
    selectedId = null
  }
  function showTransactionView() { selectedId = null; view = 'transaction' }
  async function openTransaction(id: string) { selectedId = id; skipped = skipped.filter(value => value !== id); view = 'transaction'; await tick(); reviewElement?.focus() }
  let picks = $state<Suggestion[]>([])
  let picksStatus = $state<'loading' | 'ready' | 'error'>('ready')
  let payee = $state<string | null>(null)
  let newPayee = $state<string | null>(null)
  let category = $state<string | null>(null)
  let edited = $state(false)
  let payeeFixed = $state(false)
  let categoryFixed = $state(false)
  let descriptionFixed = $state(false)
  let sessionEpoch = 0
  let syncTimer: ReturnType<typeof setTimeout>
  let lastActivity = Date.now()
  let reviewElement = $state<HTMLElement>()
  const current = $derived(reviewQueue.find(t => t.id === selectedId) ?? reviewQueue.find(t => !skipped.includes(t.id)))
  const amazonTargets = $derived((data?.amazon_targets ?? data?.queue ?? []).filter(isAmazon))
  const currentId = $derived(current?.id)
  const descriptionPending = $derived(!!current && !!data?.description_pending?.includes(current.id))
  const remaining = $derived(data?.queue.filter(t => !skipped.includes(t.id)).length ?? 0)
  const currentAccount = $derived(data?.accounts.find(a => a.id === data?.account_id))
  const currentPlan = $derived(data?.plans.find(p => p.id === data?.plan_id))
  const currency = $derived(currentPlan?.currency_format?.iso_code)
  const categoryName = $derived(data?.categories.find(c => c.id === category)?.name ?? current?.category_name ?? 'Choose category')
  const amazonPayeeName = $derived(amazonMarket ? amazonPayee(data?.payees ?? [], amazonMarket)?.name ?? amazonMarket : null)
  const payeeName = $derived(newPayee ?? amazonPayeeName ?? data?.payees.find(p => p.id === payee)?.name ?? current?.payee_name ?? 'Choose payee')
  const paypalDraft = $derived(current && !descriptionFixed ? paypalDescription(
    current.memo, payeeName, current.payee_name, current.import_payee_name_original, current.import_payee_name,
  ) : null)
  const displayedMemo = $derived(amazonDraft ?? paypalDraft ?? current?.memo ?? '')
  const searchPayee = $derived(newPayee ?? amazonPayeeName ?? data?.payees.find(p => p.id === payee)?.name ?? current?.payee_name ?? current?.import_payee_name_original ?? current?.import_payee_name ?? '')
  let googlePayee = $state<{ open: () => void }>()

  $effect(() => { applyAppearance(theme, appearance, randomStart) })
  $effect(() => { saveLogo(logo) })
  $effect(() => {
    if (ready && !data && !modal) queueMicrotask(() => document.querySelector<HTMLInputElement>('.unlock-card input')?.focus())
  })
  $effect(() => {
    const id = currentId
    untrack(() => {
      const t = current
      amazonDraft = null; amazonMarket = null; amazonPayment = undefined; amazonMemoTouched = false; amazonPayeeTouched = false
      payeeFixed = false; categoryFixed = false; descriptionFixed = false
      newPayee = null; payee = t?.payee_id ?? null; category = t?.category_id ?? null; edited = false; picks = []
    })
  })
  $effect(() => {
    const snapshot = data
    const initialSyncing = syncing
    const ordered = reviewQueue
    const id = currentId
    suggestionVersion
    let cancelled = false
    untrack(() => {
      picksStatus = 'ready'
      for (const t of ordered.filter(t => !skipped.includes(t.id) && !special(t)).slice(0, 6)) void matches(t.id).catch(() => {})
      if (snapshot && id && current && !special(current)) {
        const epoch = sessionEpoch
        picksStatus = 'loading'
        matches(id).then(result => {
          if (!cancelled && sessionEpoch === epoch && currentId === id) {
            picks = result; picksStatus = 'ready'
            if (!initialSyncing) workspaceReady = true
          }
        }).catch(e => {
          if (!cancelled && sessionEpoch === epoch && currentId === id) {
            picksStatus = 'error'; handleError(e)
            if (!initialSyncing && data) workspaceReady = true
          }
        })
      } else if (snapshot && !initialSyncing) workspaceReady = true
    })
    return () => { cancelled = true }
  })

  onMount(() => {
    const unlistenAmazon = listenAmazon(receiveAmazon)
    const amazonPing = setInterval(() => amazonCommand('PING', { job: amazonJob }), 10000)
    // Capture shortcuts before focused controls can consume bubbling key events.
    window.addEventListener('keydown', keydown, true)
    let mounted = true
    api<{ mode: 'macos' | 'migration' | 'unsupported' }>('status').then(result => {
      if (!mounted) return
      unlockMode = result.mode; ready = true
      if (hasSession()) {
        busy = true
        void api<Snapshot>('state').then(snapshot => {
          if (!mounted) return
          data = snapshot
          if (!snapshot.connected) modal = 'settings'
          if (snapshot.pending) scheduleSync()
        }).catch(error => { if (mounted) handleError(error) }).finally(() => { if (mounted) busy = false })
      } else if (unlockMode === 'macos' && shouldAutoUnlock()) void unlock()
    }).catch(error => { if (mounted) { ready = true; handleError(error) } })
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => {
      now = Date.now(); systemDark = media.matches
      if (randomStart && randomStart <= localDate()) { theme = 'random'; randomStart = '' }
      applyAppearance(theme, appearance, randomStart)
    }
    media.addEventListener('change', update)
    const timer = setInterval(() => {
      update()
      if (data && Date.now() - lastActivity >= IDLE_TIMEOUT_MS) void lock()
    }, 10_000)
    const wake = () => {
      update()
      if (data && Date.now() - lastActivity >= IDLE_TIMEOUT_MS) void lock()
    }
    document.addEventListener('visibilitychange', wake)
    return () => { stopAmazon(); unlistenAmazon(); clearInterval(amazonPing); window.removeEventListener('keydown', keydown, true); mounted = false; sessionEpoch++; media.removeEventListener('change', update); clearInterval(timer); clearTimeout(syncTimer); document.removeEventListener('visibilitychange', wake) }
  })

  function forget() {
    stopAmazon(); amazonGeneration++; amazonScope = ''; amazon = emptyAmazon(); amazonHTML = ''; amazonOrderURL = ''; amazonDraft = null; amazonMarket = null; amazonPayment = undefined; amazonMessage = ''; amazonPackets.clear(); amazonSetup = false
    sessionEpoch++; setSession(''); data = null; workspaceReady = false; legacyPassphrase = ''; token = ''; replacingToken = false; modal = null
    description = ''; expenseNote = ''; expenseId = ''; memoDraft = ''; memoId = ''; businessMessage = ''; showArchived = false
    events = []; saving = 0; draining = false; confirmed = null; saveFailed = false; suggestionCache.clear()
    picks = []; clearSkipped(); payee = null; newPayee = null; category = null; clearTimeout(syncTimer); busy = false; syncing = false
  }
  function handleError(e: unknown) {
    if (e instanceof ApiError && e.status === 401) forget()
    error = e instanceof Error ? e.message : 'Something went wrong'
  }
  async function unlock() {
    if (busy) return
    error = ''
    if (unlockMode === 'unsupported') return
    busy = true
    let epoch = sessionEpoch
    try {
      const result = await api<{ session: string; state: Snapshot }>('unlock', unlockMode === 'migration' ? { legacy_passphrase: legacyPassphrase } : {})
      if (epoch !== sessionEpoch) return
      setSession(result.session); epoch = ++sessionEpoch; data = result.state; unlockMode = 'macos'; lastActivity = Date.now()
      legacyPassphrase = ''
      if (!data.connected) modal = 'settings'
      busy = false
      if (data.plan_id) void sync(true)
    } catch (e) { if (epoch === sessionEpoch) handleError(e); legacyPassphrase = '' }
    finally { if (epoch === sessionEpoch) { busy = false } }
  }
  async function act(action: Record<string, unknown>): Promise<boolean> {
    if (busy || saving || syncing || saveFailed || !data) return false
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
  function enqueue(event: QueuedAction) {
    if (!data || saveFailed) return
    if (!events.length) confirmed = data
    if (event.body.action === 'review') reviewHistory = [...activeReviewHistory, { type: 'edit' }]
    events.push(event); saving = events.length
    data = project(data, event)
    void drain()
  }
  async function drain() {
    if (draining) return
    draining = true
    let changed = false
    let descriptionChanged = false
    const epoch = sessionEpoch
    try {
      while (events.length) {
        const event = events[0]!
        syncing = event.body.action === 'sync'
        changed ||= !syncing
        descriptionChanged ||= event.body.action === 'description'
        // The backend requires memo-only edits to sync before another edit of that row.
        // Wait here, while the UI continues to project all queued actions immediately.
        if ((event.body.action === 'review' || event.body.action === 'description') &&
            confirmed?.description_pending?.includes(String(event.body.id))) {
          const synced = await api<Snapshot>('action', { action: 'sync', full: false })
          if (epoch !== sessionEpoch) return
          confirmed = synced
          if (synced.sync_error) throw new Error(synced.sync_error)
          data = events.reduce(project, synced)
        }
        let result = await api<Snapshot>('action', event.body)
        if (epoch !== sessionEpoch) return
        // Undo writes a durable reverse edit. Keep its optimistic transaction
        // visible until that reverse is confirmed, before sending another review.
        if (event.body.action === 'undo' && result.pending) {
          confirmed = result
          result = await api<Snapshot>('action', { action: 'sync', full: false })
          if (epoch !== sessionEpoch) return
          if (result.sync_error) throw new Error(result.sync_error)
        }
        confirmed = result; events.shift(); saving = events.length
        data = events.reduce(project, result)
        if (result.sync_error) error = result.sync_error
        if (event.body.action === 'sync' || event.body.action === 'rename_payee') {
          suggestionCache.clear(); suggestionVersion++
        }
      }
      if (changed) scheduleSync(descriptionChanged ? 0 : 3000)
    } catch (e) {
      if (epoch !== sessionEpoch) return
      events = []; saving = 0; saveFailed = true
      data = confirmed
      handleError(e)
      if (data) error = `Save could not be confirmed. Queued actions stopped. Reload saved state before continuing. ${error}`
    } finally {
      if (epoch === sessionEpoch) { draining = false; syncing = false }
    }
  }
  async function recover() {
    if (busy) return
    busy = true
    const epoch = sessionEpoch
    try {
      const result = await api<Snapshot>('state')
      if (epoch !== sessionEpoch) return
      data = result; confirmed = result; saveFailed = false; error = ''; clearSkipped()
      suggestionCache.clear(); suggestionVersion++
      if (result.pending) scheduleSync()
    } catch (e) { if (epoch === sessionEpoch) handleError(e) }
    finally { if (epoch === sessionEpoch) busy = false }
  }
  async function sync(full = true) {
    if (busy || saving || saveFailed || !data?.plan_id || (!full && !data.pending)) return
    clearTimeout(syncTimer)
    enqueue({ body: { action: 'sync', full } })
  }
  function approve(suggestion?: Suggestion) {
    if (!current || busy || saveFailed || !data) return
    const { payee: selectedPayee, newPayee: selectedNewPayee, category: selectedCategory } = reviewSelection(
      { payee, newPayee, category }, { payee: payeeFixed || !!amazonMarket, category: categoryFixed }, suggestion,
    )
    if (!special(current) && ((!selectedPayee && !amazonMarket && !selectedNewPayee) || !selectedCategory)) return
    const selectedName = selectedNewPayee ?? data.payees.find(p => p.id === selectedPayee)?.name
    const reviewMemo = amazonDraft !== null ? amazonDraft.toLowerCase() : paypalDraft ?? (descriptionFixed ? null : paypalDescription(current.memo, selectedName))
    enqueue({ body: { action: 'review', id: current.id, ...(selectedNewPayee ? { payee_name: selectedNewPayee } : {}), payee_id: selectedPayee, category_id: selectedCategory, ...(amazonPayment ? { amazon_payment_id: amazonPayment } : {}), ...(reviewMemo !== null ? { memo: reviewMemo } : {}), ...(amazonMarket && !special(current) ? { amazon_marketplace: amazonMarket } : {}) } })
    reviewElement?.focus()
  }
  function undo() {
    if (!data || busy || saveFailed) return
    if (modal !== 'business' && canUndoSkip) {
      const previous = activeReviewHistory.at(-1)!
      if (previous.type === 'skip') {
        reviewHistory = activeReviewHistory.slice(0, -1)
        skipped = skipped.filter(id => id !== previous.id)
        selectedId = previous.id; reviewElement?.focus()
      }
      return
    }
    if (data.can_undo_business || data.can_undo_archive) { void undoBusiness(); return }
    if (modal === 'business' || !data.can_undo) return
    const restore = data.undo_transactions?.at(-1)
    reviewHistory = activeReviewHistory.slice(0, -1)
    enqueue({ body: { action: 'undo' }, restore })
    selectedId = restore?.id ?? null; reviewElement?.focus()
  }
  function skip() {
    if (current && !saveFailed && (!busy || syncing)) {
      const id = current.id
      reviewHistory = [...activeReviewHistory, { type: 'skip', id }]
      selectedId = null; skipped = [...skipped, id]; reviewElement?.focus()
    }
  }
  async function lock() {
    const request = api('action', { action: 'lock' })
    forget(); error = ''
    try { await request } catch { error = 'Browser locked. If the server is unreachable, it locks after 6 hours.' }
  }
  function pickerOptions(): Option[] {
    if (!data) return []
    if (modal === 'category') return data.categories.map(c => ({ id: c.id, name: c.name, detail: c.category_group_name, transactionCount: data?.category_transaction_counts?.[c.id] ?? 0 }))
    if (modal === 'payee') return data.payees
    if (modal === 'account') return data.accounts
    return []
  }
  async function pick(id: string) {
    if (modal === 'account') { clearSkipped(); await act({ action: 'account', id }) }
    if (modal === 'category') { category = id; categoryFixed = true; edited = true }
    if (modal === 'payee') { newPayee = null; payee = id; payeeFixed = true; edited = true; amazonPayeeTouched = true; amazonMarket = null }
    modal = null; await tick(); reviewElement?.focus()
  }
  async function createPayee(name: string) {
    newPayee = name; payee = null; payeeFixed = true; edited = true; amazonPayeeTouched = true; amazonMarket = null
    modal = null; await tick(); reviewElement?.focus()
  }
  function openPicker(kind: 'category' | 'payee') { if (current && !special(current) && !busy) modal = kind }
  function keydown(event: KeyboardEvent) {
    lastActivity = Date.now()
    if (event.repeat || event.isComposing || startupLoading) return
    const typing = (event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]')
    if (data && (!modal || modal === 'business') && !typing && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'z') {
      event.preventDefault(); undo(); return
    }
    if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && !modal) {
      const actions: Record<string, () => void> = {
        [menuKeys.settings]: () => modal = 'settings',
        ...(data ? {
          [menuKeys.transaction]: showTransactionView,
          [menuKeys.list]: () => view = 'list',
          [menuKeys.sync]: () => { if (!busy && !saving && !saveFailed && data?.plan_id) void sync() },
          [menuKeys.undo]: undo,
          [menuKeys.business]: () => { businessMessage = ''; showArchived = false; modal = 'business' },
          [menuKeys.help]: () => modal = 'shortcuts',
          [menuKeys.lock]: () => void lock(),
        } : {}),
      }
      // Option changes event.key on macOS, so use the physical letter key.
      const action = actions[event.code.replace(/^Key/, '')]
      if (action) { event.preventDefault(); action() }
      return
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (!data) {
      if (event.key === 'Enter' && !modal && ready && !busy && unlockMode === 'macos') {
        event.preventDefault(); void unlock()
      }
      return
    }
    if (modal === 'business' && !typing && event.key.toLowerCase() === 'u') { event.preventDefault(); void undoBusiness(); return }
    if (modal) return
    if (typing) return
    if (view === 'list' && !['u', 'r', 'a', ',', 'l', '?'].includes(event.key.toLowerCase())) return
    const index = suggestionIndex(event)
    if (index !== undefined) {
      event.preventDefault()
      if (picks[index]) approve(picks[index])
      return
    }
    const key = event.key.toLowerCase()
    const actions: Record<string, () => void> = {
      [merchantLinkKey.toLowerCase()]: () => {
        const link = current && purchaseHistoryLinks(data?.purchase_history_rules, payeeName)[0]
        if (link) window.open(link.url, '_blank', 'noopener,noreferrer')
      },
      enter: () => void approve(),
      [googlePayeeKey.toLowerCase()]: () => googlePayee?.open(),
      d: openDescription, b: openExpense, c: () => openPicker('category'), e: () => openPicker('payee'), s: skip, u: () => void undo(),
      a: () => { if (!busy && !saving && !saveFailed) modal = 'account' }, r: () => void sync(),
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
  function syncLabel(timestamp: string, currentTime: number) {
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return ''
    const day = localDate(date) === localDate(new Date(currentTime)) ? 'today' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
    return `Last synced at ${day}, ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)}`
  }
  let diagnosticsMessage = $state('')
  let diagnosticsFallback = $state('')
  $effect(() => { if (modal === 'settings') { diagnosticsMessage = ''; diagnosticsFallback = ''; amazonCommand('DIAGNOSTICS') } })
  async function copyDiagnostics() {
    const report = diagnosticsReport(extensionManifest.version)
    try { await navigator.clipboard.writeText(report); diagnosticsFallback = ''; diagnosticsMessage = 'Diagnostics copied.' }
    catch { diagnosticsFallback = report; diagnosticsMessage = 'Copy unavailable. Select and copy the report below.' }
  }
  function closeSettings() { modal = null; token = ''; replacingToken = false }
  function focus(node: HTMLElement) { node.focus() }
</script>

<svelte:window onpointerdown={() => lastActivity = Date.now()} />

<div class="app-shell">
  <header>
    <Wordmark value={logo} />
    {#if !startupLoading}
      <nav aria-label="App controls">
        {#if data}
          <div class="view-switch" role="group" aria-label="Transaction views">
            <Button icon="transaction" label="Transaction" altKey={menuKeys.transaction} pressed={view === 'transaction'} onclick={showTransactionView}>Transaction</Button>
            <Button icon="list" label="List" altKey={menuKeys.list} pressed={view === 'list'} onclick={() => view = 'list'}>List</Button>
          </div>
          <span class="sync-state" aria-live="polite">{saveFailed ? 'Save failed' : syncing ? (saving > 1 ? `Syncing · ${saving - 1} saving` : 'Syncing') : saving ? `${saving} saving` : data.pending ? `${data.pending} pending` : data.synced_at ? syncLabel(data.synced_at, now) : ''}</span>
          <Button icon="sync" label="Sync" altKey={menuKeys.sync} disabled={busy || !!saving || saveFailed || !data.plan_id} onclick={() => void sync()}>Sync</Button>
          <Button icon="undo" label="Undo" altKey={menuKeys.undo} disabled={busy || saveFailed || (!canUndoSkip && !data.can_undo && !data.can_undo_business && !data.can_undo_archive)} onclick={() => void undo()}>Undo</Button>
          <Button icon="business" altKey={menuKeys.business} label={`Business expenses (${activeExpenses.length})`} onclick={() => { businessMessage = ''; showArchived = false; modal = 'business' }}>Business</Button>
          <span class="nav-divider"></span>
          <Button icon="keyboard" label="Help" altKey={menuKeys.help} onclick={() => modal = 'shortcuts'}>Help</Button>
        {/if}
        <Button icon="settings" label="Settings" altKey={menuKeys.settings} onclick={() => modal = 'settings'}>Settings</Button>
        {#if data}<Button icon="lock" label="Lock" altKey={menuKeys.lock} onclick={() => void lock()}>Lock</Button>{/if}
      </nav>
    {/if}
  </header>

  {#if error}<div class="error" role="alert"><span>{error}</span><Button icon="close" label="Dismiss error" onclick={() => error = ''} /></div>{/if}

  {#if saveFailed && data}<div class="error" role="status"><span>Review paused until saved state is checked.</span><Button disabled={busy} onclick={() => void recover()}>Reload saved state</Button></div>{/if}

  {#if startupLoading}
    <main class="unlock-page" aria-busy="true">
      <div class="unlock-card" role="status" aria-live="polite">
        <div class="lock-mark"><Icon name="lock" /></div>
        <h1>Loading…</h1>
        <p class="muted">{!data ? 'Opening your Keychain vault…' : syncing ? 'Syncing transactions…' : 'Finding matches in approved history…'}</p>
      </div>
    </main>
  {:else if !data}
    <main class="unlock-page">
      <div class="unlock-card">
        <div class="lock-mark"><Icon name="lock" /></div>
        {#if unlockMode === 'migration'}
          <h1>Switch to macOS unlock</h1>
          <p class="muted">Enter your existing vault passphrase once.</p>
          <form onsubmit={(event) => { event.preventDefault(); void unlock() }}>
            <label>Existing vault passphrase<input use:focus type="password" bind:value={legacyPassphrase} autocomplete="off" required disabled={!ready || busy} /></label>
            <p class="field-note">Your Mac password is entered only in the macOS prompt.</p>
            <Button type="submit" primary disabled={!ready || busy}>{busy ? 'Migrating…' : 'Migrate'}</Button>
          </form>
        {:else if unlockMode === 'unsupported'}
          <h1>macOS required</h1>
          <p class="muted">Trilly uses your Mac’s Keychain to unlock.</p>
        {:else}
          <h1>{busy ? 'Unlocking…' : 'Locked'}</h1>
          <p class="muted">{busy ? 'Opening your Keychain vault…' : 'Open your saved vault.'}</p>
          <Button primary icon="lock" label="Unlock" shortcut="Enter" disabled={!ready || busy} onclick={() => void unlock()}>Unlock</Button>
        {/if}
      </div>
    </main>
  {:else}
    <main class="workspace" class:list-workspace={view === 'list'} bind:this={reviewElement} tabindex="-1">
      <div class="queue-heading">
        <div>
          <span class="eyebrow">{currentPlan?.name ?? 'Review'}</span>
          <button class="account-button" disabled={busy || !!saving || saveFailed || !data.accounts.length} onclick={() => modal = 'account'} title="Choose account (A)">{currentAccount?.name ?? 'Choose account'}<Icon name="chevron" /></button>
        </div>
        {#if data.plan_id}<span class="count">{remaining} to review</span>{/if}
      </div>

      {#if amazonTargets.some(t => !amazonCollectedTargets.includes(t.id)) || amazonStatus.running || amazonMessage || amazonVersionWarning}
        <section class="amazon-toolbar" aria-label="Amazon collection">
          <div><strong>Amazon</strong><span>{amazonTargets.length} transactions across this plan</span></div>
          <div class="amazon-toolbar-actions">
            {#if amazonStatus.running}<Button icon="close" onclick={stopAmazon}>Stop</Button>{:else}<Button icon="sync" disabled={amazonPasteBusy || busy || saving > 0 || syncing || saveFailed || !amazonTargets.length} onclick={() => void startAmazon()}>Fetch Amazon details</Button>{/if}
            <Button icon="settings" onclick={() => amazonSetup = !amazonSetup}>Amazon setup</Button>
          </div>
          {#if amazonStatus.running || amazonStatus.message}<p role="status">{amazonStatus.pages} payment pages · {amazonStatus.orders} orders collected · {amazonStatus.active} tabs · {amazonStatus.queued} queued{amazonStatus.message ? ` · ${amazonStatus.message}` : ''}</p>{/if}
          {#each amazonStatus.paused as pause}<div class="amazon-paused"><span>{pause.marketplace}: {pause.reason}</span><Button onclick={() => amazonCommand('FOCUS', { job: amazonJob, tab: pause.tab })}>Open page</Button><Button onclick={() => amazonCommand('RESUME', { job: amazonJob })}>Resume</Button></div>{/each}
          {#if amazonVersionWarning && !amazonSetup}<p role="alert"><strong>Amazon extension update required {amazonVersionWarning}: <CopyAddress address="chrome://extensions" />, then refresh.</strong></p>{/if}
          {#if amazonMessage}<p role="status">{amazonMessage}</p>{/if}
        </section>
      {/if}
      {#if amazonSetup}
        <section class="amazon-setup" aria-label="Amazon setup">
          <h2>Amazon setup</h2>
          {#if amazonVersionWarning}<p role="alert"><strong>Amazon extension update required {amazonVersionWarning}: <CopyAddress address="chrome://extensions" />, then refresh.</strong></p>{/if}
          <p>In Chrome, open <CopyAddress address="chrome://extensions" /> in the address bar, enable Developer mode, and load the chromium-extension folder from the Trilly repository. Reload Trilly Amazon if already installed. Reload Trilly, then choose Fetch Amazon details. Sign in to Amazon when prompted in its own window.</p>
          <p class="field-note">{amazonReady ? 'Extension connected.' : 'Extension not connected.'}</p>
          <details><summary>Paste Amazon HTML instead</summary><label>Marketplace<select bind:value={amazonPasteMarket}><option value="amazon.ca">amazon.ca</option><option value="amazon.com">amazon.com</option></select></label><label>Order URL (optional, for order fragments)<input type="url" bind:value={amazonOrderURL} placeholder="https://www.amazon.ca/…" /></label><label>Payments page or order details<textarea bind:value={amazonHTML} rows="5" placeholder="Paste copied HTML"></textarea></label><Button disabled={amazonPasteBusy || !amazonHTML.trim()} onclick={() => void pasteAmazon()}>Import HTML</Button></details>
          <Button disabled={amazonPasteBusy || (!amazon.orders.length && !amazon.payments.length)} onclick={() => void clearAmazon()}>Clear collected Amazon data</Button>
        </section>
      {/if}

      {#if data.conflicts}
        <div class="conflict-banner"><span>{data.conflicts} changed in YNAB</span><Button disabled={busy} onclick={() => void act({ action: 'discard_conflicts' })}>Discard conflicting edits</Button></div>
      {/if}

      {#if !data.connected || !data.plan_id}
        <section class="empty-state"><h1>{data.connected ? 'Choose your plan' : 'Connect YNAB'}</h1><Button primary onclick={() => modal = 'settings'}>{data.connected ? 'Choose plan' : 'Connect'}</Button></section>
      {:else if view === 'list'}
        <section aria-label="Transaction list">
          <p class="field-note list-note">Current review batch · {reviewRows.filter(t => t.approved).length} reviewed.</p>
          <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users must be able to scroll the table horizontally.) -->
          <div class="transaction-table" tabindex="0" role="region" aria-label="Review batch table">
            <table>
              <thead><tr>
                {#each reviewColumns as [column, label]}
                  <th scope="col" class:table-amount={column === 'amount'} aria-sort={sortColumn === column ? sortDirection : 'none'}>
                    <button class="sort-header" onclick={() => sortBy(column)} title={`Sort by ${label.toLowerCase()} ${sortColumn === column && sortDirection === 'ascending' ? 'descending' : 'ascending'}`}>
                      {label}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        {#if sortColumn !== column}<path d="m8 9 4-4 4 4M8 15l4 4 4-4" />{:else if sortDirection === 'ascending'}<path d="m6 10 6-6 6 6M12 4v16" />{:else}<path d="m6 14 6 6 6-6M12 4v16" />{/if}
                      </svg>
                    </button>
                  </th>
                {/each}
              </tr></thead>
              <tbody>
                {#each reviewRows as transaction (transaction.id)}
                  <tr class:reviewed={transaction.approved}>
                    <td><time datetime={transaction.date}>{dateLabel(transaction.date)}</time></td>
                    <td>{transaction.payee_name ?? transaction.import_payee_name ?? 'Unknown payee'}</td>
                    <td>{transaction.category_name ?? 'Uncategorized'}</td>
                    <td>{transaction.memo ?? ''}</td>
                    <td class="table-amount">{money(transaction.amount)}</td>
                    <td>{#if transaction.approved}<span>Reviewed</span>{:else}<Button icon="transaction" disabled={busy || saveFailed} onclick={() => openTransaction(transaction.id)}>{skipped.includes(transaction.id) ? 'Skipped · Review' : 'Review'}</Button>{/if}</td>
                  </tr>
                {:else}<tr><td colspan="6" class="table-empty">All caught up. New transactions will appear here after syncing.</td></tr>{/each}
              </tbody>
            </table>
          </div>
        </section>
      {:else if current}
        <article class="transaction" aria-label="Transaction to review">
          <div class="transaction-top">
            <time datetime={current.date}>{dateLabel(current.date)}</time>
            <div class="transaction-top-actions">{#if !currency}<span>Currency unavailable</span>{/if}<GooglePayee bind:this={googlePayee} payee={searchPayee} /></div>
          </div>
          <div class="amount">{money(current.amount)}</div>
          <div class="payee-detail">
            <small>Current payee</small>
            <span class="payee-separator" aria-hidden="true">-</span>
            <h1 class="payee-title">{payeeName}</h1>
          </div>
          {#if current.import_payee_name_original || current.import_payee_name}
            <div class="payee-detail">
              <small>Original bank payee</small>
              <span class="payee-separator" aria-hidden="true">-</span>
              <p class="bank-description">{current.import_payee_name_original ?? current.import_payee_name}</p>
            </div>
          {/if}
          <PurchaseHistory rules={data.purchase_history_rules} payee={payeeName} />

          {#if special(current)}
            <div class="special-transaction">
              <span>{current.subtransactions.length ? 'Split transaction' : current.transfer_account_id ? 'Transfer' : current.cleared === 'reconciled' ? 'Reconciled' : 'Loan transaction'}</span>
              <a href="https://app.ynab.com/" target="_blank" rel="noreferrer">Edit in YNAB<Icon name="external" /></a>
            </div>
            {#if current.subtransactions.length}
              <div class="splits">{#each current.subtransactions.filter(s => !s.deleted) as split}<div><span>{data.categories.find(c => c.id === split.category_id)?.name ?? 'Uncategorized'}</span><span>{money(split.amount)}</span></div>{/each}</div>
            {/if}
          {/if}

          <div class="fields">
            {#if !special(current)}
              <button class="field-button" class:field-fixed={payeeFixed} disabled={busy} onclick={() => openPicker('payee')}><span><small>Payee</small><strong>{payeeName}</strong></span><kbd>E</kbd></button>
              <button class="field-button" class:field-fixed={categoryFixed} disabled={busy} onclick={() => openPicker('category')}><span><small>Category</small><strong>{categoryName}</strong></span><kbd>C</kbd></button>
            {/if}
            <button class="field-button" class:field-fixed={descriptionFixed} disabled={busy || saveFailed} onclick={openDescription} title={displayedMemo || 'Add description'}><span><small>Description</small><strong class="memo">{displayedMemo || 'Add description'}</strong></span><kbd>D</kbd></button>
          </div>
          {#if amazonDraft !== null}<p class="field-note">Amazon description will be saved when you approve.{amazonDraft.endsWith('…') ? ' Shortened to 500 characters; full titles are below.' : ''}</p>{/if}
          {#if isAmazon(current)}{#key current.id}<AmazonReview store={amazon} transaction={current} {currency} targets={amazonTargets} collecting={amazonStatus.running} assignments={data.amazon_assignments ?? []} disabled={busy || saveFailed} onchange={applyAmazonDraft} />{/key}{/if}
          {#if paypalDraft !== null && amazonDraft === null}<p class="field-note">PayPal description will be saved when you approve.</p>{/if}
          {#if descriptionPending}<p class="field-note description-status" role="status">Description queued for sync. You can keep reviewing.</p>{/if}

          {#if !special(current) && (picks.length || picksStatus === 'loading' || picksStatus === 'error')}
            <section class="suggestions" aria-label="Suggestions">
              <div class="suggestion-heading"><h2>Suggestions</h2></div>
              {#if picksStatus === 'loading'}
                <p class="muted" role="status">Finding matches in approved history…</p>
              {:else if picksStatus === 'error'}
                <p class="muted" role="status">Suggestions unavailable. Sync to try again.</p>
              {/if}
              {#each picks as suggestion, i}
                <button class="suggestion" disabled={busy || saveFailed} onclick={() => void approve(suggestion)}>
                  <kbd>{i + 1}</kbd><span class="suggestion-copy"><strong class:suggestion-unused={categoryFixed} aria-label={categoryFixed ? `${suggestion.category} — not applied; category fixed` : undefined}>{suggestion.category}</strong><span class:suggestion-unused={payeeFixed} aria-label={payeeFixed ? `${suggestion.payee} — not applied; payee fixed` : undefined}>{amazonMarket ? payeeName : suggestion.payee}</span></span><small>{suggestion.reason}</small><Icon name="check" />
                </button>
              {/each}
            </section>
          {/if}

          <div class="review-actions">
            <Button icon="business" shortcut="B" disabled={busy || saveFailed || expenseSaved} onclick={openExpense}>{expenseSaved ? 'Business saved' : 'Business expense'}</Button>
            <Button icon="skip" shortcut="S" disabled={saveFailed || (busy && !syncing)} onclick={skip}>Skip</Button>
            <Button primary icon="check" shortcut="Enter" disabled={busy || saveFailed || (!special(current) && ((!payee && !amazonMarket && !newPayee) || !category))} onclick={() => void approve()}>{edited ? 'Save & approve' : 'Approve'}</Button>
          </div>
        </article>
      {:else}
        <section class="empty-state">
          <div class="complete-mark"><Icon name="check" /></div>
          <h1>{data.queue.length ? 'All remaining skipped' : data.pending ? 'Review complete' : 'All caught up'}</h1>
          {#if data.pending}<p class="muted">{data.pending} {data.pending === 1 ? 'change' : 'changes'} waiting to sync</p><Button primary icon="sync" disabled={busy} onclick={() => void sync()}>Sync now</Button>{/if}
          {#if data.queue.length}<Button primary onclick={clearSkipped}>Review skipped</Button>{/if}
        </section>
      {/if}
      <footer>
        <span>{data.history_count ? `${data.history_count.toLocaleString()} past transactions` : ''}</span>
        {#if skipped.length && current}<button class="text-button" onclick={clearSkipped}>{skipped.length} skipped</button>{/if}
      </footer>
    </main>
  {/if}
</div>

{#if modal === 'settings'}
  <Modal title="Settings" onclose={closeSettings} wide>
    {#if error}<p class="modal-error" role="alert">{error}</p>{/if}
    <section class="settings-section theme-settings">
      <div class="setting-row">
        <span>Appearance</span>
        <div class="appearance-options" role="group" aria-label="Appearance">
          {#each ['system', 'light', 'dark'] as mode}
            <button class="appearance-option" class:chosen={appearance === mode} aria-label={mode[0]!.toUpperCase() + mode.slice(1)} aria-pressed={appearance === mode} title={mode[0]!.toUpperCase() + mode.slice(1)} onclick={() => appearance = mode as Appearance}>
              <span class="appearance-circle" class:system={mode === 'system'} class:light={mode === 'light'} class:dark={mode === 'dark'}></span>
              <small>{mode[0]!.toUpperCase() + mode.slice(1)}</small>
            </button>
          {/each}
        </div>
      </div>
      <div class="setting-label">Theme</div>
      <div class="theme-grid" role="group" aria-label="Color theme">
        {#each THEME_OPTIONS as preset}
          <div class="theme-option" class:chosen={theme === preset.id} class:has-schedule={preset.id === 'random' && theme !== 'random'}>
            <button class="theme-select" aria-label={preset.name} aria-describedby={`theme-description-${preset.id}`} aria-pressed={theme === preset.id} onclick={() => { theme = preset.id; randomStart = '' }}>
              <span class="theme-swatches" aria-hidden="true">
                {#each preset.swatches as swatch}<span style:--theme-swatch={swatch}></span>{/each}
              </span>
              <span class="theme-option-copy">
                <strong>{preset.name}</strong>
                <small id={`theme-description-${preset.id}`}>{preset.description}</small>
              </span>
              <span class="theme-selected-mark" aria-hidden="true"><Icon name="check" /></span>
            </button>
            {#if preset.id === 'random' && theme !== 'random'}
              <button class="theme-schedule" aria-pressed={!!randomStart} onclick={() => randomStart = randomStart ? '' : tomorrow()}>{randomStart ? 'Cancel start' : 'Start tomorrow'}</button>
            {/if}
          </div>
        {/each}
      </div>
    </section>
    <LogoSettings value={logo} onchange={(value) => logo = value} />
    {#if data}
      <section class="settings-section">
        <h3>YNAB</h3>
        {#if !data.connected || replacingToken}
          <form onsubmit={async (event) => { event.preventDefault(); if (await act({ action: 'token', token })) { token = ''; replacingToken = false } }}>
            <label>{data.connected ? 'Replace access token' : 'Personal access token'}<input use:focus type="password" bind:value={token} autocomplete="off" spellcheck="false" required placeholder={data.connected ? 'New token' : 'Paste token'} /></label>
            <div class="token-actions"><a href="https://app.ynab.com/settings/developer" target="_blank" rel="noreferrer">Get a token<Icon name="external" /></a><div class="token-buttons">{#if data.connected}<Button onclick={() => { replacingToken = false; token = '' }}>Cancel</Button>{/if}<Button type="submit" primary disabled={busy || !token}>{data.connected ? 'Replace' : 'Connect'}</Button></div></div>
          </form>
        {:else}
          <Button onclick={() => replacingToken = true}>Replace access token</Button>
        {/if}
        {#if data.connected}
          <label class="setting-row">Plan<select value={data.plan_id} disabled={busy || !!saving || saveFailed || !!data.pending} onchange={async (event) => { clearSkipped(); if (await act({ action: 'plan', id: event.currentTarget.value })) closeSettings() }}><option value="" disabled>Choose plan</option>{#each data.plans as plan}<option value={plan.id}>{plan.name}</option>{/each}</select></label>
        {/if}
      </section>
    {/if}
    <section class="settings-section">
      <h3>Diagnostics</h3>
      <p class="field-note">Recent operation names, error codes and collection counts. No order details or credentials.</p>
      <Button onclick={() => void copyDiagnostics()}>Copy diagnostics</Button>
      {#if diagnosticsMessage}<p role="status">{diagnosticsMessage}</p>{/if}
      {#if diagnosticsFallback}<label>Diagnostic report<textarea readonly rows="8" value={diagnosticsFallback} onfocus={(event) => event.currentTarget.select()}></textarea></label>{/if}
    </section>
  </Modal>
{:else if modal === 'description'}
  <Modal title="Description" subtitle={`${current?.date ?? ''} · ${payeeName}`} onclose={() => { modal = null; memoDraft = ''; memoId = '' }}>
    {#if error}<p class="modal-error" role="alert">{error}</p>{/if}
    <form onsubmit={(event) => { event.preventDefault(); void saveDescription() }}>
      <label>Description<textarea data-modal-focus bind:value={memoDraft} maxlength="500" rows="3" onkeydown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void saveDescription() } }}></textarea></label>
      <Button type="submit" primary shortcut="Enter" disabled={busy || saveFailed}>Save description</Button>
    </form>
  </Modal>
{:else if modal === 'expense'}
  <Modal title="Add business expense" subtitle={`${current?.date ?? ''} · ${current ? money(-current.amount) : ''} · ${currentAccount?.name ?? ''}`} onclose={() => { modal = null; description = ''; expenseNote = '' }}>
    {#if error}<p class="modal-error" role="alert">{error}</p>{/if}
    <form onsubmit={(event) => { event.preventDefault(); void saveExpense() }}>
      <label>Description<textarea data-modal-focus bind:value={description} required maxlength="10000" rows="3" onkeydown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (description.trim()) void saveExpense() } }}></textarea></label>
      <label>Note (optional)<textarea bind:value={expenseNote} maxlength="10000" rows="2"></textarea></label>
      <Button type="submit" primary shortcut="Enter" disabled={busy || saveFailed || !description.trim()}>Save expense</Button>
    </form>
  </Modal>
{:else if modal === 'business'}
  <Modal title="Business expenses" wide onclose={() => modal = null}>
    {#if error}<p class="modal-error" role="alert">{error}</p>{/if}
    <div class="business-actions">
      <Button primary disabled={!activeExpenses.length} onclick={() => void copyExpenses()}>Copy to sheet</Button>
      <Button disabled={busy || !!saving || saveFailed || !activeExpenses.length} onclick={() => void archiveExpenses()}>Archive all</Button>
      {#if data?.can_undo_business || data?.can_undo_archive}<Button icon="undo" shortcut="⌘Z / U" disabled={busy || !!saving || saveFailed} onclick={() => void undoBusiness()}>{data?.can_undo_archive ? 'Undo archive' : 'Undo expense'}</Button>{/if}
      <Button onclick={() => showArchived = !showArchived}>{showArchived ? 'Show current' : 'Show archived'}</Button>
    </div>
    <p class="field-note">Copy current rows: description, date (yyyy-mm-dd), amount, account, note. Expenses are positive; refunds are negative.</p>
    {#if businessMessage}<p role="status">{businessMessage}</p>{/if}
    <div class="business-table"><table>
      <thead><tr><th>Description</th><th>Date</th><th>Amount</th><th>Account</th><th>Note</th><th aria-label="Actions"></th></tr></thead>
      <tbody>{#each expenses.filter(e => e.archived === showArchived) as expense}
        <tr><td>{expense.description}</td><td>{expense.date}</td><td>{expense.amount / 1000}</td><td>{expense.account}</td><td>{expense.note}</td><td class="expense-remove"><Button icon="close" label={`Remove expense: ${expense.description}`} disabled={busy || !!saving || saveFailed} onclick={() => void removeExpense(expense.plan_id, expense.transaction_id)} /></td></tr>
      {:else}<tr><td colspan="6">{showArchived ? 'No archived expenses.' : 'No current expenses. Press B while reviewing a transaction to add one.'}</td></tr>{/each}</tbody>
    </table></div>
  </Modal>
{:else if modal === 'shortcuts'}
  <Modal title="Help" onclose={() => modal = null}>
    <div class="shortcut-list">{#each shortcuts as [key, label]}<div><span>{label}</span><kbd>{key}</kbd></div>{/each}</div>
  </Modal>
{:else if modal}
  <Picker initialQuery={modal === 'payee' ? titleCase(newPayee ?? amazonPayeeName ?? data?.payees.find(p => p.id === payee)?.name ?? current?.payee_name ?? '') : ''} rankCategories={modal === 'category'} matchPayees={modal === 'payee'} title={modal === 'category' ? 'Category' : modal === 'payee' ? 'Payee' : 'Account'} options={pickerOptions()} renameFailed={modal === 'payee' && saveFailed} onrename={modal === 'payee' && !saveFailed ? (id, name) => enqueue({ body: { action: 'rename_payee', id, name } }) : undefined} oncreate={modal === 'payee' ? createPayee : undefined} onpick={(id) => void pick(id)} onclose={() => modal = null} />
{/if}
