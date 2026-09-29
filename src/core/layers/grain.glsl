// Resolution-independent film grain on top of everything below.
vec4 runPass(vec2 uv) {
  vec4 c = texture(u_input, uv);
  if (c.a == 0.0) return c;
  vec2 cell = floor(uv * (512.0 / max(u_size, 0.1)));
  float s = float(u_seed) * 7.31;
  vec3 n;
  if (u_monochrome == 1) {
    n = vec3(hash12(cell + s));
  } else {
    n = vec3(hash12(cell + s), hash12(cell + s + 19.1), hash12(cell + s + 41.7));
  }
  return vec4(c.rgb + (n - 0.5) * u_amount, c.a);
}
