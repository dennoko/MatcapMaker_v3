//! Image encoding. Pixels arrive as raw bytes over binary IPC (no JSON
//! round-trip) and are encoded here so straight alpha is preserved exactly
//! (Canvas `toBlob` would premultiply and lose color under low alpha).

use serde::Deserialize;
use std::io::{BufWriter, Write};
use std::path::Path;
use tauri::ipc::Request;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ImageFormat {
    Png8,
    Png16,
    Jpg,
    Exr,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageSpec {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub format: ImageFormat,
    #[serde(default = "default_quality")]
    pub quality: u8,
}

fn default_quality() -> u8 {
    92
}

fn expected_len(spec: &ImageSpec) -> usize {
    let px = spec.width as usize * spec.height as usize;
    match spec.format {
        ImageFormat::Png8 => px * 4,
        ImageFormat::Png16 | ImageFormat::Exr => px * 8,
        ImageFormat::Jpg => px * 3,
    }
}

pub fn encode_to<W: Write>(spec: &ImageSpec, pixels: &[u8], out: W) -> Result<(), String> {
    if pixels.len() != expected_len(spec) {
        return Err(format!(
            "pixel buffer size mismatch: got {}, expected {}",
            pixels.len(),
            expected_len(spec)
        ));
    }
    match spec.format {
        ImageFormat::Png8 | ImageFormat::Png16 => {
            let mut enc = png::Encoder::new(out, spec.width, spec.height);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(if spec.format == ImageFormat::Png8 {
                png::BitDepth::Eight
            } else {
                png::BitDepth::Sixteen
            });
            enc.set_compression(png::Compression::Fast);
            enc.set_source_srgb(png::SrgbRenderingIntent::Perceptual);
            let mut w = enc.write_header().map_err(|e| e.to_string())?;
            w.write_image_data(pixels).map_err(|e| e.to_string())?;
            w.finish().map_err(|e| e.to_string())?;
            Ok(())
        }
        ImageFormat::Jpg => {
            let enc = jpeg_encoder::Encoder::new(out, spec.quality.clamp(1, 100));
            enc.encode(
                pixels,
                spec.width as u16,
                spec.height as u16,
                jpeg_encoder::ColorType::Rgb,
            )
            .map_err(|e| e.to_string())
        }
        ImageFormat::Exr => Err("EXR must be written to a path".into()),
    }
}

fn write_exr(spec: &ImageSpec, pixels: &[u8], path: &Path) -> Result<(), String> {
    use exr::prelude::*;
    if pixels.len() != expected_len(spec) {
        return Err("pixel buffer size mismatch".into());
    }
    let w = spec.width as usize;
    let h = spec.height as usize;
    let half_at = |i: usize| f16::from_bits(u16::from_le_bytes([pixels[i * 2], pixels[i * 2 + 1]]));
    let image = Image::from_channels(
        (w, h),
        SpecificChannels::rgba(|Vec2(x, y): Vec2<usize>| {
            let i = (y * w + x) * 4;
            (half_at(i), half_at(i + 1), half_at(i + 2), half_at(i + 3))
        }),
    );
    image.write().to_file(path).map_err(|e| e.to_string())
}

pub fn write_image_file(spec: &ImageSpec, pixels: &[u8]) -> Result<(), String> {
    let path = Path::new(&spec.path);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    if spec.format == ImageFormat::Exr {
        return write_exr(spec, pixels, path);
    }
    // write to a temp file then rename, so a failed export never leaves a
    // truncated image behind
    let tmp = path.with_extension("tmp-export");
    {
        let f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let mut w = BufWriter::with_capacity(1 << 20, f);
        encode_to(spec, pixels, &mut w)?;
        w.flush().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

/// Raw-body command: body = pixels, header `x-spec` = JSON ImageSpec
/// (URI-encoded so non-ASCII paths survive the header).
#[tauri::command]
pub async fn write_image(request: Request<'_>) -> Result<u64, String> {
    let t0 = std::time::Instant::now();
    let spec_raw = request
        .headers()
        .get("x-spec")
        .ok_or("missing x-spec header")?
        .to_str()
        .map_err(|e| e.to_string())?;
    let spec: ImageSpec =
        serde_json::from_str(&crate::util::percent_decode(spec_raw)).map_err(|e| e.to_string())?;
    let tauri::ipc::InvokeBody::Raw(pixels) = request.body() else {
        return Err("expected raw body".into());
    };
    write_image_file(&spec, pixels)?;
    let ms = t0.elapsed().as_millis() as u64;
    tracing::info!(
        "exported {}x{} {:?} to {} in {}ms",
        spec.width,
        spec.height,
        spec.format,
        spec.path,
        ms
    );
    Ok(ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(format: ImageFormat, w: u32, h: u32) -> ImageSpec {
        ImageSpec {
            path: String::new(),
            width: w,
            height: h,
            format,
            quality: 90,
        }
    }

    #[test]
    fn png8_roundtrip_keeps_straight_alpha() {
        let px: Vec<u8> = vec![255, 0, 0, 10, 0, 255, 0, 255, 0, 0, 255, 128, 1, 2, 3, 0];
        let mut buf = Vec::new();
        encode_to(&spec(ImageFormat::Png8, 2, 2), &px, &mut buf).unwrap();
        let dec = png::Decoder::new(std::io::Cursor::new(buf));
        let mut reader = dec.read_info().unwrap();
        let mut out = vec![0; reader.output_buffer_size().unwrap()];
        reader.next_frame(&mut out).unwrap();
        assert_eq!(out, px);
    }

    #[test]
    fn png16_has_16bit_depth() {
        let px = vec![0u8; 2 * 2 * 8];
        let mut buf = Vec::new();
        encode_to(&spec(ImageFormat::Png16, 2, 2), &px, &mut buf).unwrap();
        let dec = png::Decoder::new(std::io::Cursor::new(buf));
        let reader = dec.read_info().unwrap();
        assert_eq!(reader.info().bit_depth, png::BitDepth::Sixteen);
    }

    #[test]
    fn rejects_wrong_size() {
        let mut buf = Vec::new();
        assert!(encode_to(&spec(ImageFormat::Png8, 4, 4), &[0; 3], &mut buf).is_err());
    }

    #[test]
    fn jpg_encodes() {
        let px = vec![128u8; 8 * 8 * 3];
        let mut buf = Vec::new();
        encode_to(&spec(ImageFormat::Jpg, 8, 8), &px, &mut buf).unwrap();
        assert_eq!(&buf[0..2], &[0xFF, 0xD8]);
    }

    #[test]
    fn exr_writes_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.exr");
        let mut s = spec(ImageFormat::Exr, 2, 2);
        s.path = path.to_string_lossy().into();
        write_image_file(&s, &vec![0u8; 2 * 2 * 8]).unwrap();
        assert!(path.exists());
    }
}
