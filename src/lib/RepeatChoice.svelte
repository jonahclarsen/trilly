<script lang="ts">
  import { onMount } from 'svelte'
  import Button from './Button.svelte'
  import { repeatDismissDelayMs } from './repeat-choice'
  import { modShortcutLabel } from './shortcuts'
  import type { Transaction } from './types'
  let { look, summary, matches, money, date, disabled = false, onapply, ondismiss }:
    { look: string; summary: string; matches: Transaction[]; money: (amount: number) => string; date: (date: string) => string; disabled?: boolean; onapply: () => void; ondismiss: () => void } = $props()
  let armed = $state(false)
  let shake: Animation | undefined
  onMount(() => {
    const timer = setTimeout(() => armed = true, repeatDismissDelayMs)
    return () => clearTimeout(timer)
  })
  export function dismiss() { if (armed) ondismiss() }

  function clickDismiss(event: MouseEvent) {
    if (armed) {
      dismiss()
    } else if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      shake?.cancel()
      shake = (event.currentTarget as HTMLButtonElement).animate(
        { transform: ['translateX(0)', 'translateX(-3px)', 'translateX(3px)', 'translateX(-2px)', 'translateX(2px)', 'translateX(0)'] },
        { duration: 230 },
      )
    }
  }
</script>
<aside class="repeat-choice" aria-label="Repeated choice" aria-live="polite">
  <div class="repeat-choice-heading">
    <strong>{matches.length} more like this</strong>
    <span class="repeat-choice-look" title={look}>{look}</span>
  </div>
  <p class="repeat-choice-summary">{summary}</p>
  <ul class="repeat-choice-list">
    {#each matches as transaction (transaction.id)}
      <li><time datetime={transaction.date}>{date(transaction.date)}</time><span>{money(transaction.amount)}</span></li>
    {/each}
  </ul>
  <div class="repeat-choice-actions">
    <Button class="repeat-dismiss" icon="close" shortcut="Esc" ariaDisabled={!armed || undefined} onclick={clickDismiss} label="Dismiss">Dismiss</Button>
    <Button primary icon="check" shortcut={modShortcutLabel('Enter')} {disabled} onclick={onapply} label={`Apply to all ${matches.length}`}>Apply to all {matches.length}</Button>
  </div>
</aside>
