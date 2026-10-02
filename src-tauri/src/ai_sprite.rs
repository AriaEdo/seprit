// "Generate sprite": text prompt → image from OpenAI or Gemini, returned to the WebView as base64
// (it decodes and shrinks it like Import). The image's aspect ratio is the supported one nearest the canvas.
use crate::ai_keys::{get_key, Provider};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

const OPENAI_URL: &str = "https://api.openai.com/v1/images/generations";
const OPENAI_MODEL: &str = "gpt-image-2.5-flare";
// (size, width / height)
const OPENAI_SIZES: &[(&str, f64)] = &[("1024x1024", 1.0), ("1536x1024", 1.5), ("1024x1536", 1024.0 / 1536.0)];

const GEMINI_URL: &str = "https://generativelanguage.googleapis.com/v1beta/interactions";
const GEMINI_MODEL: &str = "gemini-3.1-flash-image";
const GEMINI_RATIOS: &[(&str, f64)] = &[
    ("1:1", 1.0), ("3:2", 1.5), ("2:3", 2.0 / 3.0), ("4:3", 4.0 / 3.0), ("3:4", 0.75), ("5:4", 1.25),
    ("4:5", 0.8), ("16:9", 16.0 / 9.0), ("9:16", 9.0 / 16.0), ("21:9", 21.0 / 9.0),
];
// Gemini can't return transparency, so ask for a background the WebView can strip.
const GEMINI_BACKGROUND: &str = " Plain, solid, single-color background.";

// Image generation can take a couple of minutes.
const TIMEOUT: Duration = Duration::from_secs(300);
const MAX_PROMPT: usize = 4000;
const MAX_CANVAS: u32 = 512;
// How much of an unexpected response body goes into the error message.
const BODY_SNIPPET: usize = 500;

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum SpriteProvider {
    Openai,
    Gemini,
}

// Compared in log space so 2:1 and 1:2 are equally far from 1:1.
fn nearest<'a>(options: &[(&'a str, f64)], width: u32, height: u32) -> &'a str {
    let want = (width as f64 / height as f64).ln();
    let dist = |r: f64| (r.ln() - want).abs();
    options.iter().min_by(|a, b| dist(a.1).total_cmp(&dist(b.1))).unwrap().0
}

fn snippet(text: &str) -> String {
    text.chars().take(BODY_SNIPPET).collect()
}

fn is_base64(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(&b))
}

fn openai_image(body: &Value) -> Option<&str> {
    body["data"][0]["b64_json"].as_str()
}

// The last image block of the last model output step.
fn gemini_image(body: &Value) -> Option<&str> {
    body["steps"]
        .as_array()?
        .iter()
        .rev()
        .filter(|s| s["type"] == "model_output")
        .find_map(|s| s["content"].as_array()?.iter().rev().find(|c| c["type"] == "image")?["data"].as_str())
}

#[tauri::command]
pub async fn ai_generate_sprite(provider: SpriteProvider, prompt: String, width: u32, height: u32) -> Result<String, String> {
    let prompt = prompt.trim();
    if prompt.is_empty() || prompt.chars().count() > MAX_PROMPT {
        return Err(format!("Prompt harus 1–{MAX_PROMPT} karakter"));
    }
    if !(1..=MAX_CANVAS).contains(&width) || !(1..=MAX_CANVAS).contains(&height) {
        return Err("Ukuran canvas tidak valid".into());
    }

    let client = reqwest::Client::builder().timeout(TIMEOUT).build().map_err(|e| e.to_string())?;
    let (name, request) = match provider {
        SpriteProvider::Openai => (
            "OpenAI",
            client.post(OPENAI_URL).bearer_auth(get_key(Provider::Openai)?).json(&json!({
                "model": OPENAI_MODEL,
                "prompt": prompt,
                "n": 1,
                "size": nearest(OPENAI_SIZES, width, height),
                "background": "transparent",
                "output_format": "png"
            })),
        ),
        SpriteProvider::Gemini => (
            "Gemini",
            client.post(GEMINI_URL).header("x-goog-api-key", get_key(Provider::Gemini)?).json(&json!({
                "model": GEMINI_MODEL,
                "input": [{ "type": "text", "text": format!("{prompt}{GEMINI_BACKGROUND}") }],
                "response_format": {
                    "type": "image",
                    "mime_type": "image/jpeg",
                    "aspect_ratio": nearest(GEMINI_RATIOS, width, height),
                    "image_size": "1K"
                }
            })),
        ),
    };

    let res = request.send().await.map_err(|e| format!("Request ke {name} gagal: {e}"))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("{name} {status}: {text}"));
    }
    let body: Value = serde_json::from_str(&text).map_err(|e| format!("Respons {name} bukan JSON: {e}"))?;
    let image = match provider {
        SpriteProvider::Openai => openai_image(&body),
        SpriteProvider::Gemini => gemini_image(&body),
    };
    match image {
        Some(b64) if is_base64(b64) => Ok(b64.to_string()),
        _ => Err(format!("Respons {name} tidak berisi gambar: {}", snippet(&text))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn square_and_near_square_canvases_get_square_images() {
        assert_eq!(nearest(OPENAI_SIZES, 32, 32), "1024x1024");
        assert_eq!(nearest(GEMINI_RATIOS, 33, 32), "1:1");
    }

    #[test]
    fn wide_and_tall_canvases_get_the_closest_supported_shape_so_the_sprite_fills_the_canvas() {
        assert_eq!(nearest(OPENAI_SIZES, 64, 32), "1536x1024");
        assert_eq!(nearest(OPENAI_SIZES, 16, 64), "1024x1536");
        assert_eq!(nearest(GEMINI_RATIOS, 64, 36), "16:9");
        assert_eq!(nearest(GEMINI_RATIOS, 36, 64), "9:16");
        assert_eq!(nearest(GEMINI_RATIOS, 512, 1), "21:9");
    }

    #[test]
    fn openai_image_is_read_from_b64_json() {
        let body = json!({ "data": [{ "b64_json": "iVBORw0KGgo=" }] });
        assert_eq!(openai_image(&body), Some("iVBORw0KGgo="));
        assert_eq!(openai_image(&json!({ "data": [] })), None);
    }

    #[test]
    fn gemini_image_is_the_last_image_of_the_model_output_not_a_thought() {
        let body = json!({ "steps": [
            { "type": "thought", "summary": [{ "type": "image", "data": "THOUGHT" }] },
            { "type": "model_output", "content": [{ "type": "text", "text": "here" }, { "type": "image", "data": "FINAL" }] }
        ] });
        assert_eq!(gemini_image(&body), Some("FINAL"));
        assert_eq!(gemini_image(&json!({ "steps": [{ "type": "model_output", "content": [] }] })), None);
    }

    #[test]
    fn base64_check_rejects_empty_and_non_base64() {
        assert!(is_base64("iVBORw0KGgo="));
        assert!(!is_base64(""));
        assert!(!is_base64("not base64!"));
    }
}
