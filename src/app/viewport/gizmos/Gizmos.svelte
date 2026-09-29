<script lang="ts">
  import type { PreviewLayout } from '$render/preview/layout';

  interface Props {
    layout: PreviewLayout;
  }
  let { layout }: Props = $props();
  const _l = $derived(layout);
  void _l;
</script>
