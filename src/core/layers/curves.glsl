// channel: 0 rgb, 1 red, 2 green, 3 blue, 4 luminance
vec4 runPass(vec2 uv) {
  vec4 c = texture(u_input, uv);
  if (c.a == 0.0) return c;
  vec3 v = clamp(c.rgb, 0.0, 1.0);
  if (u_channel == 0) {
    v = vec3(evalCurve(u_curve_count, u_curve_pts, v.r), evalCurve(u_curve_count, u_curve_pts, v.g),
             evalCurve(u_curve_count, u_curve_pts, v.b));
  } else if (u_channel == 1) {
    v.r = evalCurve(u_curve_count, u_curve_pts, v.r);
  } else if (u_channel == 2) {
    v.g = evalCurve(u_curve_count, u_curve_pts, v.g);
  } else if (u_channel == 3) {
    v.b = evalCurve(u_curve_count, u_curve_pts, v.b);
  } else {
    float l = dot(v, vec3(0.2126, 0.7152, 0.0722));
    float l2 = evalCurve(u_curve_count, u_curve_pts, l);
    v = l > 1e-4 ? v * (l2 / l) : vec3(l2);
  }
  return vec4(v, c.a);
}
