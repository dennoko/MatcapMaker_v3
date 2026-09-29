// Radial RGB split toward the rim; the silhouette (alpha) is kept.
vec4 runPass(vec2 uv) {
  vec4 o = texture(u_input, uv);
  vec2 d = (uv - 0.5) * u_amount;
  float r = texture(u_input, uv - d).r;
  float b = texture(u_input, uv + d).b;
  return vec4(r, o.g, b, o.a);
}
