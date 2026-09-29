# 02. バージョンチェックの仕組み導入

GitHub パブリックリポジトリ上の `version.json` を参照し、利用中のバージョンよりも新しいリリースが存在するか確認する仕組みを Matcap Maker v3 に導入します。
本設計は、姉妹ツールである [DennokoMeshEditor](https://github.com/dennoko/DennokoMeshEditor) で採用されている実績のある方式をベースとし、Windows（Tauri デスクトップ）版および Web（単一 HTML 配布含む）版の双方で安定して機能する構成とします。

---

## 1. 背景と目的

### 現状の課題
現在、Matcap Maker v3 の `src/app/updates.ts` には GitHub Releases API (`https://api.github.com/repos/.../releases`) を利用した簡易的な更新通知ロジックが存在しますが、以下の課題を抱えています：
1. **GitHub API のレート制限（Rate Limit）**：
   未認証の `api.github.com` は IP あたり 1 時間 60 リクエストという厳しい制限があります。同一ネットワーク環境や NAT 環境でツールを起動すると、容易に 403 / 429 エラーとなり更新確認に失敗します。
2. **CSP（Content Security Policy）と通信先の不整合**：
   Tauri のデスクトップ設定（`src-tauri/tauri.conf.json`）の `connect-src` には `https://api.github.com` のみが記載されており、別ドメインからのバージョン取得に対応していません。
3. **UI での手動確認・状態把握の欠如**：
   起動時のみの非通知チェックとなっており、About（情報）ダイアログ等でユーザーが「現在最新版なのか」「確認に失敗したのか」を能動的に確認・再試行する導線がありません。

### 導入の狙い
DennokoMeshEditor と同様に、リポジトリルートに配置された静的な `version.json` を `raw.githubusercontent.com` 経由で取得する方式に移行します。
これにより、**API レート制限を完全に回避**し、CDN（Fastly）経由の高速・安全なバージョンチェックを実現します。

---

## 2. DennokoMeshEditor 方式の仕様

DennokoMeshEditor で採用されているバージョンチェック方式の主要な仕様は以下の通りです：

### 2.1 `version.json` の仕様
リポジトリのルートに配置する静的 JSON ファイルです。

```json
{
  "version": "3.0.0",
  "url": "https://github.com/dennoko/MatcapMaker_v3/releases",
  "message": ""
}
```

| フィールド | 型 | 役割 |
|---|---|---|
| `version` | string | 現在の最新バージョン番号（セマンティックバージョニング準拠） |
| `url` | string | 更新配布先 URL（通常は GitHub リリース一覧ページ） |
| `message` | string | 緊急告知や補足メッセージ（任意、空文字可） |

### 2.2 取得元エンドポイント
`api.github.com` ではなく、静的ファイル配信ドメインを使用します。
```
https://raw.githubusercontent.com/dennoko/MatcapMaker_v3/{branch}/version.json
```
- **メリット**：Fastly CDN 経由で静的キャッシュ配信されるため、GitHub API レート制限（60 req/h）の対象外。
- **取得ブランチ**：`main` のみを参照します（候補ブランチのフォールバックは行いません）。
- **過剰試行の防止**：1 回の確認につきリクエストは 1 回で、失敗（HTTP 403 / 429 を含む）してもリトライしません。自動確認はセッション中 1 回だけで、以降は About ダイアログのユーザー操作でのみ再取得します。

### 2.3 バージョン比較・正規化ルール
- 先頭の `v` や `V` を除去（例: `v3.0.0` → `3.0.0`）。
- BOM や前後の空白を除去。
- プレリリース記号やビルドメタデータ（`-beta`, `+build` など）を除去して比較。
- 2 桁以下の表記（`3`, `3.0`）は 3 桁（`3.0.0`）へゼロ埋めし、誤判定を防止。
- 数値による SemVer 比較（メジャー > マイナー > パッチ）。

---

## 3. プラットフォーム別検証と権限まわりの扱い（重点確認）

Windows（Tauri デスクトップ）版および Web 版（ブラウザ／単一 HTML `file://` 配布）の双方で本方式が実現可能か、権限・セキュリティ面を精査しました。

### 3.1 Windows 版（Tauri 2 デスクトップ）の検証

#### (1) 通信手段の選定
- **方針**：フロントエンド（WebView2）の標準 `window.fetch()` を継続利用します。
- **理由**：
  - 軽量であり、Rust 側の HTTP プラグイン（`@tauri-apps/plugin-http`）やパーミッション設定を追加する必要がありません。
  - Web 版と完全に同一の TypeScript ロジックを共有できます。

#### (2) CSP（Content Security Policy）の制約と対応【必須変更】
- **現状の制約**：
  `src-tauri/tauri.conf.json` の `app.security.csp` は以下の通りです：
  ```
  connect-src 'self' ipc: http://ipc.localhost https://api.github.com;
  ```
  `raw.githubusercontent.com` が許可されていないため、このままでは WebView2 の CSP 違反となり、`fetch()` がブラウザ層で**即座にブロック**されます。
- **必要な対応**：
  `connect-src` に `https://raw.githubusercontent.com` を追加します。
  ```json
  "security": {
    "csp": "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' ipc: http://ipc.localhost https://api.github.com https://raw.githubusercontent.com; worker-src 'self' blob:"
  }
  ```

#### (3) Tauri Capabilities / Permissions
- 標準 `fetch()` を使用するため、`src-tauri/capabilities/default.json` への HTTP 関連パーミッションの追加は**不要**です。
- 更新通知をクリックした際にブラウザで GitHub リリース等の URL を開く処理（`platform.openUrl(url)`）は、既に `capabilities/default.json` に `"opener:allow-open-url"` が付与されており、権限上の問題はありません。

#### (4) オフライン・エラー耐性
- ネット未接続時、DNS 解決失敗時、プロキシ環境等でもアプリ起動をブロックしないよう、タイムアウト（AbortController で 8 秒）を設定し、例外はすべて捕捉してサイレントに扱います。
- タイムアウトはヘッダ受信だけでなく本文（`res.json()`）の読み込みまで含めます。本文が途中で止まっても `checking` 状態に張り付かず、`error` に遷移して再確認できます。
- HTTP エラー（404・403・429 など）、不正な JSON、`version` 欠落はいずれも `error` とし、原因をログ（`warn`）に残します。リトライは行いません。
- 取得した `url` は `https://` で始まる場合のみ使用し、それ以外は Releases ページへフォールバックします。単一 HTML 版は常に `MatcapMaker_web.html` の直リンクを開きます。

---

### 3.2 Web 版（単一 HTML 配布およびホスト版）の検証

#### (1) CORS（Cross-Origin Resource Sharing）
- **確認結果**：
  `https://raw.githubusercontent.com/...` は、レスポンスヘッダーに `Access-Control-Allow-Origin: *` および `Cross-Origin-Resource-Policy: cross-origin` を返しています（実測確認済み）。
- **影響**：
  任意のオリジン（GitHub Pages、ローカル開発サーバーなど）から直接 `fetch()` しても、ブラウザの CORS ポリシーによってブロックされることはありません。

#### (2) `file://` プロトコル（単一 HTML 版のローカル実行）
- **確認結果**：
  `dist-single/MatcapMaker.html` をローカルドライブからダブルクリックで起動した場合（`file:///...`）、近代的なブラウザ（Chrome, Edge, Firefox, Safari）では `Access-Control-Allow-Origin: *` が付与された HTTPS エンドポイントへの GET リクエストは正常に完了します。
- **運用上の配慮**：
  単一 HTML 配布版はオフライン環境（機密環境やネット遮断環境）で使われるケースが多いため、通信失敗時はエラーダイアログを出さず、ステータスを静かに維持する設計が必須です。

#### (3) ホスト版（GitHub Pages 等）での動作方針
- **現行仕様の継承と拡張**：
  - 現行コード（`src/app/updates.ts`）では `if (__WEB_BUILD__ && location.protocol !== 'file:') return;` となっており、GitHub Pages などのホスト環境では起動時の自動通知をスキップしています（リロードすれば常に最新になるため、通知が不要）。
  - **新方針**：
    - **起動時自動チェック**：デスクトップ版および `file://` 版（単一 HTML 配布）でのみ実行する。
    - **About ダイアログの手動チェック**：ホスト版 Web でも実行可能とし、「現在のバージョンは最新です」などを確認できるようにする。

---

### 3.3 結論：実現可能性と権限上の課題まとめ

| プラットフォーム | 通信可否 | 権限・セキュリティ要件 | 必要な対処 |
|---|---|---|---|
| **Windows 版 (Tauri)** | **可能** | WebView2 の CSP 制限 | `tauri.conf.json` の `connect-src` に `https://raw.githubusercontent.com` を追加 |
| **Web 版 (単一 HTML `file://`)** | **可能** | なし（CORS `*` 許可済み） | オフライン時のサイレントフォールバック、タイムアウト設定 |
| **Web 版 (ホスト/Pages)** | **可能** | なし（CORS `*` 許可済み） | 起動時自動通知は抑制し、手動確認のみ対応 |

**権限まわりの問題は、Tauri の CSP 設定に 1 ドメインを追加するだけで完全に解消され、両プラットフォームともに同一ロジックで安全に実装可能**です。

---

## 4. バージョン管理と整合性の維持（SSOT）

Matcap Maker v3 におけるバージョンの正（Single Source of Truth）は `package.json` の `"version"` です（`CLAUDE.md` 参照）。

### 課題：`version.json` の手動更新漏れ防止
リポジトリルートに `version.json` を配置した場合、「`package.json` のバージョンは更新したが、`version.json` を更新し忘れた」という事故が起こり得ます。

### 対策：CI およびチェックスクリプトでの自動検証
1. **チェックスクリプトの作成または拡張**：
   `scripts/check-version.mjs` を用意し、以下を検証します：
   - `package.json` の `version` とルートの `version.json` の `version` が完全に一致していること。
   - `version.json` の JSON 構造が正しく、`url` が設定されていること。
2. **CI（`.github/workflows/ci.yml`）への組み込み**：
   PR ごとの検査ステップ（`pnpm check` や `pnpm test` の一環）でスクリプトを実行し、不整合があれば即座に CI を落とします。
3. **リリースフローとの連動**：
   タグ push（`v*`）時に `release.yml` でも整合性を確認します。

### 注意：通知タイミングとプレリリース
- 利用者は main の `version.json` を見て通知されます。`check-version.mjs` により `package.json` と一致が必須のため、**main でバージョンを上げた時点で通知が始まります**。バージョン更新コミットはタグ push と同時に main へ入れ、`release.yml` が失敗した場合は速やかに修正または差し戻してください（ダウンロード先が存在しない通知を出さないため）。
- 比較ではプレリリース記号を除去します（`3.1.0-beta` は `3.1.0` 扱い）。プレリリース版を main の `package.json` に設定すると安定版利用者に通知され、ベータ利用者には正式版が通知されません。プレリリースは main 以外のブランチで扱ってください。

---

## 5. 設計詳細

### 5.1 モジュール構成

```
src/
  app/
    updates.ts               # バージョンチェックのコアロジック（刷新）
    state.svelte.ts          # バージョン確認ステータスのリアクティブ保持
    dialogs/
      AboutDialog.svelte     # 状態表示と手動チェックボタンの追加
      SettingsDialog.svelte  # 起動時チェック有効/無効トグル（既存）
    layout/
      StatusBar.svelte       # 更新通知ボタン（既存）
version.json                 # リポジトリルートに新規配置
src-tauri/
  tauri.conf.json            # CSP に raw.githubusercontent.com を追加
```

### 5.2 状態管理モデル

`src/app/updates.ts` で以下のステートと結果型を定義します：

```ts
export type VersionCheckState = 'idle' | 'checking' | 'upToDate' | 'updateAvailable' | 'error';

export interface VersionInfo {
  version: string;
  url: string;
  message?: string;
}

export interface VersionCheckResult {
  state: VersionCheckState;
  currentVersion: string;
  latestVersion?: string;
  url?: string;
  message?: string;
}
```

### 5.3 状態保持とキャッシュ
- **セッションキャッシュ**：
  同一セッション中に何度も About ダイアログを開閉しても無駄な HTTP リクエストが発生しないよう、直近の結果をメモリ上にキャッシュします。
- **手動再試行（強制チェック）**：
  About ダイアログの「更新を確認」ボタンを押した場合は、キャッシュを破棄して即座に GitHub から再取得します。
- **起動時自動チェック**：
  アプリ起動時に `app.settings.checkUpdates` が有効、かつデスクトップ版または `file://` 版である場合に非同期実行します。

### 5.4 UI 連携仕様

1. **TopBar（常時表示ヘッダー）**：
   - 画面上部中央（ロゴの横）にバージョンバッジ（`.ver-badge`）を常時配置。
   - **通常時**：落ち着いたモノスペース表記（`v3.0.0`）。クリックで About ダイアログを開く。
   - **更新時**：鮮やかな緑色（`#00e676`、エメラルドグリーン）のハイライト・発光シャドウ・パルスアニメーションにより目立たせ、`v3.0.0 → v3.1.0 [更新]` と表示。クリックでダウンロードページ（リリース先）を開く。
2. **StatusBar**：
   - `updateAvailable` 状態のとき、右下に「バージョン {version} が利用できます」ボタンを表示（クリックで更新先 URL を開く）。
3. **AboutDialog**：
   - 現在のバージョン表示（`v3.0.0 · Desktop`）の直下にステータスを表示：
     - **最新の場合**：「✓ 最新バージョンです」+ [再確認] ボタン
     - **更新がある場合**：「新バージョン vX.X.X が利用可能です」+ [更新ページを開く] ボタン
     - **確認中の場合**：「更新を確認中…」
     - **エラーの場合**：「更新の確認に失敗しました」+ [再確認] ボタン
   - 手動再確認ボタンにより、セッションキャッシュをバイパスして即座に GitHub から最新情報を再取得可能。

---

## 6. 実装ステップ

### Phase 1: リポジトリ構成と権限設定
- [x] ルートに `version.json` を作成（現在のバージョン `3.0.0` を設定）。
- [x] `src-tauri/tauri.conf.json` の CSP `connect-src` に `https://raw.githubusercontent.com` を追加。
- [x] `scripts/check-version.mjs` を作成し、`package.json` とのバージョン整合性をチェックできるようにする。

### Phase 2: バージョン比較・通信モジュールの刷新
- [x] `src/core/util/version.ts` を新設し、SemVer 正規化・比較ユーティリティを実装。
- [x] `src/app/updates.ts` を刷新：
  - `raw.githubusercontent.com` からの非同期取得。
  - タイムアウト処理（8秒）およびエラー耐性の実装。
  - レート制限時の即時中断とフォールバック。
  - 状態（`idle`, `checking`, `upToDate`, `updateAvailable`, `error`）の管理。
- [x] 単体テスト（`tests/core/version.test.ts`）を作成：
  - バージョン比較（`3.0.0` vs `3.0.1`, `3.1` vs `3.0.9`, `v3.0.0-beta` など）の網羅テスト。

### Phase 3: UI 連携
- [x] `src/app/state.svelte.ts` にバージョンチェック結果のリアクティブ状態（`versionStatus`, `updateAvailable`）を整備。
- [x] `src/app/App.svelte` のトップバー中央に常時表示のバージョンバッジを配置。更新時は鮮やかな緑色で発光ハイライト。
- [x] `src/app/dialogs/AboutDialog.svelte` に状態表示と「更新を確認」/「再確認」ボタンを追加。
- [x] `src/core/i18n/{en,ja}.json` に必要な文言（最新状態、確認中、更新あり、再試行など）を追加。

### Phase 4: CI・自動テストへの組み込み
- [x] `package.json` の `check` スクリプトに `check:version`（`node scripts/check-version.mjs`）を追加し、CI で自動検証。
- [x] Playwright スモークテスト（`tests/golden/ui.spec.ts`）にトップバーのバージョンバッジ表示と About ダイアログ開閉テストを追加。

---

## 7. テスト計画

| テスト項目 | 確認内容 | 実行方法 |
|---|---|---|
| **SemVer 比較テスト** | 桁数不足（`3.0`）、先頭 `v`、大小比較が仕様通り動作するか | Vitest 単体テスト |
| **Windows 版 CSP 疎通** | Tauri アプリ内で `raw.githubusercontent.com` への fetch が CSP でブロックされないこと | デスクトップ版実機起動 + About 画面確認 |
| **Web 版 CORS 疎通** | ブラウザ環境（ローカルサーバー）で CORS エラーなく JSON を取得できること | `pnpm dev` でブラウザ検証 |
| **単一 HTML (`file://`) 動作** | `dist-single/MatcapMaker.html` を `file://` で開き、チェックが動作すること | Playwright / 実機ブラウザ確認 |
| **オフライン耐性** | ネット切断時にアプリがハングアップ・クラッシュせず、静かにエラー扱いになること | ネットワーク遮断下での起動テスト |
| **バージョン整合性検査** | `package.json` と `version.json` の値が食い違っている場合にスクリプトが正しく異常終了すること | CI / スクリプト単体実行 |
