import { hashString, RenderTarget, TargetPool, type GLContext, type Program } from '../gl/gl';
import type { ResourceCache } from './resources';
import { registry } from '$core/layers/registry';
import type { LayerDef } from '$core/layers/defineLayer';
import { BLEND_MODES, type LayerNode, type Project } from '$core/model/types';
import { findLayer, flattenLayers, isGroup } from '$core/model/project';
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
  /** frame number of the last (re)render, for LRU eviction */
  stamp: number;
}

/** Soft cap for cached intermediate results per pipeline. */
export const CACHE_BUDGET_BYTES = 384 * 1024 * 1024;

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
 *
 * Exports use renderOnce() instead, which caches nothing and keeps only the
 * few targets the current step needs.
 */
export class MatcapPipeline {
  private slots = new Map<string, Slot>();
  private pool: TargetPool;
  private empty: RenderTarget;
  readonly format;
  stats: FrameStats = { passes: 0, reused: 0, ms: 0 };
  private project!: Project;
  private opts: RenderOptions = {};
  private frameNo = 0;
  /** result of the last renderOnce() (owned until the next call / dispose) */
  private once: RenderTarget | null = null;

  constructor(
    private ctx: GLContext,
    private res: ResourceCache,
    readonly size: number,
  ) {
    this.format = ctx.accumFormat;
    this.pool = new TargetPool(ctx, 6);
    // every shader samples the backdrop with texture(), so a transparent
    // 1x1 target stands in for an empty backdrop of any size
    this.empty = new RenderTarget(ctx, 1, 1, this.format);
    this.empty.clear();
  }

  private begin(project: Project, opts: RenderOptions) {
    this.project = project;
    this.opts = opts;
    this.stats = { passes: 0, reused: 0, ms: 0 };
    this.frameNo++;
    const gl = this.ctx.gl;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
  }

  /**
   * Returns the final composite (owned by the pipeline; valid until next render).
   * For an empty stack this is a 1x1 transparent target.
   */
  render(project: Project, opts: RenderOptions = {}): RenderTarget {
    const t0 = performance.now();
    this.begin(project, opts);
    for (const s of this.slots.values()) s.used = false;

    const result = this.renderStack(project.layers, 'root');

    // accumulation slots follow the current stack exactly; standalone layer
    // outputs are kept while the layer exists (reused when only its
    // opacity/blend/order changes) and trimmed by the memory budget
    const alive = new Set(flattenLayers(project.layers).map((n) => `layer:${n.id}`));
    for (const [id, s] of this.slots) {
      if (!s.used && !alive.has(id)) {
        this.pool.release(s.rt);
        this.slots.delete(id);
      }
    }
    this.evict();
    this.stats.ms = performance.now() - t0;
    return result.rt;
  }

  /**
   * One-shot render without caching (export). Each step holds only the
   * composite below it, the layer's own input and the step's output; all other
   * targets go back to the pool at once, so the peak is a handful of targets
   * however many layers there are (plus one per nested group level).
   * The result is owned by the pipeline until the next call or dispose().
   */
  renderOnce(project: Project, opts: RenderOptions = {}): RenderTarget {
    const t0 = performance.now();
    this.begin(project, opts);
    this.dropOnce();
    const held = new Set<RenderTarget>();
    try {
      const out = this.stackOnce(project.layers, held);
      held.delete(out);
      held.forEach((t) => t.dispose());
      this.pool.dispose();
      if (out !== this.empty) this.once = out;
      this.stats.ms = performance.now() - t0;
      return out;
    } catch (e) {
      held.forEach((t) => t.dispose());
      this.pool.dispose();
      throw e;
    }
  }

  /** Full-size targets renderOnce() holds at its peak (for memory estimates). */
  static onceTargets(layers: LayerNode[]): number {
    // composite below + input + output + a filter pass or a layer mask,
    // and one more composite per nested group level
    let deepest = 0;
    const walk = (nodes: LayerNode[], depth: number) => {
      for (const n of nodes) {
        if (!n.enabled) continue;
        deepest = Math.max(deepest, depth);
        if (isGroup(n) && n.children) walk(n.children, depth + 1);
      }
    };
    walk(layers, 0);
    return 4 + deepest;
  }

  private dropOnce() {
    this.once?.dispose();
    this.once = null;
  }

  /**
   * Output of a single generator layer (for thumbnails); null for filters.
   * With `alive` (ids of the current document's layers), cached results of
   * layers that no longer exist are released; the memory budget always applies.
   */
  layerOutput(node: LayerNode, alive?: ReadonlySet<string>): RenderTarget | null {
    const def = registry.get(node.type);
    if (!def || def.kind !== 'generator') return null;
    const out = this.generate(node, def);
    if (!out) return null;
    if (alive) {
      for (const [id, s] of this.slots) {
        // slot ids end with the layer id (`layer:<id>`, `acc:<scope>:<id>`)
        if (!alive.has(id.slice(id.lastIndexOf(':') + 1))) {
          this.pool.release(s.rt);
          this.slots.delete(id);
        }
      }
    }
    this.evict(`layer:${node.id}`);
    return out.rt;
  }

  /** Current cache key of the whole stack (changes whenever the output changes). */
  get memoryBytes(): number {
    let b = this.empty.bytes + (this.once?.bytes ?? 0) + this.pool.bytes;
    for (const s of this.slots.values()) b += s.rt.bytes;
    return b;
  }

  invalidate() {
    for (const s of this.slots.values()) s.key = '';
  }

  dispose() {
    for (const s of this.slots.values()) s.rt.dispose();
    this.slots.clear();
    this.dropOnce();
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
      s = { key, rt: this.pool.acquire(this.size, this.size, this.format), used: true, stamp: this.frameNo };
      this.slots.set(id, s);
    }
    s.key = key;
    s.used = true;
    s.stamp = this.frameNo;
    return { slot: s, fresh: false };
  }

  /**
   * Over budget: drop standalone generator outputs that changed least
   * recently (they are simply recomputed when needed). The accumulation
   * chain is kept because it is what makes edits near the front cheap.
   */
  private evict(keep?: string) {
    let bytes = this.memoryBytes;
    if (bytes <= CACHE_BUDGET_BYTES) return;
    const layerSlots = [...this.slots.entries()]
      .filter(([id]) => id.startsWith('layer:') && id !== keep)
      .sort((a, b) => a[1].stamp - b[1].stamp);
    for (const [id, s] of layerSlots) {
      if (bytes <= CACHE_BUDGET_BYTES) break;
      bytes -= s.rt.bytes;
      s.rt.dispose();
      this.slots.delete(id);
    }
    this.pool.dispose();
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
      let contentKey: string;
      if (group) {
        if (!node.children?.length) continue;
        src = this.renderStack(node.children, node.id);
        contentKey = src.key;
      } else {
        // generators are only evaluated below when this step is stale
        if (!isFilter && !this.res.generator(def!)) continue;
        contentKey = this.paramKey(node, def!);
      }
      const mask = this.maskInfo(node);
      const stepKey = hashString(
        `${acc.key}|${node.id}|${blendMode}|${node.opacity}|${settingsKey}|${mask.key}|${contentKey}`,
      );
      const { slot, fresh } = this.slot(`acc:${scope}:${node.id}`, stepKey);
      if (!fresh) {
        if (!group && !isFilter) src = this.generate(node, def!);
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

  private stackOnce(nodes: LayerNode[], held: Set<RenderTarget>): RenderTarget {
    const take = () => {
      const t = this.pool.acquire(this.size, this.size, this.format);
      held.add(t);
      return t;
    };
    const drop = (t: RenderTarget | null | undefined) => {
      if (t && held.delete(t)) this.pool.release(t);
    };
    let acc = this.empty;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (!this.isVisible(node)) continue;
      const group = isGroup(node);
      const def = group ? undefined : registry.get(node.type);
      if (!group && !def) continue;
      const blendMode =
        this.opts.blendOverride?.layerId === node.id ? this.opts.blendOverride.mode : node.blendMode;
      const isFilter = !group && def!.kind !== 'generator';

      let src: RenderTarget | null = null;
      if (group) {
        if (!node.children?.length) continue;
        src = this.stackOnce(node.children, held);
      } else if (!isFilter) {
        const prog = this.res.generator(def!);
        if (!prog) continue;
        src = take();
        this.draw(prog, src, node, def!);
      }
      const mask = this.maskInfo(node, take);
      const out = take();
      if (isFilter) {
        const r = this.runFilter(node, def!, acc);
        if (r) {
          r.temps.forEach((t) => held.add(t));
          this.blend(r.out, acc, out, blendMode, node.opacity, true, mask);
          r.temps.forEach(drop);
        } else {
          // shader failed: pass the backdrop through unchanged
          this.copy(acc, out);
        }
      } else {
        this.blend(src!, acc, out, blendMode, node.opacity, false, mask);
      }
      drop(src);
      drop(mask.temp);
      drop(acc);
      acc = out;
    }
    return acc;
  }

  private draw(prog: Program, target: RenderTarget, node: LayerNode, def: LayerDef) {
    this.ctx.bindTarget(target);
    prog.use();
    this.applyParams(prog, node, def);
    this.ctx.drawFullscreen();
    this.stats.passes++;
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
    if (!fresh) this.draw(prog, slot.rt, node, def);
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
    // only the previous pass stays alive: it is released once the next pass
    // has read it, and on any failure
    let prev: RenderTarget | null = null;
    let cur = input;
    try {
      for (let i = 0; i < def.passes!.length; i++) {
        const prog = this.res.pass(def, i);
        if (!prog) {
          if (prev) this.pool.release(prev);
          return null;
        }
        const out = this.pool.acquire(this.size, this.size, this.format);
        this.ctx.bindTarget(out);
        prog.use();
        prog.tex('u_input', cur.texture);
        prog.tex('u_original', input.texture);
        prog.i('u_pass', i);
        prog.v2('u_texel', 1 / this.size, 1 / this.size);
        this.applyParams(prog, node, def);
        this.ctx.drawFullscreen();
        this.stats.passes++;
        if (prev) this.pool.release(prev);
        prev = out;
        cur = out;
      }
    } catch (e) {
      if (prev) this.pool.release(prev);
      throw e;
    }
    return { out: cur, temps: prev ? [prev] : [] };
  }

  /**
   * Mask inputs of a layer. With `take` (one-shot render) a layer-sourced mask
   * is drawn into a temporary target returned as `temp` for the caller to
   * release; otherwise it comes from the generator cache.
   */
  private maskInfo(
    node: LayerNode,
    take?: () => RenderTarget,
  ): { mode: number; invert: boolean; amount: number; tex: WebGLTexture | null; key: string; temp?: RenderTarget } {
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
        if (take) {
          const prog = this.res.generator(def);
          if (!prog) return none;
          const temp = take();
          this.draw(prog, temp, loc.node, def);
          return { mode: 4, invert: m.invert, amount: m.amount, tex: temp.texture, key: '', temp };
        }
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
