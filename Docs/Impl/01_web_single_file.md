# 01. Web 版（HTML 1 ファイル配布）

ユーザーが HTML ファイルを 1 つ開くだけでブラウザ上で Matcap Maker が使えるようにする。
あわせて、**本体（デスクトップ版）の更新に手間なく追従でき、配布も手間がかからない**構成にする。

## 1. 方針

1. **フォークしない**：Web 版は別ブランチ・別リポジトリにせず、同じソースから「ビルドターゲットの 1 つ」として生成する。本体に入った機能はそのまま Web 版にも入る。
2. **差分は `src/platform/` に閉じ込める**：UI やコアに「Web かどうか」の分岐を散らさない。UI は「何ができるか（capability）」だけを見る（§3）。
3. **成果物は 1 つ**：`MatcapMaker.html`（JS・CSS・画像・シェーダーをすべてインライン化）。GitHub Pages とリリース添付の両方に同じファイルを使う。
4. **壊れたら CI で気づく**：PR ごとに 1 ファイル版をビルドし、`file://` で開いて動作確認する。本体側の変更で Web 版が壊れた時点で分かるようにする（§5）。
5. **プロジェクト形式は共通**：`.mcproj` はデスクトップ版と Web 版で相互に開ける。Web 専用の形式は作らない。

## 2. 現状

| 項目 | 状態 |
|---|---|
| Web 用 Platform 実装 | `src/platform/web.ts` にある。開く：`<input type=file>`、保存：ダウンロード、プリセット／復旧：IndexedDB、設定：localStorage |
| ビルド | `pnpm build:web` → `dist-web/`（HTML + JS + CSS の複数ファイル）。Tauri のコードは `__WEB_BUILD__` によって除外済み |
| `file://` での起動 | 不可の見込み。Chromium 系は `file://` から外部 module script を読み込めない |
| サイズ | JS 約 330 KB + ライセンス一覧 約 1.3 MB（Rust クレートを含む全件）。About ダイアログが 1 MB の元画像 `branding/app-icon-source.png` を読み込んでいる |
| 機能差 | EXR 書き出し、上書き保存、プラグイン、フォルダを開く、は Web 版では使えない |
| 分岐の書き方 | UI 側に `platform.kind === 'tauri'` が十数か所ある。`$platform/web` の関数（`webSavePresetIndex`、`webMarkRecoveryTime`）を UI から直接呼んでいる |

## 3. 本体への追従を容易にする設計

### 3.1 `platform.kind` ではなく capability で分岐する

`Platform` に「できること」の一覧を持たせ、UI はこれだけを見る。

```ts
// src/platform/types.ts
export interface PlatformCaps {
  exr: boolean;            // EXR 書き出し
  overwriteSave: boolean;  // 開いたファイルへの上書き保存（Web：File System Access API がある場合）
  revealInFolder: boolean; // 「フォルダを開く」
  plugins: boolean;        // プラグインの読み込み
  fileAssociation: boolean;// 「プログラムから開く」/ 二重起動の転送
  persistentStorage: boolean; // 設定・プリセット・自動保存が残るか（file:// で使えない環境あり）
}

export interface Platform {
  kind: 'tauri' | 'web';   // ログ・About 表示専用。機能分岐には使わない
  caps: PlatformCaps;
  ...
}
```

- 本体に「ネイティブが必要な機能」を足すときは capability を 1 つ足す。`PlatformCaps` はどちらの実装でも必須のプロパティなので、**Web 側で対応するかどうかを型エラーによって必ず決めさせられる**。
- 既存の `platform.kind === ...` はすべて capability に置き換える（ExportDialog の形式リスト、MenuBar、SettingsDialog、BenchmarkDialog、actions.ts）。
- `webSavePresetIndex` / `webMarkRecoveryTime` は `Platform` のメソッド（`savePreset`、`saveRecovery` など）の中へ移し、UI から `$platform/web` を import しない。

### 3.2 共通化できる処理は TS 側に寄せる

| 処理 | 置き場所 | 備考 |
|---|---|---|
| PNG エンコード | `src/platform/pngEncode.ts`（既存） | Web で使用。デスクトップは Rust |
| EXR エンコード | `src/platform/exrEncode.ts`（新規） | half float + ZIP 圧縮（fflate）。デスクトップは引き続き Rust の `exr` クレート |
| `.mcproj` の zip 入出力 | `src/platform/unzip.ts` + fflate（既存） | |

エンコーダを 2 系統持つことになるので、**同じピクセルを Rust と TS でエンコードし、デコード結果が一致する**ことをテストで保証する（§5）。

### 3.3 ビルド設定は 1 か所

- `vite.config.ts` に `mode === 'single'` を追加する。`web` モードとの違いは「インライン化するかどうか」だけにする。
  - `build.assetsInlineLimit = Infinity`、`cssCodeSplit = false`、`rollupOptions.output.inlineDynamicImports = true`
  - JS と CSS を HTML に埋め込む Vite プラグイン（`vite-plugin-singlefile` か、数十行の自作プラグイン）
  - 出力先：`dist-single/MatcapMaker.html`
- `define` の `__WEB_BUILD__` は `web` と `single` の両方で `true` にする。1 ファイル版に固有の処理が必要な場合だけ `__SINGLE_FILE__` を足す（更新通知のリンク先など）。
- バージョンは `version.json` だけが情報源。
- `pnpm build:single` を追加する。GitHub Pages も同じ成果物を使うため、`build:web`（複数ファイル版）は廃止する。

### 3.4 ライセンス一覧とアセットの軽量化

- `scripts/gen-licenses.mjs` に `--target web` を追加し、**Web 版の JS バンドルに実際に入った npm パッケージだけ**を出力する（Rust クレートと Tauri のパッケージを除外）。`vite build` の module graph（`rollup-plugin-visualizer` 相当の情報、または Vite の manifest）から実際に使われたパッケージを求めると、依存を追加したときに手作業での更新が要らない。
- About ダイアログのアイコンは `src-tauri/icons/128x128.png` のような小さい画像に変える。ファビコンも同様。
- **サイズ予算**：`MatcapMaker.html` を 1.5 MB 以下にする。CI で超えたら失敗させる。

## 4. `file://` で動かすための対策

| 課題 | 対策 |
|---|---|
| 外部 JS が読み込めない | §3.3 のインライン化で解決 |
| 動的 import（ライセンス一覧、FBX ローダー） | `inlineDynamicImports` で本体に含める。ライセンス一覧は fflate で圧縮した base64 として埋め込み、開いたときに展開してもよい |
| 保存領域の共有 | Chromium はローカルのすべての HTML で localStorage / IndexedDB を共有する。キーは `matcap-maker` 名前空間で分けてあるので、IndexedDB のバージョンを上げるときのマイグレーションを `web.ts` に用意する |
| 保存領域が使えない環境 | Safari の一部やプライベートモード。`idb()` が失敗したらメモリ上の代替に切り替え、`caps.persistentStorage = false` にする。UI は起動時に 1 回だけ「このブラウザでは自動保存とプリセットが残りません」と通知する |
| 複数タブ | 自動保存データが 1 つのキーを取り合う。`navigator.locks` で 1 タブだけが復旧データを書くようにし、2 つ目のタブには警告を出す |
| WebGL2 がない | 起動時に確認して案内画面を出す（例外で白画面にしない） |
| 外部通信 | 更新確認（GitHub API、CORS 許可あり）以外は行わない。オフラインで完結する |
| 終了時の確認 | 既存の `beforeunload` + `__mmDirty` をそのまま使う |

## 5. テストと CI（追従の要）

| テスト | 内容 | 実行タイミング |
|---|---|---|
| 1 ファイル版スモーク | `build:single` → Playwright で `file:///…/MatcapMaker.html` を開き、起動・レイヤーの追加と編集・PNG 書き出し（download イベント）・`.mcproj` の保存→再読み込み・リロード後の復旧ダイアログを確認する。**外部通信はすべて遮断**して行う | PR ごと（CI） |
| バンドル検査 | HTML に `__TAURI_INTERNALS__` や `plugin:` の呼び出しが含まれないこと、外部 `src=` / `href=` がないこと、サイズが予算内であること | PR ごと（CI） |
| エンコーダ一致 | 同じピクセルを TS と Rust でエンコードし、デコード結果が一致すること（PNG 16bit、EXR） | PR ごと（`pnpm test`） |
| クロスブラウザ | Firefox / WebKit で起動と PNG 書き出しだけ確認 | リリース時 |
| 描画結果 | 既存のゴールデン画像テストがそのまま Web のレンダラーを検証している。追加は不要 | 既存 |

`ui.spec.ts` のシナリオは、URL を差し替えるだけで開発サーバー版と 1 ファイル版の両方に流せる形にする（Playwright の project を 2 つ定義する）。UI テストを本体側に足せば、Web 版にも自動で適用される。

## 6. 配布

### 6.1 リリース

`release.yml`（タグ `v*` を push）に次を追加する。

1. `pnpm build:single`
2. リリースに 2 つの名前で添付する
   - `MatcapMaker_<ver>_web.html`（バージョン付き。アーカイブ用）
   - `MatcapMaker_web.html`（固定名）→ `https://github.com/dennoko/MatcapMaker_v3/releases/latest/download/MatcapMaker_web.html` が**常に最新版を指す**ので、README や告知のリンクを更新する必要がない
3. `SHA256SUMS.txt` に HTML も含める

### 6.2 GitHub Pages

- 同じ `MatcapMaker.html` を `index.html` として配置する（`actions/deploy-pages`）。
- デプロイはタグ時だけにする。main の未リリースの変更を公開しない。

### 6.3 更新通知

- デスクトップ版と同じ `src/app/updates.ts` を使う。Web 版ではリンク先を 6.1 の固定名 URL にする。
- Pages で開いている場合は再読み込みするだけで最新版になるので、通知は出さない（`location.protocol` で判定）。

### 6.4 README

「Web 版」の節を追加する：Chrome / Edge 推奨、ダウンロードしてダブルクリックで起動、データはそのブラウザ内に保存されること、EXR などの制限、メールで HTML の添付がブロックされる場合は zip で渡すこと。

## 7. 機能差の解消（優先度順）

| 機能 | Web での実装 | capability |
|---|---|---|
| 上書き保存（Ctrl+S） | Chromium：File System Access API（`showOpenFilePicker` / `showSaveFilePicker` で得たハンドルに書き込む）。非対応のブラウザは従来どおりダウンロード | `overwriteSave` |
| EXR 書き出し | `exrEncode.ts`（§3.2） | `exr` |
| プラグイン | フォルダ（`webkitdirectory`）か zip を取り込んで IndexedDB に保存し、`pluginsList()` で返す。読み込みは既存の `pluginLoader.ts` を使う | `plugins` |
| フォルダを開く / ファイル関連付け | 対応しない | `revealInFolder` / `fileAssociation` = false |

## 8. 作業手順

| 段階 | 作業 | 完了条件 |
|---|---|---|
| A. 分岐の整理 | `PlatformCaps` を導入し、`platform.kind` での分岐と `$platform/web` の直接 import をなくす | 挙動が変わらず、既存テストがすべて通る |
| B. 1 ファイル化 | `single` モード、`build:single`、ライセンス一覧の Web 用出力、アイコンの軽量化 | `file://` で起動し、1.5 MB 以下 |
| C. `file://` 対策 | §4（保存領域の代替、複数タブ、WebGL2 確認） | Chrome / Edge / Firefox で起動・保存・復旧ができる |
| D. CI | §5 のスモークテスト・バンドル検査・サイズ予算 | PR で自動実行される |
| E. 配布 | §6（リリース添付、Pages、更新通知、README） | タグを push するだけで exe と HTML がそろう |
| F. 機能差 | §7 を上から順に | 各 capability が `true` になる |

A〜E で「1 ファイルで動き、本体に追従し、タグ 1 つで配布される」状態になる。F は独立しているので、必要になった順に進められる。

## 9. 本体を変更するときのルール

- ネイティブ（Rust）が必要な機能を足すときは、`PlatformCaps` に項目を足し、Web 側の扱い（実装する／`false` にする）を同じ PR で決める。
- UI の分岐は `platform.caps.*` だけで書く。`platform.kind` は使わない。
- 画像などの静的アセットを増やすときは、サイズ予算を確認する（Web 版にはすべてインライン化される）。
- 新しい依存パッケージを追加しても、ライセンス一覧は自動生成されるので手作業は要らない。

## 10. 未決事項

| 項目 | 既定案 |
|---|---|
| 対象ブラウザ | Chrome / Edge を保証し、Firefox / Safari はベストエフォート |
| 初版に含める機能差の解消 | 上書き保存のみ。EXR とプラグインは後から |
| 1 ファイル版のサイズ予算 | 1.5 MB |
