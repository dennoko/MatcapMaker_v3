// Derived from color/intensity (see multiplyFold.ts)
uniform vec3 u_colorEff;
uniform float u_intensityEff;

vec4 evalLayer(MatcapCtx ctx) {
  float ndotv = max(ctx.n.z, 0.0);
  float rim = pow(1.0 - ndotv, max(u_power, 0.001));
  rim = clamp(rim + u_bias, 0.0, 1.0);
  return vec4(rim * u_colorEff * u_intensityEff, rim);
}
