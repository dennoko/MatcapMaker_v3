vec4 runPass(vec2 uv) {
  vec4 color = texture(u_input, uv);
  if (color.a == 0.0) return color;
  vec3 rgb = color.rgb;
  vec3 hsv = rgb2hsv(rgb);
  hsv.x += u_hue;
  hsv.y *= u_saturation;
  rgb = hsv2rgb(hsv);
  rgb += u_brightness;
  rgb = (rgb - 0.5) * u_contrast + 0.5;
  return vec4(rgb, color.a);
}
