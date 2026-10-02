// "Generate next frame": sends the active frame to Claude as a grid of palette indices and returns
// the next frame in the same format. Grids are checked strictly on the way in and out; the WebView
// checks the answer again before using it.
use crate::ai_keys::{get_key, Provider};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const MODEL: &str = "claude-opus-5-5";
const MAX_SIZE: usize = 64;
const MAX_TOKENS: u32 = 16000;
const TIMEOUT: Duration = Duration::from_secs(600);
// "0"–"f" = palette index, "." = transparent.
const INDEX_CHARS: &str = "0123456789abcdef";

const SYSTEM: &str = "You are a pixel-art animator. You receive one frame of a sprite animation as a grid: \
one string per row, one character per pixel, \".\" = transparent, \"0\"-\"f\" = palette index. \
Draw the next frame of the animation: same width, same height, same palette, same art style. \
Move or change only what the motion needs; keep everything else identical. \
Answer with the grid only, as {\"rows\": [...]}.";

#[derive(Deserialize)]
struct Grid {
    rows: Vec<String>,
}

fn validate_palette(palette: &[String]) -> Result<(), String> {
    let hex = |s: &String| s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit());
    if palette.is_empty() || palette.len() > INDEX_CHARS.len() || !palette.iter().all(hex) {
        return Err("Palette tidak valid".into());
    }
    Ok(())
}

// Returns (width, height). Every row has the same length and only chars valid for this palette.
fn validate_grid(rows: &[String], colors: usize) -> Result<(usize, usize), String> {
    let height = rows.len();
    let width = rows.first().map_or(0, |r| r.chars().count());
    if !(1..=MAX_SIZE).contains(&height) || !(1..=MAX_SIZE).contains(&width) {
        return Err(format!("Ukuran grid harus 1–{MAX_SIZE} × 1–{MAX_SIZE}"));
    }
    let allowed = &INDEX_CHARS[..colors];
    for (y, row) in rows.iter().enumerate() {
        if row.chars().count() != width {
            return Err(format!("Baris {} harus {width} karakter", y + 1));
        }
        if let Some(c) = row.chars().find(|&c| c != '.' && !allowed.contains(c)) {
            return Err(format!("Karakter tidak valid \"{c}\" di baris {}", y + 1));
        }
    }
    Ok((width, height))
}

fn prompt(rows: &[String], palette: &[String], instruction: &str) -> String {
    let legend: Vec<String> = palette.iter().enumerate().map(|(i, c)| format!("{} = {c}", &INDEX_CHARS[i..=i])).collect();
    let mut p = format!(
        "Palette:\n{}\n\nCurrent frame ({} × {}):\n{}\n",
        legend.join("\n"),
        rows[0].len(),
        rows.len(),
        rows.join("\n")
    );
    if !instruction.trim().is_empty() {
        p += &format!("\nInstruction for the next frame: {}\n", instruction.trim());
    }
    p
}

// Pulls the grid out of a Messages API response body; anything unexpected is an error, not a guess.
fn parse_response(body: &Value) -> Result<Vec<String>, String> {
    match body["stop_reason"].as_str() {
        Some("refusal") => return Err(format!("Claude menolak permintaan: {}", body["stop_details"])),
        Some("max_tokens") => return Err("Jawaban Claude terpotong (max_tokens)".into()),
        _ => {}
    }
    let text = body["content"]
        .as_array()
        .and_then(|blocks| blocks.iter().find(|b| b["type"] == "text"))
        .and_then(|b| b["text"].as_str())
        .ok_or("Jawaban Claude tidak berisi teks")?;
    let grid: Grid = serde_json::from_str(text).map_err(|e| format!("Jawaban Claude bukan grid JSON: {e}"))?;
    Ok(grid.rows)
}

#[tauri::command]
pub async fn ai_next_frame(rows: Vec<String>, palette: Vec<String>, instruction: String) -> Result<Vec<String>, String> {
    validate_palette(&palette)?;
    let size = validate_grid(&rows, palette.len())?;
    let key = get_key(Provider::Anthropic)?;

    let request = json!({
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "fallbacks": "default",
        "output_config": {
            "effort": "medium",
            "format": {
                "type": "json_schema",
                "schema": {
                    "type": "object",
                    "properties": { "rows": { "type": "array", "items": { "type": "string" } } },
                    "required": ["rows"],
                    "additionalProperties": false
                }
            }
        },
        "system": SYSTEM,
        "messages": [{ "role": "user", "content": prompt(&rows, &palette, &instruction) }]
    });

    let client = reqwest::Client::builder().timeout(TIMEOUT).build().map_err(|e| e.to_string())?;
    let res = client
        .post(API_URL)
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .header("anthropic-beta", "server-side-fallback-2026-07-01")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Request ke Claude gagal: {e}"))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Claude {status}: {text}"));
    }
    let body: Value = serde_json::from_str(&text).map_err(|e| format!("Respons Claude bukan JSON: {e}"))?;

    let out = parse_response(&body)?;
    if validate_grid(&out, palette.len())? != size {
        return Err("Ukuran grid dari Claude berbeda dengan frame".into());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grid(rows: &[&str]) -> Vec<String> {
        rows.iter().map(|r| r.to_string()).collect()
    }

    #[test]
    fn grid_accepts_palette_indices_and_transparent() {
        assert_eq!(validate_grid(&grid(&["0f.", "..a"]), 16), Ok((3, 2)));
    }

    #[test]
    fn grid_rejects_ragged_rows_so_the_sprite_is_never_resized() {
        assert!(validate_grid(&grid(&["000", "00"]), 16).is_err());
    }

    #[test]
    fn grid_rejects_indices_beyond_the_palette() {
        assert!(validate_grid(&grid(&["2"]), 2).is_err());
        assert!(validate_grid(&grid(&["A"]), 16).is_err());
    }

    #[test]
    fn grid_rejects_empty_and_over_64() {
        assert!(validate_grid(&[], 16).is_err());
        assert!(validate_grid(&grid(&[&"0".repeat(65)]), 16).is_err());
        assert!(validate_grid(&vec!["0".to_string(); 65], 16).is_err());
    }

    #[test]
    fn response_with_refusal_or_truncation_is_an_error_not_a_frame() {
        let refusal = json!({ "stop_reason": "refusal", "stop_details": {}, "content": [] });
        assert!(parse_response(&refusal).is_err());
        let cut = json!({ "stop_reason": "max_tokens", "content": [{ "type": "text", "text": "{\"rows\": [" }] });
        assert!(parse_response(&cut).is_err());
    }

    #[test]
    fn response_grid_is_read_from_the_text_block_after_thinking() {
        let ok = json!({ "stop_reason": "end_turn", "content": [
            { "type": "thinking", "thinking": "" },
            { "type": "text", "text": "{\"rows\": [\"01\"]}" }
        ] });
        assert_eq!(parse_response(&ok), Ok(grid(&["01"])));
    }

    #[test]
    fn palette_must_be_hex_colors_within_16() {
        assert!(validate_palette(&grid(&["#000000", "#ff004d"])).is_ok());
        assert!(validate_palette(&grid(&["red"])).is_err());
        assert!(validate_palette(&vec!["#000000".to_string(); 17]).is_err());
    }
}
