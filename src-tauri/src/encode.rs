// Encodes raw RGBA pixels into formats the WebView can't write (WebP, TGA, TIFF).
// Pixels arrive as the raw request body; size and format come in headers to avoid a JSON number array.
use image::{ImageFormat, RgbaImage};
use std::io::Cursor;
use tauri::ipc::{Request, Response};

fn format_of(name: &str) -> Result<ImageFormat, String> {
    match name {
        "webp" => Ok(ImageFormat::WebP), // the image crate only writes lossless WebP, which pixel art needs anyway
        "tga" => Ok(ImageFormat::Tga),
        "tiff" => Ok(ImageFormat::Tiff),
        other => Err(format!("format tidak didukung: {other}")),
    }
}

fn encode(rgba: Vec<u8>, width: u32, height: u32, format: ImageFormat) -> Result<Vec<u8>, String> {
    let img = RgbaImage::from_raw(width, height, rgba).ok_or("ukuran data pixel tidak cocok dengan width × height")?;
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, format).map_err(|e| e.to_string())?;
    Ok(out.into_inner())
}

#[tauri::command]
pub fn encode_image(request: Request<'_>) -> Result<Response, String> {
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).ok_or(format!("header {name} tidak ada"));
    let width = header("width")?.parse().map_err(|_| "width tidak valid")?;
    let height = header("height")?.parse().map_err(|_| "height tidak valid")?;
    let format = format_of(header("format")?)?;
    let tauri::ipc::InvokeBody::Raw(rgba) = request.body() else { return Err("body harus berupa bytes".into()) };
    encode(rgba.clone(), width, height, format).map(Response::new)
}

// The fs scope only allows the path picked in the save dialog, so the .json beside an exported .png is
// written here. Only next to an existing .png (just written via the dialog), so it can't target arbitrary paths.
#[tauri::command]
pub fn write_sheet_json(png_path: String, json: String) -> Result<(), String> {
    let png = std::path::Path::new(&png_path);
    let is_png = png.extension().is_some_and(|e| e.eq_ignore_ascii_case("png"));
    if !is_png || !png.is_file() {
        return Err("JSON hanya bisa ditulis di samping file PNG hasil export".into());
    }
    std::fs::write(png.with_extension("json"), json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // 2 × 1: opaque red, half-transparent blue — checks color and alpha survive a round trip.
    const PIXELS: [u8; 8] = [255, 0, 0, 255, 0, 0, 255, 128];

    #[test]
    fn every_format_round_trips_pixels_and_alpha_exactly_since_pixel_art_cannot_tolerate_lossy_colors() {
        for format in [ImageFormat::WebP, ImageFormat::Tga, ImageFormat::Tiff] {
            let bytes = encode(PIXELS.to_vec(), 2, 1, format).unwrap();
            let back = image::load_from_memory_with_format(&bytes, format).unwrap().to_rgba8();
            assert_eq!(back.into_raw(), PIXELS, "{format:?}");
        }
    }

    #[test]
    fn rejects_data_that_does_not_match_the_size_instead_of_writing_a_garbled_image() {
        assert!(encode(vec![0; 4], 2, 1, ImageFormat::Tga).is_err());
    }

    #[test]
    fn sheet_json_goes_next_to_an_existing_png_and_nowhere_else() {
        let dir = std::env::temp_dir().join("seprit_sheet_json_test");
        std::fs::create_dir_all(&dir).unwrap();
        let png = dir.join("hero.png");
        assert!(write_sheet_json(png.to_string_lossy().into(), "{}".into()).is_err(), "png must exist");
        std::fs::write(&png, b"x").unwrap();
        write_sheet_json(png.to_string_lossy().into(), "{}".into()).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("hero.json")).unwrap(), "{}");
        assert!(write_sheet_json(dir.join("hero.json").to_string_lossy().into(), "{}".into()).is_err(), "only beside a .png");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_unknown_formats() {
        assert!(format_of("bmp").is_err());
    }
}
