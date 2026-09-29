<script lang="ts">
  // Picks the widget for a param from its schema type (float → ScrubNumber,
  // color → ColorField, direction → DirectionBall, gradient → GradientEditor…).
  import type { CurveValue, GradientValue, ParamSpec, ParamValue, RGB, Vec2, Vec3 } from '$core/schema/params';
  import type { OnEdit } from './edit';
  import ScrubNumber from './ScrubNumber.svelte';
  import ColorField from './ColorField.svelte';
  import DirectionBall from './DirectionBall.svelte';
  import Vec2Field from './Vec2Field.svelte';
  import EnumField from './EnumField.svelte';
  import GradientEditor from './GradientEditor.svelte';
  import CurveEditor from './CurveEditor.svelte';
  import AssetField from './AssetField.svelte';
  import { tOption } from '../i18n.svelte';

  interface Props {
    type: string;
    name: string;
    spec: ParamSpec;
    value: ParamValue;
    onedit: OnEdit<ParamValue>;
    onpickAsset?: () => void;
  }
  let { type, name, spec, value, onedit, onpickAsset }: Props = $props();
</script>

{#if spec.kind === 'float'}
  <ScrubNumber
    value={value as number}
    min={spec.min}
    max={spec.max}
    softMin={spec.softMin}
    softMax={spec.softMax}
    step={spec.step}
    unit={spec.unit}
    defaultValue={spec.default}
    onedit={onedit as OnEdit<number>}
  />
{:else if spec.kind === 'int'}
  <ScrubNumber
    value={value as number}
    min={spec.min}
    max={spec.max}
    softMax={spec.softMax}
    integer
    defaultValue={spec.default}
    onedit={onedit as OnEdit<number>}
  />
{:else if spec.kind === 'angle'}
  <ScrubNumber
    value={value as number}
    min={0}
    max={360}
    step={0.5}
    unit="°"
    defaultValue={spec.default}
    onedit={onedit as OnEdit<number>}
  />
{:else if spec.kind === 'bool'}
  <label class="toggle">
    <input type="checkbox" checked={value as boolean} onchange={(e) => onedit((e.currentTarget as HTMLInputElement).checked, 'set')} />
    <span></span>
  </label>
{:else if spec.kind === 'color'}
  <ColorField value={value as RGB} defaultValue={spec.default} onedit={onedit as OnEdit<RGB>} />
{:else if spec.kind === 'direction'}
  <DirectionBall value={value as Vec3} defaultValue={spec.default} onedit={onedit as OnEdit<Vec3>} />
{:else if spec.kind === 'vec2'}
  <Vec2Field
    value={value as Vec2}
    min={spec.min}
    max={spec.max}
    softMin={spec.softMin}
    softMax={spec.softMax}
    defaultValue={spec.default}
    linkable
    onedit={onedit as OnEdit<Vec2>}
  />
{:else if spec.kind === 'enum'}
  <EnumField value={value as string} options={spec.options} label={(o) => tOption(type, name, o)} onedit={onedit as OnEdit<string>} />
{:else if spec.kind === 'gradient'}
  <GradientEditor value={value as GradientValue} maxStops={spec.maxStops} defaultValue={spec.default} onedit={onedit as OnEdit<GradientValue>} />
{:else if spec.kind === 'curve'}
  <CurveEditor value={value as CurveValue} defaultValue={spec.default} onedit={onedit as OnEdit<CurveValue>} />
{:else if spec.kind === 'asset'}
  <AssetField value={value as string | null} onpick={() => onpickAsset?.()} onclear={() => onedit(null, 'set')} />
{/if}

<style>
  .toggle {
    display: inline-flex;
    cursor: pointer;
  }
  .toggle input {
    display: none;
  }
  .toggle span {
    width: 34px;
    height: 18px;
    border-radius: 9px;
    background: var(--border-strong);
    position: relative;
    transition: background 0.15s;
  }
  .toggle span::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s var(--ease);
  }
  .toggle input:checked + span {
    background: var(--accent);
  }
  .toggle input:checked + span::after {
    transform: translateX(16px);
  }
</style>
