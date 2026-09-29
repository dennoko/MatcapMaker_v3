vec4 evalLayer(MatcapCtx ctx) {
  float t;
  if (u_gradientType == 0) {
    float a = radians(u_angle);
    t = (dot(ctx.n.xy, vec2(cos(a), sin(a))) + 1.0) * 0.5;
  } else {
    t = clamp(length(ctx.n.xy - u_center) / max(u_radius, 1e-4), 0.0, 1.0);
  }
  vec3 c = evalGradient(u_stops_count, u_stops_interp, u_stops_pos, u_stops_col, t);
  return vec4(c, 1.0);
}
