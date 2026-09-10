<script lang="ts">
  import { DEFAULT_LOGO, LOGO_WEIGHT_MIN, LOGO_WEIGHT_MAX, type Logo } from './logo'
  import ColorPicker from './ColorPicker.svelte'
  import Wordmark from './Wordmark.svelte'
  let { value, onchange }: { value: Logo; onchange: (value: Logo) => void } = $props()
  const isDefault = $derived(value.weight === DEFAULT_LOGO.weight && value.color.toLowerCase() === DEFAULT_LOGO.color)
</script>
<section class="settings-section logo-settings">
  <div class="setting-row"><h3>Logo</h3><button class="logo-reset" disabled={isDefault} onclick={() => onchange({ ...DEFAULT_LOGO })}>Reset logo</button></div>
  <div class="logo-preview"><Wordmark {value} /></div>
  <ColorPicker value={value.color} onchange={(color) => onchange({ ...value, color })} />
  <label class="logo-weight" for="logo-weight">
    <span>Weight <output for="logo-weight">{value.weight}</output></span>
    <input id="logo-weight" aria-label="Logo weight" type="range" min={LOGO_WEIGHT_MIN} max={LOGO_WEIGHT_MAX} step="1" value={value.weight} oninput={(event) => onchange({ ...value, weight: Number(event.currentTarget.value) })} />
  </label>
</section>
