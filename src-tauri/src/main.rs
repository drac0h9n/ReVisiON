// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Declare modules
mod auth;

// Use necessary items
#[cfg(debug_assertions)]
use auth::AuthServerState;
use auth::{
    get_worker_api_key, get_worker_api_url, login_with_github, AuthError, PendingAuthState,
};
use base64::{engine::general_purpose::STANDARD, Engine as _}; // Import base64 Engine trait
use dotenvy::dotenv;
use serde::{Deserialize, Serialize}; // Add Serialize, Deserialize
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager, Runtime, State}; // Ensure AppHandle is imported
use tauri_plugin_deep_link::DeepLinkExt;
use tokio::fs::read; // Import tokio fs::read
use url::Url;

// --- Configuration ---
// (get_production_callback_base function remains the same)
fn get_production_callback_base() -> &'static str {
    "revision://github/callback"
}

// Define the greet command
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// --- Structs for Worker Communication ---
#[derive(Serialize)]
struct WorkerQueryRequest<'a> {
    text: &'a str,
    #[serde(rename = "base64ImageDataUrl")] // Match worker expected field name
    base64_image_data_url: Option<String>, // Optional image data URL
}

#[derive(Deserialize)]
struct WorkerQueryResponse {
    ai_text: String, // Expecting this field from the worker
                     // Add other fields if the worker sends more data back
}

// --- Error type for the new command ---
// Using String error for simplicity, could define a more specific enum
type CommandError = String;

// --- New Tauri Command: send_query_to_worker ---
#[tauri::command]
async fn send_query_to_worker(
    text: String,
    image_path: Option<String>, // Make image path optional
    _app_handle: AppHandle,     // Keep if needed for state or events, otherwise remove
) -> Result<String, CommandError> {
    println!(
        "[send_query_to_worker] Received query: '{}', Image path: {:?}",
        text, image_path
    );

    let mut base64_data_url: Option<String> = None;

    // 1. Read and Encode Image (if path is provided)
    if let Some(path) = image_path {
        if !path.is_empty() {
            println!(
                "[send_query_to_worker] Attempting to read image file: {}",
                path
            );
            match read(&path).await {
                Ok(image_bytes) => {
                    println!(
                        "[send_query_to_worker] Read {} bytes from image file.",
                        image_bytes.len()
                    );
                    // Determine MIME type (simple approach based on extension)
                    let mime_type = match std::path::Path::new(&path)
                        .extension()
                        .and_then(std::ffi::OsStr::to_str)
                    {
                        Some("png") => "image/png",
                        Some("jpg") | Some("jpeg") => "image/jpeg",
                        Some("webp") => "image/webp",
                        Some("gif") => "image/gif",
                        _ => "image/png", // Default or unknown
                    };
                    println!("[send_query_to_worker] Detected MIME type: {}", mime_type);

                    let base64_encoded = STANDARD.encode(&image_bytes);
                    println!(
                        "[send_query_to_worker] Encoded image to base64 ({} chars)",
                        base64_encoded.len()
                    );
                    base64_data_url = Some(format!("data:{};base64,{}", mime_type, base64_encoded));
                }
                Err(e) => {
                    let err_msg = format!("Failed to read image file '{}': {}", path, e);
                    eprintln!("[send_query_to_worker] Error: {}", err_msg);
                    return Err(err_msg);
                }
            }
        } else {
            println!("[send_query_to_worker] Received empty image path, skipping image.");
        }
    } else {
        println!("[send_query_to_worker] No image path provided.");
    }

    // 2. Prepare Request for Worker
    let worker_url = format!("{}/query", get_worker_api_url()); // Append /query path
    let worker_key = get_worker_api_key();

    if worker_key.is_empty() {
        let err_msg = "Worker API Key is not configured.".to_string();
        eprintln!("[send_query_to_worker] Error: {}", err_msg);
        return Err(err_msg);
    }
    if get_worker_api_url().is_empty() {
        let err_msg = "Worker API URL is not configured.".to_string();
        eprintln!("[send_query_to_worker] Error: {}", err_msg);
        return Err(err_msg);
    }

    let key_len = worker_key.len();
    let masked_key = if key_len > 4 {
        format!("***{}", &worker_key[key_len - 4..])
    } else {
        "***".to_string()
    };

    println!(
        "[send_query_to_worker] Sending request to Worker URL: {}",
        worker_url
    );
    println!(
        "[send_query_to_worker] Using Worker API Key: {}",
        masked_key
    );

    let payload = WorkerQueryRequest {
        text: &text,
        base64_image_data_url: base64_data_url,
    };

    // 3. Send Request to Worker
    let client = reqwest::Client::new();
    match client
        .post(&worker_url)
        .header("Authorization", format!("Bearer {}", worker_key))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
    {
        Ok(response) => {
            let status = response.status();
            println!(
                "[send_query_to_worker] Worker responded with status: {}",
                status
            );
            if status.is_success() {
                match response.json::<WorkerQueryResponse>().await {
                    Ok(worker_response) => {
                        println!(
                            "[send_query_to_worker] Successfully received and parsed AI response."
                        );
                        Ok(worker_response.ai_text)
                    }
                    Err(e) => {
                        let err_msg = format!("Failed to parse worker response: {}", e);
                        eprintln!("[send_query_to_worker] Error: {}", err_msg);
                        Err(err_msg)
                    }
                }
            } else {
                let error_body = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "Failed to read error body".to_string());
                let err_msg = format!("Worker returned error status {}: {}", status, error_body);
                eprintln!("[send_query_to_worker] Error: {}", err_msg);
                Err(err_msg)
            }
        }
        Err(e) => {
            let err_msg = format!("Failed to send request to worker: {}", e);
            eprintln!("[send_query_to_worker] Error: {}", err_msg);
            Err(err_msg)
        }
    }
}

// --- Main App Setup ---
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Environment variable loading remains the same...
    if cfg!(debug_assertions) { /* ... */
    } else { /* ... */
    }
    dotenv().ok();

    let pending_auth_state = PendingAuthState::default();

    let mut builder = tauri::Builder::default()
        // Register plugins...
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_macos_permissions::init())
        .plugin(tauri_plugin_screenshots::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .manage(pending_auth_state.clone())
        // --> ADD the new command to the handler <--
        .invoke_handler(tauri::generate_handler![
            greet,
            login_with_github,
            send_query_to_worker // Added command
        ]);

    #[cfg(debug_assertions)]
    {
        builder = builder.manage(AuthServerState::default());
        println!("Auth [Debug]: Server state managed.");
    }

    builder
        .setup(move |app| {
            // Deep Link Handler Setup remains the same...
            println!(
                "Deep Link: Registering on_open_url handler (will activate if scheme configured)."
            );
            let handle = app.handle().clone();

            app.deep_link().on_open_url(move |event| {
                let received_urls: Vec<Url> = event.urls();
                let pending_state = handle.state::<PendingAuthState>();

                for url in received_urls {
                    let url_str = url.to_string();
                    // Callback handling logic...
                    if url_str.starts_with(get_production_callback_base()) {
                        // ... (existing deep link logic) ...
                        println!("Deep Link: Matched production callback URL: {}", url_str);
                        let params: HashMap<String, String> =
                            url.query_pairs().into_owned().collect();
                        if let (Some(code), Some(state)) = (params.get("code"), params.get("state"))
                        {
                            println!("Deep Link: Extracted State: {}, Code: [hidden]", state);
                            let sender = {
                                let mut map_guard = pending_state
                                    .lock()
                                    .expect("Failed to lock pending auth state for deep link");
                                map_guard.remove(state)
                            };
                            match sender {
                                Some(tx) => {
                                    println!("Deep Link: State matched. Sending code via channel.");
                                    let send_result = tx.send(Ok(code.clone()));
                                    if send_result.is_err() {
                                        eprintln!("Deep Link: Receiver dropped. State: {}", state);
                                        let _ = handle.emit(
                                            "github_auth_error",
                                            Some(&AuthError::CallbackTimeout),
                                        );
                                    } else {
                                        println!(
                                            "Deep Link: Code sent successfully for state: {}",
                                            state
                                        );
                                    }
                                }
                                None => {
                                    eprintln!(
                                        "Deep Link: Invalid or expired state received: {}",
                                        state
                                    );
                                    let _ = handle
                                        .emit("github_auth_error", Some(&AuthError::InvalidState));
                                }
                            }
                        } else {
                            eprintln!("Deep Link: Callback URL missing 'code' or 'state'");
                            let _ = handle.emit(
                                "github_auth_error",
                                Some(&AuthError::DeepLinkError(
                                    "Missing code or state".to_string(),
                                )),
                            );
                        }
                    } else {
                        println!("Deep Link: Ignoring URL: {}", url_str);
                    }
                }
            }); // end on_open_url
            Ok(())
        }) // end setup
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
