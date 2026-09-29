// Port of v3 layer_image.frag (standard / export path).
vec2 rotateUV(vec2 uv, float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat2(c, -s, s, c) * uv;
}

float safeScale(float v) { return abs(v) > 1e-4 ? v : 1e-4; }

vec4 evalLayer(MatcapCtx ctx) {
  if (u_image_valid == 0) return vec4(0.0);

  vec2 uv;
  if (u_mapping == 0) {
    uv = vec2(ctx.sphereUV.x, 1.0 - ctx.sphereUV.y);
  } else {
    uv = ctx.uv;
  }

  uv -= 0.5;
  float aspect = u_image_size.x / max(1.0, u_image_size.y);
  if (aspect > 1.0) uv.y *= aspect;
  else uv.x *= 1.0 / aspect;

  uv = rotateUV(uv, radians(u_rotation));
  vec2 sxy = vec2(safeScale(u_scale)) * vec2(safeScale(u_scaleXY.x), safeScale(u_scaleXY.y));
  uv /= sxy;
  uv -= u_offset;
  uv += 0.5;

  vec4 texColor = vec4(0.0);
  if (u_blur <= 0.001) {
    texColor = texture(u_image, uv);
  } else {
    vec2 ts = u_image_size;
    vec2 texel = 1.0 / ts;
    float maxDim = max(ts.x, ts.y);
    const int K = 3;
    float radiusTexels = u_blur * maxDim * 0.04;
    float spacing = max(radiusTexels / float(K), 1.0);
    float sigma = max(radiusTexels * 0.5, 1e-3);
    float lod = max(0.0, log2(spacing));
    float totalWeight = 0.0;
    for (int x = -K; x <= K; x++) {
      for (int y = -K; y <= K; y++) {
        vec2 o = vec2(float(x), float(y)) * spacing;
        float w = exp(-dot(o, o) / (2.0 * sigma * sigma));
        vec4 c = textureLod(u_image, uv + o * texel, lod);
        texColor += vec4(c.rgb * c.a, c.a) * w;
        totalWeight += w;
      }
    }
    texColor /= totalWeight;
    texColor.rgb = texColor.a > 1e-5 ? texColor.rgb / texColor.a : vec3(0.0);
  }
  return texColor;
}
