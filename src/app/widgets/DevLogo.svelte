<script lang="ts">
  // Developer logo (dennokoworks). The PNG is used as an alpha mask and painted with
  // `currentColor`, so it reads white on the dark theme and dark on the light theme.
  import logo from '../../assets/dennokoworks-logo.png';

  let { height = 16, title = 'dennokoworks' }: { height?: number; title?: string } = $props();
</script>

<span class="logo" role="img" aria-label={title} style:height={`${height}px`} style:--logo={`url("${logo}")`}></span>

<style>
  .logo {
    display: inline-block;
    aspect-ratio: 634 / 160;
    background: currentColor;
    -webkit-mask: var(--logo) center / contain no-repeat;
    mask: var(--logo) center / contain no-repeat;
    vertical-align: middle;
  }
</style>
