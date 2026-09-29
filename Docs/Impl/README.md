# 実装計画

`Docs/Plan/` の計画に続く、個別機能の実装計画です。

| ファイル | 内容 |
|---|---|
| [01_web_single_file.md](01_web_single_file.md) | Web 版（HTML 1 ファイル配布）：本体への追従のしかた、ビルド、`file://` 対策、CI、配布 |
| [02_version_check.md](02_version_check.md) | バージョンチェック導入（DennokoMeshEditor 方式）：`version.json` による静的取得、Windows/Web の権限確認、UI 連携 |

Web 初版は A〜E と上書き保存を実装しています。EXR とプラグインの Web 対応は後続です。現在の実行コマンド、Pages 初回設定、保存領域の注意は [Web 版の運用](../web-operations.md) を参照してください。
