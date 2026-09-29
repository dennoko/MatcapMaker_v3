// Programmable compositing of one layer (u_src) over the accumulated result
// below it (u_dst). Straight alpha in, straight alpha out.

uniform sampler2D u_src;
uniform sampler2D u_dst;
uniform int u_mode;
uniform float u_opacity;
uniform int u_isFilter;   // filters/adjustments replace the backdrop (mixed by opacity)
uniform int u_linear;     // 1 = blend in linear light
uniform int u_hdr;        // 0 = clamp like v3 (8-bit pipeline)

uniform int u_maskMode;   // 0 none, 1 fresnel, 2 noise, 3 image, 4 layer
uniform int u_maskInvert;
uniform float u_maskAmount;
uniform sampler2D u_maskTex;

#define MODE_NORMAL 0
#define MODE_ADD 1
#define MODE_MULTIPLY 2
#define MODE_SCREEN 3
#define MODE_SUBTRACT 4
#define MODE_LIGHTEN 5
#define MODE_DARKEN 6
#define MODE_OVERLAY 7
#define MODE_SOFT_LIGHT 8
#define MODE_HARD_LIGHT 9
#define MODE_COLOR_DODGE 10
#define MODE_DIFFERENCE 11

float blendOverlay(float b, float f) {
  return b < 0.5 ? (2.0 * b * f) : (1.0 - 2.0 * (1.0 - b) * (1.0 - f));
}
float blendSoftLight(float b, float f) {
  return f < 0.5 ? (2.0 * b * f + b * b * (1.0 - 2.0 * f)) : (sqrt(max(b, 0.0)) * (2.0 * f - 1.0) + 2.0 * b * (1.0 - f));
}
float blendColorDodge(float b, float f) {
  return f >= 1.0 ? 1.0 : min(b / (1.0 - f), 1.0);
}

vec3 applyBlend(vec3 b, vec3 f, int mode) {
  vec3 res = f;
  if (mode == MODE_ADD) res = b + f;
  else if (mode == MODE_MULTIPLY) res = b * f;
  else if (mode == MODE_SCREEN) res = 1.0 - (1.0 - b) * (1.0 - f);
  else if (mode == MODE_SUBTRACT) res = max(b - f, vec3(0.0));
  else if (mode == MODE_LIGHTEN) res = max(b, f);
  else if (mode == MODE_DARKEN) res = min(b, f);
  else if (mode == MODE_OVERLAY) res = vec3(blendOverlay(b.r, f.r), blendOverlay(b.g, f.g), blendOverlay(b.b, f.b));
  else if (mode == MODE_SOFT_LIGHT) res = vec3(blendSoftLight(b.r, f.r), blendSoftLight(b.g, f.g), blendSoftLight(b.b, f.b));
  else if (mode == MODE_HARD_LIGHT) res = vec3(blendOverlay(f.r, b.r), blendOverlay(f.g, b.g), blendOverlay(f.b, b.b));
  else if (mode == MODE_COLOR_DODGE) res = vec3(blendColorDodge(b.r, f.r), blendColorDodge(b.g, f.g), blendColorDodge(b.b, f.b));
  else if (mode == MODE_DIFFERENCE) res = abs(b - f);
  return u_hdr == 0 ? clamp(res, 0.0, 1.0) : max(res, vec3(0.0));
}

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float maskValue(MatcapCtx ctx) {
  if (u_maskMode == 0) return 1.0;
  float m = 1.0;
  if (u_maskMode == 1) {
    m = pow(clamp(1.0 - ctx.n.z, 0.0, 1.0), max(u_maskAmount, 0.001));
  } else if (u_maskMode == 2) {
    m = texture(u_maskTex, ctx.sphereUV * u_maskAmount).r;
  } else {
    vec4 c = texture(u_maskTex, ctx.uv);
    m = luma(c.rgb) * c.a;
  }
  m = clamp(m, 0.0, 1.0);
  return u_maskInvert == 1 ? 1.0 - m : m;
}

vec3 enc(vec3 c) { return u_linear == 1 ? srgbToLinear(c) : c; }
vec3 dec(vec3 c) { return u_linear == 1 ? linearToSrgb(c) : c; }

void main() {
  vec4 f = texture(u_src, v_uv);
  vec4 b = texture(u_dst, v_uv);
  if (u_hdr == 0) f = clamp(f, 0.0, 1.0);
  MatcapCtx ctx = makeCtx(v_uv);
  float m = maskValue(ctx);

  if (u_isFilter == 1) {
    vec3 r = dec(applyBlend(enc(b.rgb), enc(f.rgb), u_mode));
    o_color = mix(b, vec4(r, f.a), clamp(u_opacity * m, 0.0, 1.0));
    return;
  }

  float srcA = f.a * u_opacity * m;
  if (srcA <= 0.0) {
    o_color = b;
    return;
  }
  vec3 fr = enc(f.rgb);
  vec3 br = enc(b.rgb);
  // Blend modes apply only where a backdrop exists (PDF/Photoshop model).
  vec3 blended = applyBlend(br, fr, u_mode);
  vec3 srcRGB = mix(fr, blended, b.a);
  float outA = srcA + b.a * (1.0 - srcA);
  vec3 rgb = (srcRGB * srcA + br * b.a * (1.0 - srcA)) / outA;
  o_color = vec4(dec(rgb), outA);
}
