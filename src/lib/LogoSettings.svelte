<script lang="ts">
  import { DEFAULT_LOGO, type Logo } from './logo'
  import ColorPicker from './ColorPicker.svelte'
  let { value, onchange }: { value: Logo; onchange: (value: Logo) => void } = $props()
</script>
<section class="settings-section logo-settings">
  <div class="setting-row"><h3>Logo</h3><button class="text-button" onclick={() => onchange({ ...DEFAULT_LOGO })}>Reset logo</button></div>
  <ColorPicker value={value.color} onchange={(color) => onchange({ color })} />
</section>
