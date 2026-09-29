import { hashString, RenderTarget, TargetPool, type GLContext, type Program } from '../gl/gl';
import type { ResourceCache } from './resources';
import { registry } from '$core/layers/registry';
import type { LayerDef } from '$core/layers/defineLayer';
import { BLEND_MODES, type LayerNode, type Project } from '$core/model/types';
import { findLayer, isGroup } from '$core/model/project';
import { toUniforms, uniformName } from '$core/schema/params';

export interface RenderOptions {
  /** Render as if this layer were hidden (before/after comparison). */
  excludeLayerId?: string | null;
  /** When non-empty, only these layers (and their ancestors' groups) are shown. */
  solo?: ReadonlySet<string> | null;
  /** Temporary blend-mode override (hover preview in the blend dropdown). */
  blendOverride?: { layerId: string; mode: LayerNode['blendMode'] } | null;
}

export interface FrameStats {
  passes: number;
  reused: number;
  ms: number;
}

interface Slot {
  key: string;
  rt: RenderTarget;
  used: boolean;
}

interface StackResult {
  rt: RenderTarget;
  key: string;
}

/**
 * Generates the matcap for a project at a fixed resolution.
 *
 * Differential rendering: every intermediate result lives in a keyed slot.
 * - `layer:<id>`  a generator's standalone output, keyed by type+params+assets
 * - `acc:<id>`    the accumulated composite after this layer, keyed by the
 *                 chain of everything below it
 * When a layer changes only the slots from that layer up to the front are
 * recomputed; reordering / opacity / blend changes re-composite without
 * re-evaluating generators. Unused slots return to the pool after a frame.
 */
export class MatcapPipeline {
  private slots = new Map<string, Slot>();
  private pool: TargetPool;
  private empty: RenderTarget;
  readonly format;
  stats: FrameStats = { passes: 0, reused: 0, ms: 0 };
  private project!: Project;
  private opts: RenderOptions = {};

  constructor(
    private ctx: GLContext,
    private res: ResourceCache,
    readonly size: number,
  ) {
    this.format = ctx.accumFormat;
    this.pool = new TargetPool(ctx, 6);
    this.empty = new RenderTarget(ctx, size, size, this.format);
    this.empty.clear();
  }

  /** Returns the final composite (owned by the pipeline; valid until next render). */
  render(project: Project, opts: RenderOptions = {}): RenderTarget {
    const t0 = performance.now();
    this.project = project;
    this.opts = opts;
    this.stats = { passes: 0, reused: 0, ms: 0 };
    for (const s of this.slots.values()) s.used = false;

    const gl = this.ctx.gl;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    const result = this.renderStack(project.layers, 'root');

    for (const [id, s] of this.slots) {
      if (!s.used) {
        this.pool.release(s.rt);
        this.slots.delete(id);
      }
    }
    this.stats.ms = performance.now() - t0;
    return result.rt;
  }

  /** Output of a single generator layer (for thumbnails); null for filters. */
  layerOutput(node: LayerNode): RenderTarget | null {
    const def = registry.get(node.type);
    if (!def || def.kind !== 'generator') return null;
    return this.generate(node, def)?.rt ?? null;
  }

  /** Current cache key of the whole stack (changes whenever the output changes). */
  get memoryBytes(): number {
    let b = this.empty.bytes;
    for (const s of this.slots.values()) b += s.rt.bytes;
    return b;
  }

  invalidate() {
    for (const s of this.slots.values()) s.key = '';
  }

  dispose() {
    for (const s of this.slots.values()) s.rt.dispose();
    this.slots.clear();
    this.pool.dispose();
    this.empty.dispose();
  }

  // -------------------------------------------------------------------------

  private isVisible(node: LayerNode): boolean {
    if (!node.enabled) return false;
    if (this.opts.excludeLayerId && node.id === this.opts.excludeLayerId) return false;
    const solo = this.opts.solo;
    if (solo && solo.size > 0 && !isGroup(node)) {
      if (!solo.has(node.id)) return false;
    }
    return true;
  }

  private slot(id: string, key: string): { slot: Slot; fresh: boolean } {
    let s = this.slots.get(id);
    if (s && s.key === key) {
      s.used = true;
      this.stats.reused++;
      return { slot: s, fresh: true };
    }
    if (!s) {
      s = { key, rt: this.pool.acquire(this.size, this.size, this.format), used: true };
      this.slots.set(id, s);
    }
    s.key = key;
    s.used = true;
    return { slot: s, fresh: false };
  }

  private renderStack(nodes: LayerNode[], scope: string): StackResult {
    let acc: StackResult = { rt: this.empty, key: 'empty' };
    const settings = this.project.settings;
    const settingsKey = `${settings.blendSpace}:${settings.hdr ? 1 : 0}`;

    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (!this.isVisible(node)) continue;
      const group = isGroup(node);
      const def = group ? undefined : registry.get(node.type);
      if (!group && !def) continue;

      const blendMode =
        this.opts.blendOverride?.layerId === node.id ? this.opts.blendOverride.mode : node.blendMode;
      const isFilter = !group && def!.kind !== 'generator';

      let src: StackResult | null = null;
      if (group) {
        if (!node.children?.length) continue;
        src = this.renderStack(node.children, node.id);
      } else if (!isFilter) {
        src = this.generate(node, def!);
        if (!src) continue;
      }
      const mask = this.maskInfo(node);
      const contentKey = isFilter ? this.paramKey(node, def!) : src!.key;
      const stepKey = hashString(
        `${acc.key}|${node.id}|${blendMode}|${node.opacity}|${settingsKey}|${mask.key}|${contentKey}`,
      );
      const { slot, fresh } = this.slot(`acc:${scope}:${node.id}`, stepKey);
      if (!fresh) {
        let temps: RenderTarget[] = [];
        let srcRt: RenderTarget | null = src?.rt ?? null;
        if (isFilter) {
          const r = this.runFilter(node, def!, acc.rt);
          if (!r) {
            // shader failed: pass the backdrop through unchanged
            this.copy(acc.rt, slot.rt);
            acc = { rt: slot.rt, key: stepKey };
            continue;
          }
          srcRt = r.out;
          temps = r.temps;
        }
        this.blend(srcRt!, acc.rt, slot.rt, blendMode, node.opacity, isFilter, mask);
        temps.forEach((t) => this.pool.release(t));
      }
      acc = { rt: slot.rt, key: stepKey };
    }
    return acc;
  }

  private paramKey(node: LayerNode, def: LayerDef): string {
    let assets = '';
    for (const [k, spec] of Object.entries(def.params)) {
      if (spec.kind === 'asset') assets += `${k}=${node.params[k]}@${this.res.assetVersion(node.params[k] as string)};`;
    }
    // blendMode is included because some layers derive uniforms from it
    return hashString(`${def.type}#${node.typeVersion}|${JSON.stringify(node.params)}|${assets}|${node.blendMode}`);
  }

  private generate(node: LayerNode, def: LayerDef): StackResult | null {
    const prog = this.res.generator(def);
    if (!prog) return null;
    const key = this.paramKey(node, def);
    const { slot, fresh } = this.slot(`layer:${node.id}`, key);
    if (!fresh) {
      this.ctx.bindTarget(slot.rt);
      prog.use();
      this.applyParams(prog, node, def);
      this.ctx.drawFullscreen();
      this.stats.passes++;
    }
    return { rt: slot.rt, key };
  }

  private applyParams(prog: Program, node: LayerNode, def: LayerDef) {
    prog.v2('u_resolution', this.size, this.size);
    for (const [name, spec] of Object.entries(def.params)) {
      const value = node.params[name] ?? spec.default;
      if (spec.kind === 'asset') {
        const t = this.res.assetTexture(value as string | null);
        const u = uniformName(name);
        prog.tex(u, t?.tex ?? null);
        prog.v2(`${u}_size`, t?.width ?? 1, t?.height ?? 1);
        prog.i(`${u}_valid`, t ? 1 : 0);
        continue;
      }
      for (const [u, v] of Object.entries(toUniforms(name, spec, value))) prog.set(u, v);
    }
    if (def.uniforms) {
      for (const [u, v] of Object.entries(def.uniforms(node.params, node))) prog.set(u, v);
    }
    for (const [u, r] of Object.entries(def.resources ?? {})) {
      if (r.kind === 'noise') prog.tex(u, this.res.noiseTexture(Number(node.params[r.seedParam] ?? 0), r.size));
    }
  }

  private runFilter(
    node: LayerNode,
    def: LayerDef,
    input: RenderTarget,
  ): { out: RenderTarget; temps: RenderTarget[] } | null {
    const temps: RenderTarget[] = [];
    let cur = input;
    for (let i = 0; i < def.passes!.length; i++) {
      const prog = this.res.pass(def, i);
      if (!prog) {
        temps.forEach((t) => this.pool.release(t));
        return null;
      }
      const out = this.pool.acquire(this.size, this.size, this.format);
      temps.push(out);
      this.ctx.bindTarget(out);
      prog.use();
      prog.tex('u_input', cur.texture);
      prog.tex('u_original', input.texture);
      prog.i('u_pass', i);
      prog.v2('u_texel', 1 / this.size, 1 / this.size);
      this.applyParams(prog, node, def);
      this.ctx.drawFullscreen();
      this.stats.passes++;
      cur = out;
    }
    return { out: cur, temps };
  }

  private maskInfo(node: LayerNode): { mode: number; invert: boolean; amount: number; tex: WebGLTexture | null; key: string } {
    const m = node.mask;
    const none = { mode: 0, invert: false, amount: 1, tex: null, key: 'nomask' };
    if (!m || !m.enabled) return none;
    let tex: WebGLTexture | null = null;
    let mode = 0;
    let extra = '';
    switch (m.source) {
      case 'fresnel':
        mode = 1;
        break;
      case 'noise':
        mode = 2;
        tex = this.res.noiseTexture(0, 256);
        break;
      case 'image': {
        const t = this.res.assetTexture(m.asset);
        if (!t) return none;
        mode = 3;
        tex = t.tex;
        extra = `${m.asset}@${t.version}`;
        break;
      }
      case 'layer': {
        if (!m.layerId || m.layerId === node.id) return none;
        const loc = findLayer(this.project.layers, m.layerId);
        const def = loc && registry.get(loc.node.type);
        if (!loc || !def || def.kind !== 'generator') return none;
        const out = this.generate(loc.node, def);
        if (!out) return none;
        mode = 4;
        tex = out.rt.texture;
        extra = out.key;
        break;
      }
    }
    return { mode, invert: m.invert, amount: m.amount, tex, key: `${mode}:${m.invert}:${m.amount}:${extra}` };
  }

  private blend(
    src: RenderTarget,
    dst: RenderTarget,
    out: RenderTarget,
    mode: LayerNode['blendMode'],
    opacity: number,
    isFilter: boolean,
    mask: { mode: number; invert: boolean; amount: number; tex: WebGLTexture | null },
  ) {
    const prog = this.res.blend();
    this.ctx.bindTarget(out);
    prog.use();
    prog.tex('u_src', src.texture);
    prog.tex('u_dst', dst.texture);
    prog.tex('u_maskTex', mask.tex);
    prog.v2('u_resolution', this.size, this.size);
    prog.i('u_mode', Math.max(0, BLEND_MODES.indexOf(mode)));
    prog.f('u_opacity', opacity);
    prog.i('u_isFilter', isFilter ? 1 : 0);
    prog.i('u_linear', this.project.settings.blendSpace === 'linear' ? 1 : 0);
    prog.i('u_hdr', this.project.settings.hdr ? 1 : 0);
    prog.i('u_maskMode', mask.mode);
    prog.i('u_maskInvert', mask.invert ? 1 : 0);
    prog.f('u_maskAmount', mask.amount);
    this.ctx.drawFullscreen();
    this.stats.passes++;
  }

  private copy(src: RenderTarget, dst: RenderTarget) {
    const gl = this.ctx.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst.fbo);
    gl.blitFramebuffer(0, 0, src.width, src.height, 0, 0, dst.width, dst.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}
