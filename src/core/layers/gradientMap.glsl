// Color ramp: maps the luminance of everything below through a gradient.
vec4 runPass(vec2 uv) {
  vec4 c = texture(u_input, uv);
  if (c.a == 0.0) return c;
  float t = clamp(dot(clamp(c.rgb, 0.0, 1.0), vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  return vec4(evalGradient(u_stops_count, u_stops_interp, u_stops_pos, u_stops_col, t), c.a);
}
