// Uniforms u_scale, u_width, u_color, u_space are generated from layer.json.
float hexDist(vec2 p) {
  p = abs(p);
  return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
}

vec4 evalLayer(MatcapCtx ctx) {
  // "normal": wrap the grid around the sphere; "planar": flat projection
  vec2 q = u_space == 0 ? ctx.n.xy / (0.6 + ctx.n.z * 0.4) : ctx.p;
  q *= u_scale;
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(q, r) - h;
  vec2 b = mod(q - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  float edge = 0.5 - hexDist(g);
  float line = 1.0 - smoothstep(u_width, u_width + 0.03, edge);
  return vec4(mix(vec3(1.0), u_color, line), 1.0);
}
