// Derived from color/intensity (see multiplyFold.ts)
uniform vec3 u_colorEff;
uniform float u_intensityEff;

// Port of v3 layer_spot.frag, evaluated in v3's (camera looks down -Z)
// coordinates so results match the legacy renderer exactly.
vec4 evalLayer(MatcapCtx ctx) {
  vec3 norm = toLegacy(ctx.n);
  vec3 L = toLegacy(normalize(u_direction));

  if (dot(norm, L) <= 0.0) return vec4(0.0);

  vec3 upGuess = abs(L.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 right = normalize(cross(upGuess, L));
  vec3 up = cross(L, right);

  float x = dot(norm, right);
  float y = dot(norm, up);

  float rad = radians(u_rotation);
  float c = cos(rad);
  float s = sin(rad);
  float rx = x * c - y * s;
  float ry = x * s + y * c;

  float sx = rx / max(0.001, u_scale.x);
  float sy = ry / max(0.001, u_scale.y);
  float modifiedNdotL = sqrt(max(0.0, 1.0 - (sx * sx + sy * sy)));

  float cutoff = 1.0 - u_range;
  float eps = u_blur + 0.0001;
  float spot = smoothstep(cutoff - eps, cutoff + eps, modifiedNdotL);

  return vec4(spot * u_colorEff * u_intensityEff, spot);
}
