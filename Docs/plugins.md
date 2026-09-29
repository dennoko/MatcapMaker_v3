# レイヤープラグイン

プラグインは「レイヤー定義（JSON）+ GLSL」だけで構成される宣言的なレイヤーです。JavaScript は実行しません。

```
Documents\MatcapMaker\plugins\
└─ hexGrid\
   ├─ layer.json
   └─ layer.glsl          （フィルタ / 補正は pass0.glsl, pass1.glsl …）
```

アプリの起動時に読み込まれ、「レイヤーを追加」（Tab）に表示されます。プロジェクトにはレイヤーの `type` とパラメータが保存されるので、
プラグインが入っていない環境で開いた場合は「不明なレイヤー」としてスキップされます（警告が表示されます）。

## layer.json

```json
{
  "type": "hexGrid",
  "title": "Hex Grid",
  "version": 1,
  "kind": "generator",
  "category": "texture",
  "icon": "⬡",
  "blendMode": "multiply",
  "params": {
    "scale": { "kind": "float", "default": 10, "min": 1, "max": 60, "softMax": 30 },
    "color": { "kind": "color", "default": "#1a1a1a" },
    "space": { "kind": "enum", "default": "normal", "options": ["normal", "planar"] }
  },
  "i18n": { "ja": { "title": "六角グリッド", "params": { "scale": "スケール" }, "options": { "normal": "法線" } } }
}
```

| キー | 内容 |
|---|---|
| `type` | 英字で始まる識別子。組み込みレイヤーと同じ名前は使えません |
| `kind` | `generator`（形を生成）/ `filter` / `adjustment`（下のレイヤーまでの合成結果を加工） |
| `params` | `float` `int` `bool` `angle` `color` `direction` `vec2` `enum` `gradient` `curve` `image` |

## GLSL

各パラメータは `u_<名前>` の uniform として自動で宣言されます（`enum` / `bool` は `int`、`color` / `direction` は `vec3`）。

**generator** は `vec4 evalLayer(MatcapCtx ctx)` を実装し、straight alpha の色を返します。

```glsl
struct MatcapCtx {
  vec2 uv;        // 0..1（y は上向き）
  vec2 p;         // -1..1
  vec3 n;         // ビュー空間の法線（+Z が手前）
  float inside;   // 円盤のマスク（合成時に自動で掛かります）
  vec2 sphereUV;  // v3 の球メッシュと同じ緯度経度 UV
};
```

**filter / adjustment** は `vec4 runPass(vec2 uv)` を実装します。`u_input`（前のパス、最初は下の合成結果）、`u_original`（下の合成結果）、
`u_pass`（パス番号）、`u_texel`、`u_resolution` が使えます。

共通の関数：`snoise(vec3)`、`hash12(vec2)`、`rgb2hsv` / `hsv2rgb`、`srgbToLinear` / `linearToSrgb`、
`evalGradient(...)`（`gradient` パラメータ用）、`evalCurve(...)`（`curve` パラメータ用）。

シェーダーのコンパイルに失敗したレイヤーは無効になり、レイヤー一覧に ⚠ が表示されます（アプリは止まりません）。
