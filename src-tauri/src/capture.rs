//! Screenshots for vision models. Runs on a blocking thread (xcap's Monitor isn't Send on Windows).

use std::io::Cursor;

use base64::Engine;
use xcap::Monitor;
use xcap::image::{DynamicImage, codecs::jpeg::JpegEncoder, imageops::FilterType};

use crate::error::{AppError, Result};

/// Longest edge sent to the model. Big enough to read code, small enough to stay fast/cheap.
const MAX_EDGE: u32 = 1600;
const JPEG_QUALITY: u8 = 82;

/// Capture the monitor containing `point` (or the primary one) as a base64 JPEG.
pub fn screenshot(point: Option<(i32, i32)>) -> Result<(String, String)> {
    let monitor = point
        .and_then(|(x, y)| Monitor::from_point(x, y).ok())
        .or_else(|| {
            Monitor::all()
                .ok()?
                .into_iter()
                .find(|m| m.is_primary().unwrap_or(false))
        })
        .or_else(|| Monitor::all().ok()?.into_iter().next())
        .ok_or_else(|| AppError::Capture("no monitor found".into()))?;

    let img = monitor
        .capture_image()
        .map_err(|e| AppError::Capture(e.to_string()))?;
    let mut img = DynamicImage::ImageRgba8(img);
    if img.width().max(img.height()) > MAX_EDGE {
        img = img.resize(MAX_EDGE, MAX_EDGE, FilterType::Triangle);
    }
    let rgb = img.to_rgb8();

    let mut buf = Cursor::new(Vec::new());
    JpegEncoder::new_with_quality(&mut buf, JPEG_QUALITY)
        .encode_image(&rgb)
        .map_err(|e| AppError::Capture(e.to_string()))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(buf.into_inner());
    Ok(("image/jpeg".into(), b64))
}
