// Presents the generated matcap on screen. Everything is analytic: the
// sphere is ray-cast per pixel, so no geometry is needed.

uniform vec2 u_canvas;       // device pixels
uniform vec2 u_center0;      // disc centers (device px, y down)
uniform vec2 u_center1;
uniform float u_radius;
uniform int u_layout;        // 0 single, 1 compare (sphere | normal-mapped), 2 swipe
uniform int u_shape;         // 0 sphere, 1 flat, 2 normal-mapped sphere
uniform sampler2D u_matcap;
uniform sampler2D u_matcapB; // "before" image for swipe
uniform float u_swipeX;      // device px
uniform sampler2D u_normalMap;
uniform float u_nmStrength;
uniform float u_nmScale;
uniform vec2 u_nmOffset;
uniform int u_hdr;
uniform int u_toneMap;
uniform float u_exposure;
uniform vec3 u_bg;
uniform vec3 u_bg2;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 display(vec3 c) {
  if (u_hdr == 1) {
    c *= exp2(u_exposure);
    if (u_toneMap == 1) {
      // tone map in linear light, keep sRGB encoding for display
      return linearToSrgb(aces(srgbToLinear(c)));
    }
  }
  return clamp(c, 0.0, 1.0);
}

vec3 checker(vec2 px) {
  vec2 q = floor(px / 10.0);
  return mod(q.x + q.y, 2.0) < 1.0 ? u_bg : u_bg2;
}

// Normal-mapped sphere normal, same construction as v3 (lat/long UVs and
// a longitude tangent), returned in matcap space.
vec3 perturb(vec3 n) {
  vec3 lg = toLegacy(n);
  float lat = acos(clamp(lg.y, -1.0, 1.0));
  float lon = atan(lg.z, lg.x);
  if (lon < 0.0) lon += 6.28318530718;
  vec2 suv = vec2(lon / 6.28318530718, lat / 3.14159265359);
  vec2 uv = suv * u_nmScale + u_nmOffset;
  vec3 tn = texture(u_normalMap, uv).rgb * 2.0 - 1.0;
  tn.xy *= u_nmStrength;
  vec3 T = vec3(-sin(lon), 0.0, cos(lon));
  vec3 N = lg;
  T = normalize(T - dot(T, N) * N);
  vec3 B = cross(N, T);
  vec3 w = normalize(mat3(T, B, N) * normalize(tn));
  return toLegacy(w);
}

vec4 sampleMatcap(sampler2D tex, vec2 local, int shape, float aa, out float cover) {
  float r = length(local);
  if (shape == 1) {
    // flat: whole texture square, disc not enforced
    cover = step(abs(local.x), 1.0) * step(abs(local.y), 1.0);
    return texture(tex, local * 0.5 + 0.5);
  }
  cover = clamp((1.0 - r) / aa + 0.5, 0.0, 1.0);
  vec2 q = r > 1.0 ? local / r : local;
  vec3 n = vec3(q, sqrt(max(0.0, 1.0 - dot(q, q))));
  if (shape == 2) n = perturb(n);
  vec2 uv = n.xy * 0.5 + 0.5;
  // stay inside the disc to avoid sampling the transparent border
  uv = (uv - 0.5) * (1.0 - 1.0 / u_resolution.x) + 0.5;
  return texture(tex, uv);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, u_canvas.y - gl_FragCoord.y);
  vec3 bg = u_bg;
  int shape = u_shape;
  vec2 center = u_center0;
  bool useB = false;
  if (u_layout == 1) {
    if (px.x > u_canvas.x * 0.5) {
      center = u_center1;
      shape = 2;
    } else {
      shape = shape == 2 ? 0 : shape;
    }
  } else if (u_layout == 2) {
    useB = px.x < u_swipeX;
  }
  vec2 local = (px - center) / u_radius;
  local.y = -local.y;
  float aa = 1.5 / u_radius;
  float cover;
  vec4 c = useB ? sampleMatcap(u_matcapB, local, shape, aa, cover) : sampleMatcap(u_matcap, local, shape, aa, cover);
  if (shape == 1 && cover > 0.0) bg = checker(px);
  vec3 col = mix(bg, display(c.rgb), c.a * cover);
  if (u_layout == 2 && abs(px.x - u_swipeX) < 1.0) col = vec3(1.0);
  o_color = vec4(col, 1.0);
}
