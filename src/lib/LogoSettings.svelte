<script lang="ts">
  import { LOGO_FONTS, DEFAULT_LOGO, fontWeight, type Logo } from './logo'
  import ColorPicker from './ColorPicker.svelte'
  let { value, defaultColor, onchange }: { value: Logo; defaultColor: string; onchange: (value: Logo) => void } = $props()
  const weightNames: Record<number, string> = { 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Heavy', 900: 'Black' }
  function choose(font: typeof LOGO_FONTS[number], weight?: number) {
    onchange({ ...value, font: font.id, weight: weight ?? fontWeight(font, value.weight) })
  }
</script>
<section class="settings-section logo-settings">
  <div class="setting-row"><h3>Logo</h3><button class="text-button" onclick={() => onchange({ ...DEFAULT_LOGO })}>Reset logo</button></div>
  <div class="font-grid" role="group" aria-label="Logo font">
    {#each LOGO_FONTS as font}
      <div class="font-option" class:chosen={value.font === font.id}>
        <button class="font-select" aria-label={font.name} aria-pressed={value.font === font.id} onclick={() => choose(font)}>
          <span class="brand" style:font-family={font.family} style:font-weight={fontWeight(font, value.weight)} style:letter-spacing={`${value.spacing}px`} style:color={value.color || undefined}>trilly</span>
          <small>{font.name}</small>
        </button>
        {#if value.font === font.id}
          <div class="font-weights" role="group" aria-label={`${font.name} weight`}>
            {#each font.weights as weight}
              <button class:chosen={value.weight === weight} aria-pressed={value.weight === weight} aria-label={weightNames[weight]} title={weightNames[weight]} onclick={() => choose(font, weight)}>{weight}</button>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
  <label class="spacing-control" for="logo-spacing"><span>Letter spacing <output>{value.spacing.toFixed(1)} px</output></span><input id="logo-spacing" type="range" min="-2" max="5" step="0.1" value={value.spacing} oninput={(event) => onchange({ ...value, spacing: Number(event.currentTarget.value) })} /></label>
  <ColorPicker value={value.color || defaultColor} onchange={(color) => onchange({ ...value, color })} />
</section>
