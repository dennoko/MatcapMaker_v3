# 01. 要件定義

## 1. 機能要件：現行 v3 との互換性チェックリスト

リメイク版の最初のリリースでは、以下のすべてを満たすこと（**機能パリティ**）。

### 1.1 レイヤー

| レイヤー | 現行パラメータ | 既定のブレンド | 備考 |
|---|---|---|---|
| Base | `base_color`, `preview_mode`, `normal_map_path`, `normal_strength`, `normal_scale`, `normal_offset` | Normal | プレビュー設定は **ビュー設定に移す**（03 参照） |
| Spot Light | `direction[3]`, `color`, `intensity`, `range`, `blur`, `scale_x/y`, `rotation` | Add | |
| Fresnel / Rim | `color`, `intensity`, `power`, `bias` | Add | |
| Noise | `scale`, `intensity`, `seed`, `color` | Multiply | シンプレックスノイズ |
| Image | `image_path`, `mapping_mode`（UV / Planar）, `scale`, `scale_x/y`, `rotation`, `offset[2]`, `blur` | Add | アスペクト比は画像から自動で求める |
| Gradient | `gradient_stops`（最大 8 個、最低 2 個）, `angle`, `gradient_type`（Linear / Radial） | Normal | |
| Color Adjustment | `hue`, `saturation`, `brightness`, `contrast` | Normal | 後処理 |
| Blur / Sharpen | `mode`, `radius`, `amount` | Normal | 後処理。円盤の輪郭は広げない |

すべてのレイヤーに共通：`name`, `enabled`, `opacity`, `blend_mode`。

### 1.2 ブレンドモード（12 種）
Normal, Add, Multiply, Screen, Subtract, Lighten, Darken, Overlay, Soft Light, Hard Light, Color Dodge, Difference。
いずれもシェーダー内の計算で実装する（Photoshop 互換の式）。

### 1.3 レイヤー操作
追加、削除、複製、表示/非表示、ドラッグでの並び替え、選択、名前の変更。

### 1.4 プレビュー
- 球体へのリアルタイム表示
- ノーマルマップ適用時の見た目の確認（通常の球体との並列比較。強度、スケール、オフセットを調整可能）

### 1.5 ファイル
- プロジェクトの新規作成、開く、保存（使用している画像アセットも一緒に保存）
- **現行 v3 のプロジェクト（.json）の読み込み**（必須）
- 画像のエクスポート：PNG / JPG、解像度 64〜4096、エッジパディング（px 指定）
- 寛容な読み込み（パラメータ欠落時は既定値、未知のパラメータは無視、未知のレイヤーはスキップ）

### 1.6 その他
- 日英 2 言語の UI
- サードパーティライセンスの表示
- 設定（解像度、パディング、言語）の永続化
- クラッシュログ

## 2. 非機能要件（目標値）

| 指標 | 目標 | 現行の参考値 |
|---|---|---|
| 配布サイズ | **exe 単体 15MB 以下** | onedir で約 200MB 超（PySide6 同梱） |
| コールド起動 | 1 秒以内に操作可能 | 数秒（Python と Qt の初期化） |
| アイドル時 CPU | 0%（変更がなければ描画しない） | ほぼ 0% |
| スライダー操作から反映まで | 1 フレーム以内（16ms、プレビュー 1024px、10 レイヤー） | 全レイヤーを再描画 |
| 4K エクスポート（パディング 16px 込み） | 2 秒以内 | NumPy 処理で数秒 |
| メモリ | 250MB 以下（WebView2 プロセスを含む） | |
| ビルド | クリーン環境からコマンド 1 つ、CI で自動化 | PyInstaller + Inno Setup |
| ウイルス対策ソフトの誤検知 | 起きにくい構成にする | PyInstaller の bootloader は誤検知されやすい |

## 3. 現行 UX の課題（リメイクで解決したいこと）

| 課題 | 解決の方向性 |
|---|---|
| Undo/Redo がない | コマンドベースの履歴（最初から組み込む） |
| 数値スライダーだけの間接的な操作。ライトの方向を X/Y/Z の数値で指定する | **プレビュー上のギズモで直接操作**（ハイライトをドラッグして方向を決める） |
| 合成順が Photoshop と逆でわかりにくい | 一般的なペイントソフトと同じ「上が前面」に統一する |
| プレビュー設定がドキュメント（Base レイヤー）に混ざっている | ビュー設定として分離する |
| 言語の切り替えに再起動が必要 | その場で切り替え |
| レイヤーの中身が一覧からわからない | レイヤーのサムネイル |
| 解像度やパディングがメニューの奥にある | エクスポートダイアログで仕上がりを確認しながら設定。前回設定でのクイックエクスポート |
| 画像を読み込むのが手間 | ドラッグ＆ドロップ。クリップボードからの貼り付け |
| 作業が消える危険 | 自動保存とクラッシュからの復旧 |
| プロジェクトとアセットが別フォルダ | アセットを同梱した単一ファイル形式 |
