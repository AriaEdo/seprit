// API keys live only in the OS keychain. The WebView can store or delete a key, and ask
// whether one is stored, but never read one back.
use serde::{Deserialize, Serialize};

const SERVICE: &str = "seprit";

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Anthropic,
    Openai,
    Gemini,
}

impl Provider {
    fn account(self) -> &'static str {
        match self {
            Provider::Anthropic => "anthropic",
            Provider::Openai => "openai",
            Provider::Gemini => "gemini",
        }
    }
}

#[derive(Serialize)]
pub struct KeyStatus {
    anthropic: bool,
    openai: bool,
    gemini: bool,
}

fn entry(p: Provider) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, p.account()).map_err(|e| e.to_string())
}

// Used by the AI request commands; the key stays on the Rust side.
pub fn get_key(p: Provider) -> Result<String, String> {
    match entry(p)?.get_password() {
        Ok(k) => Ok(k),
        Err(keyring::Error::NoEntry) => Err(format!("API key {} belum diisi (AI Settings…)", p.account())),
        Err(e) => Err(e.to_string()),
    }
}

fn has_key(p: Provider) -> Result<bool, String> {
    match entry(p)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn ai_key_status() -> Result<KeyStatus, String> {
    Ok(KeyStatus {
        anthropic: has_key(Provider::Anthropic)?,
        openai: has_key(Provider::Openai)?,
        gemini: has_key(Provider::Gemini)?,
    })
}

#[tauri::command]
pub fn ai_key_set(provider: Provider, key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("API key kosong".into());
    }
    entry(provider)?.set_password(key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_key_delete(provider: Provider) -> Result<(), String> {
    match entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
