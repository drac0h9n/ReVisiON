// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Declare modules if auth.rs is alongside main.rs
mod auth;

// Use necessary items from auth module
#[cfg(debug_assertions)]
use auth::AuthServerState;
use auth::{login_with_github, AuthError, PendingAuthState}; // Keep conditional server state import

use dotenvy::dotenv;
use std::collections::HashMap;
use tauri::{Emitter, Manager, Runtime, State}; // Add Runtime, Remove Emitter (not used directly in main.rs setup)
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url; // <-- IMPORT Url for parsing

// --- Configuration ---
// Helper function to get the production redirect URI base used for deep linking
fn get_production_callback_base() -> &'static str {
    // Must match the scheme and host/path part of your production redirect URI
    // defined in auth.rs's get_redirect_uri() for non-debug builds.
    "revision://github/callback"
}

// Define the greet command here
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}
// --- Main App Setup ---
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load environment variables based on build profile
    if cfg!(debug_assertions) {
        println!("Main: Loading .env.development");
        match dotenvy::from_filename(".env.development") {
            Ok(_) => println!("Main: Successfully loaded .env.development"),
            Err(e) => println!(
                "Main: Could not load .env.development - {}. Relying on system env vars.",
                e
            ),
        }
    } else {
        println!("Main: Loading .env.production");
        match dotenvy::from_filename(".env.production") {
            Ok(_) => println!("Main: Successfully loaded .env.production"),
            Err(e) => println!(
                "Main: Could not load .env.production - {}. Relying on system env vars.",
                e
            ),
        }
    }
    // Optionally, load default .env as a fallback or for shared variables
    dotenv().ok();

    let pending_auth_state = PendingAuthState::default();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_macos_permissions::init())
        .plugin(tauri_plugin_screenshots::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .manage(pending_auth_state.clone())
        .invoke_handler(tauri::generate_handler![greet, login_with_github]);

    #[cfg(debug_assertions)]
    {
        builder = builder.manage(AuthServerState::default());
        println!("Auth [Debug]: Server state managed.");
    }

    builder
        .setup(move |app| { // Use move closure to capture pending_auth_state clone if needed directly, or use app.state()
            // --- Deep Link Handler Setup ---
            // Register the handler. It will only be called if the OS is configured
            // via tauri.conf.json to route the custom scheme URLs to the app.
            println!("Deep Link: Registering on_open_url handler (will activate if scheme configured).");
            let handle = app.handle().clone(); // Get an AppHandle

            app.deep_link().on_open_url(move |event| {
                
                let received_urls: Vec<Url> = event.urls();
                
                

                // Get the pending auth state atomically using the captured handle
                let pending_state = handle.state::<PendingAuthState>(); // Get managed state

                for url in received_urls {
                    let url_str = url.to_string();
                    if url_str.starts_with(get_production_callback_base()) {
                        println!("Deep Link: Matched production callback URL: {}", url_str);

                        let params: HashMap<String, String> = url
                            .query_pairs()
                            .into_owned()
                            .collect();

                        if let (Some(code), Some(state)) = (params.get("code"), params.get("state")) {
                            println!("Deep Link: Extracted State: {}, Code: [hidden]", state);

                            let sender = {
                                let mut map_guard = pending_state.lock().expect("Failed to lock pending auth state for deep link");
                                map_guard.remove(state)
                            };

                            match sender {
                                Some(tx) => {
                                    println!("Deep Link: State matched. Sending code via channel.");
                                    let send_result = tx.send(Ok(code.clone()));
                                    if send_result.is_err() {
                                        eprintln!("Deep Link: Receiver dropped (Auth task likely timed out or errored). State: {}", state);
                                        let _ = handle.emit("github_auth_error", Some(&AuthError::CallbackTimeout));
                                    } else {
                                         println!("Deep Link: Code sent successfully for state: {}", state);
                                    }
                                }
                                None => {
                                    eprintln!("Deep Link: Invalid or expired state received: {}", state);
                                    let _ = handle.emit("github_auth_error", Some(&AuthError::InvalidState));
                                }
                            }
                        } else {
                            eprintln!("Deep Link: Callback URL missing 'code' or 'state' parameter: {}", url_str);
                            let _ = handle.emit("github_auth_error", Some(&AuthError::DeepLinkError("Missing code or state".to_string())));
                        }
                        // break; // Optional: uncomment if you only expect one matching URL
                    } else {
                         println!("Deep Link: Ignoring URL (not the expected callback): {}", url_str);
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
