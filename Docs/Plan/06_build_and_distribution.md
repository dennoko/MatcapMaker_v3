# 06. ビルドと配布

## 1. 方針
- **配布物はポータブル .exe 単体を基本**とする（インストール不要、ダウンロードしてそのまま起動）。
- 希望者向けに NSIS インストーラ（スタートメニューへの登録、アンインストーラ付き）も同じコマンドで生成する。
- どちらも **コード署名はしない**。署名なしの前提で、警告と誤検知をできるだけ抑える工夫をする（§4）。

## 2. ビルド手順

### 2.1 開発環境のセットアップ（1 回だけ）
```powershell
winget install Rustlang.Rustup OpenJS.NodeJS.LTS
winget install Microsoft.VisualStudio.2022.BuildTools  # "C++ によるデスクトップ開発" ワークロード
corepack enable   # pnpm を有効化
pnpm install
```

### 2.2 日常的なコマンド
```powershell
pnpm tauri dev        # 開発（HMR あり。UI の変更は即時反映、Rust を変更すると再ビルド）
pnpm test             # Vitest（コア）+ cargo test
pnpm test:golden      # Playwright でゴールデン画像を比較
pnpm tauri build      # リリースビルド
```

### 2.3 成果物
```
src-tauri/target/release/matcap-maker.exe                         ← ポータブル版（約 10MB）
src-tauri/target/release/bundle/nsis/MatcapMaker_<ver>_x64-setup.exe ← インストーラ
```

- **バージョンの唯一の情報源**は `package.json` の `version`。`tauri.conf.json` は `"version": "../package.json"` でこれを参照する（Tauri 2 の機能）。
- プロジェクトファイルの `schemaVersion` は、アプリのバージョンとは独立して管理する（現行の方針を引き継ぐ）。

### 2.4 サイズ最適化（`Cargo.toml`）
```toml
[profile.release]
opt-level = "s"
lto = true
codegen-units = 1
panic = "abort"
strip = true
```
**UPX などの exe 圧縮ツールは使わない**（ウイルス対策ソフトの誤検知が大幅に増えるため）。

## 3. WebView2 ランタイム
| 配布物 | 方針 |
|---|---|
| ポータブル exe | Windows 10（最新の更新済み）と 11 には WebView2 が入っている前提。起動時に見つからない場合は、Tauri が出すエラーの代わりに、ダウンロードページを案内するダイアログを出す |
| NSIS インストーラ | `bundle.windows.webviewInstallMode = { type: "embedBootstrapper" }` で、必要な場合だけ自動でインストールする |

## 4. 署名なし配布への対策

| 課題 | 対策 |
|---|---|
| SmartScreen の「Windows によって PC が保護されました」 | 署名なしでは避けられない。配布ページと同梱の README に「詳細情報 → 実行」の手順をスクリーンショット付きで載せる。ダウンロード数が増えて評判が積み重なると表示が減る |
| ウイルス対策ソフトの誤検知 | Rust のネイティブバイナリで、PyInstaller のような自己展開型ではないので誤検知されにくい。UPX を使わない。exe にバージョン情報（会社名、製品名、説明）を埋め込む。リリース前に VirusTotal で確認する |
| 改ざんされていないかの確認 | リリースごとに **SHA-256 ハッシュ**を公開する（CI で自動生成） |
| 配布元の信頼性 | GitHub Releases（または BOOTH）など、一定の場所から配布する。ファイル名の規則を固定する |
| 書き込み権限 | ポータブル版は exe の横に何も書かない。設定・ログ・復旧データは `%LOCALAPPDATA%\MatcapMaker\`、ユーザーデータ（プリセットなど）は `Documents\MatcapMaker\` に置く |

> 将来、署名を検討する場合は Azure Trusted Signing（個人でも利用可能な低価格サービス）が候補になる。CI に組み込めば数行で追加できる。

## 5. CI/CD（GitHub Actions）

```yaml
# .github/workflows/release.yml（概要）
on: { push: { tags: ['v*'] } }
jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: lts/*, cache: pnpm }
      - uses: dtolnay/rust-toolchain@stable
      - uses: swatinem/rust-cache@v2
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - uses: tauri-apps/tauri-action@v0     # ビルド → GitHub Release に下書きとして添付
        with: { tagName: 'v__VERSION__', releaseDraft: true }
      - run: Get-FileHash dist/* -Algorithm SHA256 > SHA256SUMS.txt
```

- プルリクエストでは `pnpm test` と `pnpm tauri build --debug` を実行し、ビルドが壊れていないかを常に確認する。
- タグを push するとリリースの下書きができるので、確認してから公開する。

## 6. アップデート
- 最初のリリースでは、起動時に GitHub Releases の最新版を確認し、新しい版があれば「新しいバージョンがあります」と通知するだけにする（任意、オフにできる）。
- Tauri の `updater` プラグインによる自動更新は署名鍵（updater 独自の minisign 鍵。コード署名とは別物）で実現できるので、将来の選択肢として残しておく。

## 7. ライセンス表記
- `cargo-about`（Rust）と `license-checker`（npm）でサードパーティのライセンス一覧を自動生成し、About ダイアログに組み込む。CI で生成するので、依存を更新しても表記が古くならない。
