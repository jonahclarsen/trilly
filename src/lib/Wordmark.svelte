<script lang="ts">
  import type { Logo } from './logo'
  let { value }: { value: Logo } = $props()
</script>
<span class="brand" style:color={value.color} style:font-weight={value.weight}>trilly</span>
