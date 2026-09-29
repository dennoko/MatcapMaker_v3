# Matcap Maker v4

Matcap（Material Capture）テクスチャを、ライト・リム・グラデーション・ノイズ・画像などのレイヤーを重ねて作るツールです。
v3（Python + PySide6）を [Docs/Plan](Docs/Plan/README.md) に沿って **Tauri 2 + Svelte 5 + WebGL2** で作り直しました。

- 配布物はポータブル exe 単体（約 5 MB）と NSIS インストーラ（約 4 MB）。どちらも署名なし
- v3 のプロジェクト（`project.json`）をそのまま開けます（旧形式は取り込み時に変換し、元ファイルは変更しません）

## 主な機能

| 分類 | 内容 |
|---|---|
| レイヤー | ベタ塗り / スポットライト / フレネル・リム / ノイズ（ホワイト・シンプレックス）/ イメージ / グラデーション / 色調補正 / ブラー・シャープ / トーンカーブ / カラーランプ / 色収差 / フィルムグレイン / グループ / マスク |
| 描画モード | 通常・加算・乗算・スクリーン・減算・比較（明/暗）・オーバーレイ・ソフトライト・ハードライト・覆い焼きカラー・差の絶対値（v3 と同じ式） |
| 操作 | ビューポート上のギズモ（光の向き・回転・形、グラデーションの角度、画像の移動/回転/拡大、リムの太さ）、Undo/Redo（ドラッグは 1 手）、ドラッグ＆ドロップ、クリップボード貼り付け、コマンドパレット（Tab）、ソロ表示、複数選択 |
| プレビュー | 球体 / 平面 / ノーマルマップ付き球体 / 比較 / 選択レイヤーの前後比較 / 任意メッシュ（OBJ・GLB） |
| 書き出し | PNG 8/16bit（straight alpha）/ JPG / EXR（half）、64〜8192 px、GPU（Jump Flooding）によるエッジパディングとその拡大プレビュー、クイックエクスポート（Ctrl+E） |
| その他 | 日本語/英語のその場切り替え、ダーク/ライトテーマ、プリセット、自動保存とクラッシュ復旧、初回ツアー、新バージョン通知、プラグインレイヤー |

主なショートカットはアプリ内の **F1** で一覧できます。

## 開発

### 必要なもの（Windows）

```powershell
winget install Rustlang.Rustup OpenJS.NodeJS.LTS
winget install Microsoft.VisualStudio.2022.BuildTools   # 「C++ によるデスクトップ開発」
npm i -g pnpm
pnpm install
```

### コマンド

```powershell
pnpm tauri dev        # 開発（HMR）
pnpm check            # 型チェック（svelte-check）
pnpm test             # Vitest（コア）+ cargo test（Rust）
pnpm test:golden      # Playwright：シェーダーのゴールデン画像と UI のスモークテスト
pnpm tauri build      # リリースビルド
pnpm build:web        # ブラウザ版（dist-web/、GitHub Pages 用）
```

成果物：

```
src-tauri/target/release/matcap-maker.exe                              ← ポータブル版
src-tauri/target/release/bundle/nsis/MatcapMaker_<ver>_x64-setup.exe   ← インストーラ
```

バージョンの唯一の情報源は `package.json` の `version` です（`tauri.conf.json` はこれを参照します）。
タグ `v*` を push すると `.github/workflows/release.yml` がビルドし、下書きのリリースに exe・インストーラ・`SHA256SUMS.txt` を添付します。

### 構成

```
src/core/      UI 非依存のコア（モデル、パラメータスキーマ、レイヤー定義 .ts + .glsl、コマンド/履歴、入出力、i18n）
src/render/    WebGL2 レンダラー（差分キャッシュ付きパイプライン、プレビュー、エクスポート + JFA パディング）
src/platform/  Platform インターフェース（Tauri 実装 / Web 実装）
src/app/       Svelte UI
src-tauri/     Rust：画像エンコード（PNG/JPG/EXR）、.mcproj（zip）入出力、設定・ログ・復旧データ
tests/         Vitest（core）と Playwright（golden / UI）
```

新しいレイヤーは `src/core/layers/` に「定義（.ts）+ GLSL」の 2 ファイルを追加し、`registry.ts` に登録するだけで、
Inspector の UI・保存・既定値・uniform が自動で導かれます。

## プラグイン

`Documents\MatcapMaker\plugins\<名前>\` に `layer.json` と `layer.glsl`（フィルタは `pass0.glsl`…）を置くと、起動時にレイヤーとして読み込まれます。
JavaScript は実行しないため安全に追加できます。書式は [Docs/plugins.md](Docs/plugins.md)、サンプルは [examples/plugins](examples/plugins) を参照してください。

## 保存場所

| 内容 | 場所 |
|---|---|
| 設定・ログ・自動保存 | `%LOCALAPPDATA%\MatcapMaker\` |
| プリセット・プラグイン・書き出し先の既定 | `Documents\MatcapMaker\` |

ポータブル版は exe の横に何も書き込みません。

## 署名なし配布について

初回起動時に「Windows によって PC が保護されました」と表示された場合は、**詳細情報 → 実行** で起動できます。
改ざんされていないことは、リリースに添付の `SHA256SUMS.txt` と `Get-FileHash <ファイル> -Algorithm SHA256` の結果を比べて確認できます。
WebView2 ランタイムがない環境では、ポータブル版はダウンロードページを案内し、インストーラ版は自動でインストールします。

## ライセンス

サードパーティのライセンスはアプリの **ヘルプ → バージョン情報 / ライセンス** に一覧があります（ビルド時に `scripts/gen-licenses.mjs` で自動生成）。
