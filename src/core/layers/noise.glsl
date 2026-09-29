// 0 = white noise texture sampled on the sphere's lat/long UV (v3 look)
// 1 = fractal simplex noise evaluated on the normal (seamless)
vec4 evalLayer(MatcapCtx ctx) {
  float v;
  if (u_noiseType == 0) {
    v = texture(u_noiseTex, ctx.sphereUV * u_scale).r;
  } else {
    vec3 q = ctx.n * (u_scale * 4.0) + vec3(float(u_seed) * 17.13, float(u_seed) * 3.71, 0.0);
    float f = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      f += amp * snoise(q);
      q *= 2.03;
      amp *= 0.5;
    }
    v = clamp(f * 0.5 + 0.5, 0.0, 1.0);
  }
  vec3 col = mix(vec3(1.0), u_color, v * u_intensity);
  return vec4(col, 1.0);
}
