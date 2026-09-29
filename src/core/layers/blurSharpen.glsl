// Separable gaussian. Pass 0 = horizontal, pass 1 = vertical + combine.
// Works in premultiplied alpha (weights by coverage) so transparent texels
// outside the disc never bleed in; final alpha is the original silhouette.
const int KERNEL = 16;

vec4 blur1D(vec2 uv, vec2 dir) {
  vec2 texSize = u_resolution;
  float texDim = u_pass == 0 ? texSize.x : texSize.y;
  vec2 texel = 1.0 / texSize;
  float radiusPx = u_radius * texDim * 0.04;
  float sigma = max(radiusPx * 0.5, 1e-3);
  float stepPx = max(radiusPx / float(KERNEL), 1.0);
  vec4 sum = vec4(0.0);
  float totalW = 0.0;
  for (int i = -KERNEL; i <= KERNEL; i++) {
    float o = float(i) * stepPx;
    float w = exp(-(o * o) / (2.0 * sigma * sigma));
    vec4 c = texture(u_input, uv + dir * (o * texel));
    sum += vec4(c.rgb * c.a, c.a) * w;
    totalW += w;
  }
  sum /= totalW;
  vec3 rgb = sum.a > 1e-5 ? sum.rgb / sum.a : vec3(0.0);
  return vec4(rgb, sum.a);
}

vec4 runPass(vec2 uv) {
  vec2 dir = u_pass == 0 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 blurred = blur1D(uv, dir);
  if (u_pass == 0) return blurred;
  vec4 original = texture(u_original, uv);
  if (u_mode == 1) {
    return vec4(original.rgb + u_amount * (original.rgb - blurred.rgb), original.a);
  }
  return vec4(blurred.rgb, original.a);
}
