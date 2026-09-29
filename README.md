# Matcap Maker

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
| プレビュー | 球体 / 平面 / ノーマルマップ付き球体 / 比較 / 選択レイヤーの前後比較 / 任意メッシュ（OBJ・GLB・FBX） |
| 書き出し | PNG 8/16bit（straight alpha）/ JPG / EXR（half）、64〜8192 px、GPU（Jump Flooding）によるエッジパディングとその拡大プレビュー、クイックエクスポート（Ctrl+E） |
| その他 | 日本語/英語のその場切り替え、ダーク/ライトテーマ、プリセット、自動保存とクラッシュ復旧、初回ツアー、新バージョン通知、プラグインレイヤー |

主なショートカットはアプリ内の **F1** で一覧できます。

## Web 版

[Web 版をダウンロード](https://github.com/dennoko/MatcapMaker_v3/releases/latest/download/MatcapMaker_web.html)して、HTML をダブルクリックするか Chrome / Edge にドラッグして開きます。[GitHub Pages](https://dennoko.github.io/MatcapMaker_v3/) でも同じ版を利用できます（リリース公開・Pages 初回設定後に有効）。HTML 1 ファイルに必要なコード・画像・ライセンスを含み、オフラインで編集できます。Firefox / Safari はベストエフォートです。WebGL2 とハードウェアアクセラレーションが必要です。

- `.mcproj` はデスクトップ版と共通です。PNG 8/16bit・JPG を書き出せます。Web 初版では EXR、ユーザープラグイン、フォルダ表示、OS のファイル関連付けは使えません。
- 対応ブラウザではファイル選択ダイアログで選んだプロジェクトに Ctrl+S で上書きします。ドラッグ＆ドロップで開いたファイルは、最初の保存時に保存先を選びます。非対応環境では毎回ダウンロードします。リロード後はファイルを開き直すか「名前を付けて保存」を使ってください。
- 設定・ユーザープリセット・復旧データはそのブラウザの保存領域に置かれます。ブラウザ・プロファイル・URL・HTML の置き場所を変えた場合の引き継ぎは保証されません。サイトデータ削除やプライベートモードで失われるため、大切な作品は `.mcproj` として保存してください。
- 保存領域が使えないときは通知し、そのタブ内だけでデータを保持します。複数タブでは最初のタブだけが復旧データを使用します。後から開いたタブ、またはタブ間ロックを使えない環境では自動保存を停止します。最初のタブを閉じた後は、残りのタブを再読み込みすると再取得できます。
- HTML は自動更新されません。更新通知から最新版をダウンロードしてください。Pages では再読み込みで更新するため通知しません。自動通信は設定で有効な更新確認（GitHub API）のみです。
- メールなどで HTML 添付が拒否される場合は zip にして渡してください。配布元と `SHA256SUMS.txt` を確認してから開いてください。

開発・配布担当者向けの手順は [Web 版の運用](Docs/web-operations.md) を参照してください。

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
pnpm build:single     # dist-single/MatcapMaker.html を生成し、1.5 MB の予算と外部依存を検査
pnpm test:golden      # build:single 後：描画ゴールデン + 開発版/単一HTMLのUIテスト
pnpm test:single      # build:single 後：file:// のオフラインUI・入出力・復旧テスト
pnpm tauri build      # リリースビルド
```

成果物：

```
src-tauri/target/release/matcap-maker.exe                              ← ポータブル版
src-tauri/target/release/bundle/nsis/MatcapMaker_<ver>_x64-setup.exe   ← インストーラ
dist-single/MatcapMaker.html                                         ← Web版（単一HTML）
```

バージョンの唯一の情報源は `package.json` の `version` です（`tauri.conf.json` はこれを参照します）。
タグ `v<version>` を push すると `.github/workflows/release.yml` がビルドし、下書きのリリースに exe・インストーラ・固定名とバージョン付きの Web HTML・`SHA256SUMS.txt` を添付します。同じ HTML を Pages に配置します。`latest/download` のリンクは下書きを公開するまで更新されません。

### 構成

```
src/core/      UI 非依存のコア（モデル、パラメータスキーマ、レイヤー定義 .ts + .glsl、コマンド/履歴、入出力、i18n）
src/render/    WebGL2 レンダラー（差分キャッシュ付きパイプライン、プレビュー、エクスポート + JFA パディング）
src/platform/  Platform インターフェース（Tauri 実装 / Web 実装）
src/app/       Svelte UI
src-tauri/     Rust：画像エンコード（PNG/JPG/EXR）、.mcproj（zip）入出力、設定・ログ・復旧データ
tests/         Vitest（core）と Playwright（golden / UI）
```

アプリアイコンと開発元ロゴの元画像は `branding/` にあります。差し替えたら `python scripts/make-branding.py`（Pillow が必要）→ `pnpm tauri icon app-icon.png` を実行します。

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
