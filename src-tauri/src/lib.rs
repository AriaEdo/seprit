mod ai_frame;
mod ai_keys;
mod ai_sprite;
mod encode;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            ai_keys::ai_key_status,
            ai_keys::ai_key_set,
            ai_keys::ai_key_delete,
            ai_frame::ai_next_frame,
            ai_sprite::ai_generate_sprite,
            encode::encode_image,
            encode::write_sheet_json
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
