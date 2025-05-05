// src-tauri/src/main.rs

// Set windows subsystem only in release builds
// #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Declare modules
mod auth;

// --- Necessary Imports ---
#[cfg(debug_assertions)] // Conditional import for debug server state
use auth::AuthServerState;
use auth::{
    get_worker_api_key, get_worker_api_url, login_with_github, AuthError, PendingAuthState,
};

use base64::{engine::general_purpose::STANDARD, Engine as _}; // For image encoding
use dotenvy::dotenv; // For loading .env files
use serde::{Deserialize, Serialize}; // For (de)serializing data
use std::collections::HashMap; // For query parameters
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_deep_link::DeepLinkExt; // For Deep Link Plugin API
use tauri_plugin_single_instance; // Import the single instance plugin itself
use tokio::fs::read; // For async file reading (in worker command)
use url::Url; // For parsing URLs (essential for callbacks)

// --- Constants (or use functions from auth module) ---
// Helper to get the expected callback base URL (ensure consistency with auth.rs)
fn get_production_callback_base() -> &'static str {
    // Make sure this matches the one defined in auth.rs or your config
    "revision://github/callback"
}

// --- Reusable Callback Handling Logic ---
/// Handles the GitHub OAuth callback URL, whether received via deep link or single instance args.
///
/// Parses the URL for 'code' and 'state', finds the pending auth request,
/// and sends the code back to the waiting task via a oneshot channel.
fn handle_github_callback<R: Runtime>(app_handle: &AppHandle<R>, url: Url) {
    println!("[CallbackHandler] Processing URL: {}", url.to_string());
    let pending_state = match app_handle.try_state::<PendingAuthState>() {
        Some(state) => state,
        None => {
            eprintln!("[CallbackHandler] Error: PendingAuthState not managed.");
            // Notify the frontend about the internal error
            let _ = app_handle.emit(
                "github_auth_error",
                Some(&AuthError::InternalError(
                    "PendingAuthState not found".to_string(),
                )),
            );
            return;
        }
    };

    // Check if the URL starts with the expected production base
    if url.to_string().starts_with(get_production_callback_base()) {
        println!("[CallbackHandler] URL matches expected base.");
        // Parse query parameters ('code' and 'state')
        let params: HashMap<String, String> = url.query_pairs().into_owned().collect();

        if let (Some(code), Some(state)) = (params.get("code"), params.get("state")) {
            println!(
                "[CallbackHandler] Extracted State: {}, Code: [hidden]",
                state
            );

            // Attempt to remove the state and get the corresponding sender channel
            let sender = {
                // Lock the mutex to access the HashMap
                let mut map_guard = pending_state
                    .lock()
                    .expect("Failed to lock pending auth state for callback processing");
                // remove() returns Option<Sender>, consuming the entry if found
                map_guard.remove(state)
            };

            match sender {
                // If we found a sender for this state
                Some(tx) => {
                    println!(
                        "[CallbackHandler] State matched. Sending code via channel for state: {}",
                        state
                    );
                    // Clone necessary variables for the async task
                    let code_clone = code.clone();
                    let state_clone = state.clone();
                    let handle_clone = app_handle.clone(); // Clone AppHandle for event emission

                    // Send the code back asynchronously to avoid blocking the handler
                    tauri::async_runtime::spawn(async move {
                        if tx.send(Ok(code_clone)).is_err() {
                            // This happens if the receiving end (in login_with_github) was dropped,
                            // likely due to timeout or cancellation before the callback arrived.
                            eprintln!(
                                "[CallbackHandler] Receiver dropped before code could be sent. State: {}",
                                state_clone
                            );
                            // Emit an error to the frontend indicating the issue
                            let _ = handle_clone
                                .emit("github_auth_error", Some(&AuthError::CallbackTimeout));
                        } else {
                            println!(
                                "[CallbackHandler] Code sent successfully via channel for state: {}",
                                state_clone
                            );
                        }
                    });
                }
                // If no sender was found for this state (invalid, expired, or already processed)
                None => {
                    eprintln!(
                        "[CallbackHandler] Invalid or expired state received: {}",
                        state
                    );
                    // Emit an error to the frontend
                    let _ = app_handle.emit("github_auth_error", Some(&AuthError::InvalidState));
                }
            }
        } else {
            // If 'code' or 'state' parameters are missing from the callback URL
            eprintln!("[CallbackHandler] Callback URL missing 'code' or 'state' query parameters.");
            // Emit an error to the frontend
            let _ = app_handle.emit(
                "github_auth_error",
                Some(&AuthError::DeepLinkError(
                    "Missing code or state in callback URL".to_string(),
                )),
            );
        }
    } else {
        // If the URL doesn't match the expected scheme/path
        println!(
            "[CallbackHandler] Ignoring URL - does not match expected base: {}",
            url.to_string()
        );
    }
}

// --- Tauri Commands ---

/// Simple greeting command (example).
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Structs for the worker communication command.
#[derive(Serialize)]
struct WorkerQueryRequest<'a> {
    text: &'a str,
    #[serde(rename = "base64ImageDataUrl")]
    base64_image_data_url: Option<String>,
}

#[derive(Deserialize)]
struct WorkerQueryResponse {
    ai_text: String,
}

type CommandError = String; // Simple string error type for the command

/// Sends a query (text + optional image) to a backend worker.
#[tauri::command]
async fn send_query_to_worker(
    text: String,
    image_path: Option<String>, // Optional image path from frontend
    _app_handle: AppHandle,     // Included if needed for state/events later
) -> Result<String, CommandError> {
    println!(
        "[WorkerCmd] Received query: text='{}', image_path='{:?}'",
        text, image_path
    );

    let mut base64_data_url: Option<String> = None;

    // 1. Read and Base64 Encode Image (if path is valid)
    if let Some(path) = image_path.filter(|p| !p.is_empty()) {
        println!("[WorkerCmd] Attempting to read image file: {}", path);
        match read(&path).await {
            Ok(image_bytes) => {
                println!("[WorkerCmd] Read {} bytes from image.", image_bytes.len());
                // Basic MIME type detection from extension
                let mime_type = match std::path::Path::new(&path)
                    .extension()
                    .and_then(std::ffi::OsStr::to_str)
                {
                    Some("png") => "image/png",
                    Some("jpg") | Some("jpeg") => "image/jpeg",
                    Some("webp") => "image/webp",
                    Some("gif") => "image/gif",
                    _ => "image/png", // Default MIME type
                };
                println!("[WorkerCmd] Detected MIME type: {}", mime_type);
                // Encode bytes to base64 string
                let base64_encoded = STANDARD.encode(&image_bytes);
                println!("[WorkerCmd] Encoded image ({} chars)", base64_encoded.len());
                // Format as Data URL
                base64_data_url = Some(format!("data:{};base64,{}", mime_type, base64_encoded));
            }
            Err(e) => {
                let err_msg = format!("Failed to read image file '{}': {}", path, e);
                eprintln!("[WorkerCmd] Error: {}", err_msg);
                return Err(err_msg); // Return error to frontend
            }
        }
    } else {
        println!("[WorkerCmd] No valid image path provided.");
    }

    // 2. Prepare API Request Details
    let worker_url = format!("{}/query", get_worker_api_url());
    let worker_key = get_worker_api_key();

    // Validate configuration
    if worker_key.is_empty() || get_worker_api_url().is_empty() {
        let err_msg = "Worker API URL or Key is not configured.".to_string();
        eprintln!("[WorkerCmd] Error: {}", err_msg);
        return Err(err_msg);
    }

    // Mask key for logging
    let key_len = worker_key.len();
    let masked_key = if key_len > 4 {
        format!("***{}", &worker_key[key_len - 4..])
    } else {
        "***".to_string()
    };

    println!("[WorkerCmd] Sending request to: {}", worker_url);
    println!("[WorkerCmd] Using API Key: {}", masked_key);

    // Create the request payload
    let payload = WorkerQueryRequest {
        text: &text,
        base64_image_data_url: base64_data_url,
    };

    // 3. Send Request using reqwest
    let client = reqwest::Client::new();
    match client
        .post(&worker_url)
        .header("Authorization", format!("Bearer {}", worker_key)) // Auth header
        .header("Content-Type", "application/json") // Content type
        .json(&payload) // Serialize payload to JSON
        .send()
        .await
    {
        Ok(response) => {
            let status = response.status();
            println!("[WorkerCmd] Worker response status: {}", status);
            if status.is_success() {
                // Try to parse the successful JSON response
                match response.json::<WorkerQueryResponse>().await {
                    Ok(worker_response) => {
                        println!("[WorkerCmd] Successfully received and parsed worker response.");
                        Ok(worker_response.ai_text) // Return the AI text
                    }
                    Err(e) => {
                        let err_msg = format!("Failed to parse successful worker response: {}", e);
                        eprintln!("[WorkerCmd] Error: {}", err_msg);
                        Err(err_msg)
                    }
                }
            } else {
                // Handle HTTP error statuses from the worker
                let error_body = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "Failed to read error body".to_string());
                let err_msg = format!("Worker returned error status {}: {}", status, error_body);
                eprintln!("[WorkerCmd] Error: {}", err_msg);
                Err(err_msg)
            }
        }
        Err(e) => {
            // Handle network or request sending errors
            let err_msg = format!("Failed to send request to worker: {}", e);
            eprintln!("[WorkerCmd] Error: {}", err_msg);
            Err(err_msg)
        }
    }
}

// --- Main Application Entry Point and Setup ---
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load .env
    if cfg!(debug_assertions) {
        dotenvy::from_filename(".env.development").ok();
    } else {
        dotenvy::from_filename(".env.production").ok();
    }
    dotenv().ok();

    let pending_auth_state = PendingAuthState::default();

    let mut builder = tauri::Builder::default()
        // —— 【修改①】single-instance 必须最先注册 ——
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            println!("[SingleInstance] args={:?} cwd={}", args, cwd);
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
            for arg in args.iter().skip(1) {
                if arg.starts_with("revision://") {
                    if let Ok(url) = Url::parse(arg) {
                        handle_github_callback(app, url);
                        break;
                    }
                }
            }
        }))
        // —— 【修改①】deep-link 紧跟其后注册 ——
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_macos_permissions::init())
        .plugin(tauri_plugin_screenshots::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .manage(pending_auth_state.clone())
        .invoke_handler(tauri::generate_handler![
            greet,
            login_with_github,
            send_query_to_worker
        ]);

    #[cfg(debug_assertions)]
    {
        builder = builder.manage(AuthServerState::default());
    }

    builder
        .setup(move |app| {
            // —— 【修改②】运行时注册 deep-link 协议，开发模式下测试用 ——
            #[cfg(any(windows, target_os = "linux"))]
            {
                app.deep_link().register_all()?;
            }
            println!("[Setup] on_open_url handler");
            let handle: tauri::AppHandle = app.handle().clone();

            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    handle_github_callback(&handle, url.clone());
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
