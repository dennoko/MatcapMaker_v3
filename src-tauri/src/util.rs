/// Minimal percent-decoding for header values produced by `encodeURIComponent`.
pub fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Binary container used for IPC payloads that mix JSON and blobs:
/// `[u32 LE json length][json][blob bytes...]`; the JSON describes blob
/// offsets relative to the end of the JSON section.
pub fn pack(json: &str, blobs: &[&[u8]]) -> Vec<u8> {
    let total: usize = blobs.iter().map(|b| b.len()).sum();
    let mut out = Vec::with_capacity(4 + json.len() + total);
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(json.as_bytes());
    for b in blobs {
        out.extend_from_slice(b);
    }
    out
}

pub fn unpack(data: &[u8]) -> Result<(&str, &[u8]), String> {
    if data.len() < 4 {
        return Err("payload too short".into());
    }
    let n = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
    if data.len() < 4 + n {
        return Err("payload truncated".into());
    }
    let json = std::str::from_utf8(&data[4..4 + n]).map_err(|e| e.to_string())?;
    Ok((json, &data[4 + n..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent() {
        assert_eq!(percent_decode("C%3A%5C%E7%94%BB%E5%83%8F.png"), "C:\\画像.png");
        assert_eq!(percent_decode("100%"), "100%");
    }

    #[test]
    fn pack_roundtrip() {
        let p = pack("{\"a\":1}", &[b"xy", b"z"]);
        let (j, rest) = unpack(&p).unwrap();
        assert_eq!(j, "{\"a\":1}");
        assert_eq!(rest, b"xyz");
    }
}
