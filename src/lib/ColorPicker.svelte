<script lang="ts">
  let { value, onchange }: { value: string; onchange: (value: string) => void } = $props()
  let hue = $state(200)
  let saturation = $state(90)
  let lightness = $state(50)
  let hex = $state('')
  $effect(() => {
    hex = value
    const channels = [1, 3, 5].map(start => parseInt(value.slice(start, start + 2), 16) / 255)
    const [r, g, b] = channels as [number, number, number]
    const max = Math.max(...channels), min = Math.min(...channels), delta = max - min
    const l = (max + min) / 2
    if (delta) hue = Math.round(((max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60))
    saturation = Math.round(delta ? delta / (1 - Math.abs(2 * l - 1)) * 100 : 0)
    lightness = Math.round(l * 100)
  })
  function change() {
    const s = saturation / 100, l = lightness / 100
    const a = s * Math.min(l, 1 - l)
    const channel = (n: number) => {
      const k = (n + hue / 30) % 12
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0')
    }
    onchange(`#${channel(0)}${channel(8)}${channel(4)}`)
  }
</script>
<div class="color-picker">
  <div class="color-value">
    <input class="color-well" type="color" aria-label="Logo color" {value} oninput={(event) => onchange(event.currentTarget.value)} />
    <input class="color-hex" aria-label="Logo hex color" bind:value={hex} maxlength="7" spellcheck="false" oninput={() => { if (/^#[\da-f]{6}$/i.test(hex)) onchange(hex) }} onblur={() => hex = value} />
  </div>
  <div class="color-sliders">
    <label>Hue<input class="hue-slider" type="range" min="0" max="359" value={hue} oninput={(event) => { hue = Number(event.currentTarget.value); change() }} /></label>
    <label>Saturation<input type="range" min="0" max="100" value={saturation} oninput={(event) => { saturation = Number(event.currentTarget.value); change() }} /></label>
    <label>Lightness<input type="range" min="0" max="100" value={lightness} oninput={(event) => { lightness = Number(event.currentTarget.value); change() }} /></label>
  </div>
</div>
