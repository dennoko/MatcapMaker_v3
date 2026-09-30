# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Matcap Maker: a desktop tool for authoring matcap textures by stacking layers (lights, rims, gradients, noise, images, filters). It is a rewrite of a Python/PySide6 v3 in **Tauri 2 + Svelte 5 (runes) + WebGL2**, Windows-first. User-facing docs (README, `Docs/`) are in Japanese; code and comments are in English.

## Commands

Package manager is pnpm (Windows; Rust toolchain + VS C++ Build Tools needed for Tauri).

```powershell
pnpm tauri dev          # run the desktop app with HMR (Vite on port 1420)
pnpm dev                # frontend only in a browser (uses the Web platform implementation)
pnpm check              # svelte-check type check
pnpm test               # Vitest (tests/**/*.test.ts) + cargo test for src-tauri
pnpm test:core          # Vitest only
pnpm exec vitest run tests/core/store.test.ts        # single test file
pnpm exec vitest run -t "name of test"               # single test by name
pnpm test:golden        # Playwright: shader golden images + UI smoke tests (Chromium/SwiftShader, Vite on 1430)
pnpm exec playwright test tests/golden/render.spec.ts -g spotLight   # single golden test
pnpm tauri build        # release: portable exe + NSIS installer under src-tauri/target/release/
pnpm build:single       # dist-single/MatcapMaker.html + 1,500,000-byte budget/bundle check
pnpm test:single        # build:single first; offline file:// smoke tests
```

CI (`.github/workflows/ci.yml`) runs `check`, `test`, `test:golden`, and `tauri build --debug --no-bundle`.

`test:golden` requires `build:single` first: shared UI tests run against both dev and single HTML. UI feature checks use `platform.caps`, never `platform.kind` (About only). Keep platform-specific persistence and picker logic in `src/platform/`. Web licenses come from rendered modules and must not replace desktop notices. Release builds the HTML once and reuses it for assets and Pages; see `Docs/web-operations.md` for setup and storage caveats.

- **Golden images**: `tests/golden/render.spec.ts` renders projects through `tests/golden/harness.html` and compares with `tests/golden/reference/*.png` (tolerance: >3 per channel on <0.5% of channels). A missing reference is written automatically, so to update a golden, delete its reference PNG and rerun. Actual output goes to `tests/golden/__output__/`.
- `Docs/Review/` holds a separate review probe suite: `pnpm exec vitest run --config Docs/Review/vitest.config.ts`.
- The app version lives only in `version.json` (read by `vite.config.ts`, `tauri.conf.json`, `src-tauri/build.rs` and the release scripts; `package.json` and `Cargo.toml` have none). It is separate from the project file `schemaVersion`. `pnpm check` validates it and, on tag builds, that the tag is `v<version>`. Pushing a `v*` tag triggers `release.yml`.
- `pnpm build` regenerates `src/generated/licenses.json` via `scripts/gen-licenses.mjs`.

## Architecture

Design docs are in `Docs/Plan/` (03_architecture.md and 04_rendering.md are the most useful); per-feature implementation plans are in `Docs/Impl/` (e.g. the single-file web build). Path aliases: `$core`, `$render`, `$platform`, `$app` → `src/*`.

Layering (dependencies only go downward):

- `src/core/` — pure TS, no Svelte/Tauri imports. Model types, param schema, layer definitions, command store/history, IO, i18n. Must stay testable under Vitest in a Node environment.
- `src/render/` — WebGL2 renderer. Depends on core only.
- `src/platform/` — `Platform` interface with `tauri.ts` and `web.ts` implementations; `createPlatform()` picks Tauri when `__TAURI_INTERNALS__` exists and `__WEB_BUILD__` is false.
- `src/app/` — Svelte UI. `state.svelte.ts` mirrors the `DocumentStore` into runes and holds UI-only state (selection, view, dialogs, settings).
- `src-tauri/` — Rust: image encoding (PNG/JPG/EXR in `commands/image.rs`), `.mcproj` zip load/save (`commands/project.rs`), settings/logs/recovery paths, single-instance "open with" forwarding.

### Schema-driven layers

A layer type is a `defineLayer({...})` in `src/core/layers/<name>.ts` plus a GLSL file imported with `?raw`, registered in `BUILTIN_LAYERS` in `registry.ts`. Adding a layer needs no per-layer UI, serialization, or uniform code: the `params` schema (`src/core/schema/params.ts`, `p.float`, `p.color`, `p.direction`, ...) drives the Inspector widgets, uniform declarations (`u_<param>`), default-diffed serialization with validation/clamping, and i18n keys (`layer.<type>.title`, `layer.<type>.param.<name>` in `src/core/i18n/{en,ja}.json`, falling back to English).

- `kind: 'generator'` implements `vec4 evalLayer(MatcapCtx ctx)`; `'filter'`/`'adjustment'` declare `passes` whose shaders implement `runPass(uv)` and read `u_input` (composite below the layer). Wrapping code is generated in `src/render/pipeline/shaderBuilder.ts` around `render/shaders/common.glsl` and `blend.glsl`.
- `legacy` maps a v3 layer type/params for `src/core/io/legacyV3.ts`; `migrations` keyed by `version` upgrade per-layer params.
- User plugins (`Documents\MatcapMaker\plugins\<name>\layer.json` + GLSL, no JS) go through `pluginLoader.ts` into the same registry. Format: `Docs/plugins.md`, samples in `examples/plugins/`.

### State and commands

`src/core/commands/store.ts`: the `Project` is immutable and changed only via `Command.apply(draft)` with Immer `produceWithPatches`. History stores patch/inverse-patch pairs, so commands don't write undo logic. Consecutive commands sharing `mergeKey` within a time window merge into one step; drags use transactions to record one entry. Change events carry `changedLayerIds` and `structural`, which the renderer uses for incremental re-rendering. Layer commands live in `layerCommands.ts`.

Document vs. view: `Project` (layers, assets, settings) is undoable and affects output; `ViewState` (preview shape, split, normal map, mesh, zoom) is saved but not undoable. `layers[0]` is the topmost layer; rendering walks the array in reverse. Groups nest via `children`. Assets are referenced by content-hash `AssetId`, stored in the `.mcproj` zip under `assets/`.

### Rendering

`src/render/Renderer.ts` owns the GL context and draws the viewport preview (sphere/flat/normal-mapped/mesh via `preview/`, OBJ/GLB/FBX loaders). `pipeline/MatcapPipeline.ts` composites layers into the matcap texture with a per-layer cache (byte budget) keyed by layer changes; lower resolution while dragging. Export (`export/Exporter.ts`) is a one-shot uncached render at up to 8192 px with GPU Jump-Flooding edge padding, then pixels are encoded in Rust (Tauri) or JS (`platform/pngEncode.ts`, web). Cached and one-shot renders must stay pixel-identical (checked by golden tests). Compiled programs and asset textures are cached in `pipeline/resources.ts`; WebGL context loss is handled in `Renderer.ts`. See `Docs/Review/` for past issues in this area.

## Branding

Source images are in `branding/`. After replacing them: `python scripts/make-branding.py` (needs Pillow), then `pnpm tauri icon app-icon.png`.
