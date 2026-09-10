<script lang="ts">
  import { DEFAULT_LOGO, type Logo } from './logo'
  import ColorPicker from './ColorPicker.svelte'
  import Wordmark from './Wordmark.svelte'
  let { value, onchange }: { value: Logo; onchange: (value: Logo) => void } = $props()
  const isDefault = $derived(value.color.toLowerCase() === DEFAULT_LOGO.color)
</script>
<section class="settings-section logo-settings">
  <div class="setting-row"><h3>Logo</h3><button class="logo-reset" disabled={isDefault} onclick={() => onchange({ ...DEFAULT_LOGO })}>Reset logo</button></div>
  <div class="logo-preview"><Wordmark {value} /></div>
  <ColorPicker value={value.color} onchange={(color) => onchange({ color })} />
</section>
