<script lang="ts">
  import type { Vec2 } from '$core/schema/params';
  import type { OnEdit, Phase } from './edit';
  import ScrubNumber from './ScrubNumber.svelte';
  import { tt } from '../i18n.svelte';

  interface Props {
    value: Vec2;
    min: number;
    max: number;
    softMin?: number;
    softMax?: number;
    defaultValue: Vec2;
    linkable?: boolean;
    labels?: [string, string];
    onedit: OnEdit<Vec2>;
  }
  let { value, min, max, softMin, softMax, defaultValue, linkable = false, labels = ['X', 'Y'], onedit }: Props = $props();

  let linked = $state(false);

  function set(i: 0 | 1, v: number, phase: Phase) {
    const n = [...value] as Vec2;
    if (linked && value[i] !== 0) {
      const k = v / value[i];
      n[0] = Math.min(max, Math.max(min, value[0] * k));
      n[1] = Math.min(max, Math.max(min, value[1] * k));
    } else n[i] = v;
    onedit(n, phase);
  }
</script>

<div class="v2">
  <ScrubNumber value={value[0]} {min} {max} {softMin} {softMax} label={labels[0]} defaultValue={defaultValue[0]} onedit={(v, ph) => set(0, v, ph)} />
  <ScrubNumber value={value[1]} {min} {max} {softMin} {softMax} label={labels[1]} defaultValue={defaultValue[1]} onedit={(v, ph) => set(1, v, ph)} />
  {#if linkable}
    <button class="btn icon small link" class:on={linked} title={tt('vec2.link')} onclick={() => (linked = !linked)}>
      {linked ? '⛓' : '⛓'}
    </button>
  {/if}
</div>

<style>
  .v2 {
    display: flex;
    gap: 4px;
  }
  .v2 > :global(*:not(button)) {
    flex: 1;
  }
  .link {
    height: var(--row);
    width: 24px;
    opacity: 0.5;
  }
  .link.on {
    opacity: 1;
    color: var(--accent);
  }
</style>
