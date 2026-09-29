precision highp float;
precision highp int;
precision highp sampler2D;

in vec2 v_uv;
out vec4 o_color;

uniform vec2 u_resolution;

// Matcap-space evaluation context. The texture is a disc of view-space
// normals: +X right, +Y up, +Z toward the viewer.
struct MatcapCtx {
  vec2 uv;        // 0..1 (texture space, y up)
  vec2 p;         // -1..1
  vec3 n;         // view-space normal
  float inside;   // anti-aliased disc coverage
  vec2 sphereUV;  // lat/long UV of the v3 sphere mesh (u = lon/2pi, v = lat/pi)
};

// v3 rendered with the camera looking down -Z; layers ported from v3 use
// this to evaluate their math in the original space.
vec3 toLegacy(vec3 n) {
  return vec3(n.x, n.y, -n.z);
}

MatcapCtx makeCtx(vec2 uv) {
  MatcapCtx c;
  c.uv = uv;
  c.p = uv * 2.0 - 1.0;
  float r = length(c.p);
  float aa = max(fwidth(r), 1.0 / max(u_resolution.x, 1.0));
  c.inside = clamp((1.0 - r) / aa + 0.5, 0.0, 1.0);
  vec2 q = r > 1.0 ? c.p / r : c.p;
  c.n = vec3(q, sqrt(max(0.0, 1.0 - dot(q, q))));
  vec3 lg = toLegacy(c.n);
  float lat = acos(clamp(lg.y, -1.0, 1.0));
  float lon = atan(lg.z, lg.x);
  if (lon < 0.0) lon += 6.28318530718;
  c.sphereUV = vec2(lon / 6.28318530718, lat / 3.14159265359);
  return c;
}

// --- color helpers -------------------------------------------------------

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec3 srgbToLinear(vec3 c) {
  vec3 s = max(c, vec3(0.0));
  return mix(s / 12.92, pow((s + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), s));
}

vec3 linearToSrgb(vec3 c) {
  vec3 s = max(c, vec3(0.0));
  return mix(s * 12.92, 1.055 * pow(s, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), s));
}

vec3 linearToOklab(vec3 c) {
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  l = pow(max(l, 0.0), 1.0 / 3.0);
  m = pow(max(m, 0.0), 1.0 / 3.0);
  s = pow(max(s, 0.0), 1.0 / 3.0);
  return vec3(
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
}

vec3 oklabToLinear(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l;
  m = m * m * m;
  s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}

vec3 mixInterp(vec3 a, vec3 b, float t, int interp) {
  if (interp == 1) {
    vec3 la = linearToOklab(srgbToLinear(a));
    vec3 lb = linearToOklab(srgbToLinear(b));
    return linearToSrgb(oklabToLinear(mix(la, lb, t)));
  }
  return mix(a, b, t);
}

// Piecewise-linear gradient over sorted stops (v3 semantics).
vec3 evalGradient(int count, int interp, float pos[8], vec3 col[8], float t) {
  if (count <= 0) return vec3(0.0);
  if (t <= pos[0]) return col[0];
  for (int i = 0; i < 7; i++) {
    if (i >= count - 1) break;
    float p0 = pos[i];
    float p1 = pos[i + 1];
    if (t <= p1) {
      float span = p1 - p0;
      float lt = span > 0.0001 ? clamp((t - p0) / span, 0.0, 1.0) : 0.0;
      return mixInterp(col[i], col[i + 1], lt, interp);
    }
  }
  return col[count - 1];
}

// Monotone-ish smooth curve through sorted control points (Catmull-Rom, clamped).
float evalCurve(int count, vec2 pts[8], float x) {
  if (count <= 0) return x;
  if (x <= pts[0].x) return pts[0].y;
  for (int i = 0; i < 7; i++) {
    if (i >= count - 1) break;
    vec2 p1 = pts[i];
    vec2 p2 = pts[i + 1];
    if (x <= p2.x) {
      vec2 p0 = i > 0 ? pts[i - 1] : p1 - (p2 - p1);
      vec2 p3 = i + 2 < count ? pts[i + 2] : p2 + (p2 - p1);
      float t = (x - p1.x) / max(p2.x - p1.x, 1e-5);
      float t2 = t * t;
      float t3 = t2 * t;
      float y = 0.5 * ((2.0 * p1.y) + (-p0.y + p2.y) * t + (2.0 * p0.y - 5.0 * p1.y + 4.0 * p2.y - p3.y) * t2 +
        (-p0.y + 3.0 * p1.y - 3.0 * p2.y + p3.y) * t3);
      return clamp(y, 0.0, 1.0);
    }
  }
  return pts[count - 1].y;
}

// --- noise -----------------------------------------------------------------
// 3D simplex noise (Ashima Arts / Stefan Gustavson, MIT).

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) +
    i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
