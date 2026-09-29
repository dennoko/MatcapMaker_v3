# 09. 拡張：FBX 読み込み・アプリアイコン・開発元ロゴ

v4 の完成後に追加する 3 つの拡張の計画と実装メモです。

## 1. プレビューメッシュの FBX 対応

### 方針
- OBJ / GLB と同じく **TypeScript の自前パーサー**で読む（`src/render/preview/fbx.ts`）。
  - 外部ライブラリ（three.js の FBXLoader、Autodesk FBX SDK など）は使わない。three.js はサイズが大きく、FBX SDK は再配布の条件があるため。
  - プレビューに必要なのは「位置・法線・三角形」だけなので、数百行で足りる。
- FBX のコードは **動的 import** で別チャンクに分け、FBX を開いたときだけ読み込む（起動の速さを保つ）。
- 圧縮配列（zlib）はブラウザ標準の `DecompressionStream('deflate')` で展開する。WebView2 と Node 18 以降で使える。

### 対応範囲
| 項目 | 対応 |
|---|---|
| バイナリ FBX | 6.x〜7.7（7.5 以降の 64bit オフセット、ビッグエンディアンの古いファイルも含む） |
| ASCII FBX | 7.x（`*N { a: … }` 配列）と 6.x（ジオメトリが Model の中にあり、配列がカンマ区切りの形式） |
| ジオメトリ | `Geometry`（`Mesh`）の `Vertices` / `PolygonVertexIndex`。多角形は扇形に三角形分割する |
| 法線 | `LayerElementNormal`（`ByPolygonVertex` / `ByVertice` / `ByPolygon`、`Direct` / `IndexToDirect`）。法線がなければ面から計算する |
| 変換 | `Connections` から Model の親子関係をたどり、`Lcl Translation / Rotation / Scaling`、`RotationOrder`、`Pre/PostRotation`、ピボット、`Geometric*` を掛ける |
| 座標系 | `GlobalSettings` の `UpAxis` / `FrontAxis` / `CoordAxis` を見て Y-up に変換する（3ds Max などの Z-up にも対応） |
| 非対応 | スキニングやブレンドシェイプの適用、アニメーション、NURBS（プレビューの形の確認には不要） |

最後に中心とサイズを正規化するので、単位（cm / m）の違いは気にしなくてよい。
メッシュのない FBX（アニメーションだけのファイルなど）は、既存の「メッシュを読み込めませんでした」エラーになる。

### UI の変更
- 「メッシュを読み込む（OBJ / GLB / FBX）…」のファイル選択に `.fbx` を追加する。
- ドラッグ＆ドロップの判定に `.fbx` を追加する。拡張子の一覧は `mesh.ts` の `MESH_EXTENSIONS` / `MESH_FILE` にまとめる。
- `parseMesh` は FBX の展開のために非同期（`Promise`）になる。

### テスト
- `tests/core/fbx.test.ts`：テスト内の小さな FBX 書き出し関数でバイナリを作って読む（7.4 / 7.5、圧縮あり）。モデルの回転、Z-up の変換、ASCII 7.4（2^53 を超える ID を含む）、ASCII 6.1。
- 手元にある実際の FBX 80 個（Blender / 3ds Max / Maya / Unity のサンプル）で読み込みを確認する。メッシュを持つファイルはすべて読め、ビッグエンディアンの 6.0 も読めた。

## 2. アプリアイコンの差し替え

- 元画像：`branding/app-icon-source.png`（2048 px、透過 PNG）。
- `scripts/make-branding.py`（Pillow が必要）で次のファイルを作る。
  - `app-icon.png`：1024 px。`pnpm tauri icon app-icon.png` の入力になり、`src-tauri/icons/`（`icon.ico` は 16〜256 px の 6 サイズ、各 PNG）を作る。
  - `public/favicon.png`：256 px。Web 版のファビコン、バージョン情報、ヘッダーのアイコンに使う。
- `tauri icon` が作る Android / iOS / macOS / Microsoft Store 用のファイルは使わないので削除する（Windows 専用の配布のため）。
- 以前のアイコンを作っていた `scripts/make-icon.mjs` は不要になるので削除する。
- ヘッダーのメニューの左に 22 px のアプリアイコンを置く。

## 3. 開発元ロゴ（dennokoworks）

- 元画像：`branding/dennokoworks-logo-source.png`（4096 px、黒のロゴ、背景は透過）。
- `make-branding.py` で余白を切り詰め、**色を反転して白にし**、高さ 160 px に縮めて `src/assets/dennokoworks-logo.png` に出力する。
- 表示には `DevLogo.svelte` を使う。PNG を **CSS マスク**として使い、`currentColor` で塗る。
  - ダークテーマでは白っぽく、ライトテーマでは黒っぽくなり、テーマに合わせて自動で色が変わる。
  - 文字色のトークン（`--text` / `--text-3`）に合わせるので、UI の他の文字と明るさがそろう。
- 配置
  | 場所 | 内容 |
  |---|---|
  | ヘルプ → バージョン情報 | アプリ名の右に「開発 / Developed by」と大きめのロゴ。クリックで開発元のページを開く |
  | ステータスバーの右端 | 高さ 13 px の小さなロゴを控えめな色で表示。クリックでバージョン情報を開く |
- 作業画面の邪魔にならないよう、ツールバーやビューポートには置かない。
