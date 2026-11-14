use image::{ImageFormat, ImageReader, Limits};
use std::io::Cursor;

static DECODERS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);

pub async fn decode_icon(bytes: Vec<u8>) -> Result<Vec<u8>, IconDecodeError> {
    let permit = DECODERS
        .acquire()
        .await
        .map_err(|_| IconDecodeError::Invalid)?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        normalize_icon(&bytes)
    })
    .await
    .map_err(|_| IconDecodeError::Invalid)?
}

#[derive(Debug, thiserror::Error)]
pub enum IconDecodeError {
    #[error("Icon exceeds 2 MiB.")]
    TooLarge,
    #[error("Use a PNG, JPEG, WebP or ICO image.")]
    Unsupported,
    #[error("The image is invalid or exceeds decoding limits.")]
    Invalid,
}

/// Decode only raster formats and discard embedded metadata by re-encoding PNG.
/// Call from a bounded blocking worker, not an async executor thread.
pub fn normalize_icon(bytes: &[u8]) -> Result<Vec<u8>, IconDecodeError> {
    if bytes.len() > 2 * 1024 * 1024 {
        return Err(IconDecodeError::TooLarge);
    }
    let format = image::guess_format(bytes).map_err(|_| IconDecodeError::Unsupported)?;
    if !matches!(
        format,
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP | ImageFormat::Ico
    ) {
        return Err(IconDecodeError::Unsupported);
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    limits.max_alloc = Some(64 * 1024 * 1024);
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(limits);
    let image = reader.decode().map_err(|_| IconDecodeError::Invalid)?;
    let mut output = Cursor::new(Vec::new());
    image
        .thumbnail(256, 256)
        .to_rgba8()
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|_| IconDecodeError::Invalid)?;
    Ok(output.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes_and_bounds_raster_icons() -> Result<(), Box<dyn std::error::Error>> {
        let mut source = Cursor::new(Vec::new());
        image::RgbaImage::new(512, 128).write_to(&mut source, ImageFormat::Png)?;
        let output = normalize_icon(source.get_ref())?;
        let image = image::load_from_memory(&output)?;
        assert_eq!((image.width(), image.height()), (256, 64));
        assert!(matches!(
            normalize_icon(b"<svg></svg>"),
            Err(IconDecodeError::Unsupported)
        ));
        assert!(matches!(
            normalize_icon(&vec![0; 2 * 1024 * 1024 + 1]),
            Err(IconDecodeError::TooLarge)
        ));
        let mut oversized = Cursor::new(Vec::new());
        image::RgbaImage::new(4097, 1).write_to(&mut oversized, ImageFormat::Png)?;
        assert!(matches!(
            normalize_icon(oversized.get_ref()),
            Err(IconDecodeError::Invalid)
        ));
        Ok(())
    }
}
