# Web 版の運用

実装仕様は [01_web_single_file.md](Impl/01_web_single_file.md)。初版は A〜E と上書き保存に対応します。EXR の TS エンコーダとプラグインの取り込みは後続で、対応 capability は `false` です。

## ローカルでの確認

Web のビルドだけなら Rust / Visual Studio は不要です。Node.js と package.json 指定の pnpm を用意し、以下を実行します。

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test:core
pnpm build:single
pnpm exec playwright install chromium
pnpm test:golden
```

成果物は `dist-single/MatcapMaker.html` のみです。圧縮前の上限は 1,500,000 bytes。旧 `build:web` は廃止しました。開発中は `pnpm dev`、単一ファイルの確認には実際の HTML を使います。`pnpm test:single` は外部 HTTP(S) 通信を遮断し、ダウンロード・プロジェクト再読込・復旧・保存領域拒否・複数タブ・WebGL2 不在を確認します。UI の共通シナリオは `ui.spec.ts` を dev / single の両プロジェクトで実行します。

## リリースと Pages

1. `package.json` のバージョンを更新し、同じ番号の `v<version>` タグを push します。
2. Release workflow は Web HTML を一度生成し、テスト後に `MatcapMaker_<ver>_web.html` と `MatcapMaker_web.html` をデスクトップ版と同じ下書きリリースへ添付します。両 HTML を `SHA256SUMS.txt` に含めます。
3. Pages ジョブはその成果物をダウンロードし、Firefox / WebKit のオフライン PNG スモークを実行後、`index.html` としてデプロイします。main の push ではデプロイしません。
4. リリース内容を確認して下書きを公開します。固定名の latest URL はこの時点で新しくなります。Pages はタグの workflow で先に更新されるため、下書きでも Web 版が公開される点に注意してください。

リポジトリの Settings → Pages → Source を **GitHub Actions** に設定してください。Pages と `github-pages` environment が利用可能で、workflow に `pages: write` / `id-token: write` の権限が必要です。これらの GitHub 側設定やタグ push はソース編集だけでは反映されません。

## 本体の機能追加時

- UI は `platform.caps.*` を参照します。`kind` は About 表示専用です。ネイティブ機能の追加時には `PlatformCaps` と両実装を同じ変更で更新してください。永続パスと一時的なブラウザファイルハンドルを混同しないでください。
- UI から `platform/web.ts` を直接 import しないでください。プリセット一覧・復旧時刻・ファイルハンドル・保存領域・排他制御は platform 内で扱います。
- Web のエントリは `index.web.ts` に解決し、Tauri モジュールの副作用も含めて除外します。単一 HTML の生成は `vite.config.ts` と `scripts/singleFile.ts` に集約しています。
- Web ライセンスは最終 JS の module graph から自動生成します（`gen-licenses.mjs --target web --modules-stdin`）。Rust と Tauri は含めず、同梱 GLSL の著作権表示は残します。デスクトップの `src/generated/licenses.json` は Web ビルドでは上書きしません。
- 画像・フォント・動的 import を追加したら `build:single` とオフラインテストを必ず実行してください。HTML は JS / CSS を含めてインライン化し、外部ファイルを必要としない状態を保ちます。

## 保存領域と復旧

IndexedDB 名は `matcap-maker`、現在のスキーマは version 1 の `kv` ストアです。変更時は `browserStorage.ts` の `onupgradeneeded` に旧版からの移行を追加してください。設定の localStorage キーは `matcap-maker:settings` です。`file://` の保存領域の共有範囲はブラウザ依存であり、HTML をコピーしても設定が移るとは限りません。

復旧用 Web Lock は `matcap-maker:recovery`。所有していないタブは復旧の読込・書込・削除を行いません。ロック API が使えない場合も安全のため復旧保存を止めます。ブラウザを閉じる際の確認は `beforeunload` を使い、強制終了時や確認を省略する環境での通知は保証されません。

File System Access API のハンドルはそのページのメモリ内だけに保持し、保存失敗時にダウンロード成功として扱いません。ピッカーをキャンセルした場合も保存済みにはしません。API が使えない環境では通常のファイル選択とダウンロードへ切り替えます。

ブラウザの自動保存はバックアップではありません。保存容量不足などでメモリ代替になった場合はその場で `.mcproj` に保存してください。WebGL2 が使えない場合は案内画面が表示されます。
