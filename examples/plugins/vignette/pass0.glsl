// Filter pass: u_input = everything below this layer.
vec4 runPass(vec2 uv) {
  vec4 c = texture(u_input, uv);
  float r = length(uv * 2.0 - 1.0);
  float k = 1.0 - u_amount * smoothstep(1.0 - u_softness, 1.0, r);
  return vec4(c.rgb * k, c.a);
}
