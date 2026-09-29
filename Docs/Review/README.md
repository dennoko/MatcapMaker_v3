# 実装レビュー

- [2026-09-29 メモリ・GPUリソースと異常系](2026-09-29-implementation-review.md)（R1〜R10 対応済み。対応内容は文書末尾）
- [レビュー用再現検証](resource-probes.test.ts)

再現検証はリポジトリルートから実行する。

```sh
pnpm exec vitest run --config Docs/Review/vitest.config.ts
```

修正前は「検証の成功＝問題挙動の再現」だった。修正後は期待値を修正後の挙動に書き換えてあり、成功は問題が解消していることを意味する。回帰テストの本体は `tests/core/resources.test.ts` と `tests/golden/render.spec.ts`（単発描画とキャッシュ描画の一致）。
