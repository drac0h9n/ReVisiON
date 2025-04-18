// src-tauri/src/auth.rs
// --- Dependencies ---
use once_cell::sync::Lazy; // For lazy static initialization
use rand::distr::Alphanumeric;
use rand::{thread_rng, Rng};
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex}; // Use StdMutex for PendingAuthState
use tauri::{AppHandle, Emitter, Manager, Runtime, State}; // Ensure Manager is imported
use thiserror::Error;
use tokio::sync::{oneshot, Mutex as TokioMutex}; // TokioMutex for async server state
use urlencoding; // For URL encoding parameters

// --- Conditional Imports for Dev Server ---
#[cfg(debug_assertions)]
use axum::{
    extract::{Query, State as AxumState},
    response::Html,
    routing::get,
    Router, http,
};
#[cfg(debug_assertions)]
use std::net::SocketAddr;

// --- Configuration Structure ---
#[derive(Clone, Debug)]
struct EnvConfig {
    github_client_id: String,
    github_client_secret: String,
    worker_api_url: String,
    worker_api_key: String,
}

// --- Compile-time Embedding and Lazy Parsing (with detailed logging) ---
// Reads the appropriate .env file *at compile time* using include_str!
// Parses the content *once* at runtime when first accessed.
// WARNING: This embeds secrets directly into the binary.
static CONFIG: Lazy<EnvConfig> = Lazy::new(|| {
    println!("Auth: Initializing embedded configuration...");
    let env_content = if cfg!(debug_assertions) {
        println!("Auth: Embedding .env.development content.");
        include_str!("../../.env.development")
    } else {
        println!("Auth: Embedding .env.production content.");
        include_str!("../../.env.production")
    };

    println!("Auth: Parsing embedded content:\n---\n{}\n---", env_content);
    let mut vars = HashMap::new();
    for (line_num, line) in env_content.lines().enumerate() {
        let trimmed_line = line.trim();
        if trimmed_line.is_empty() || trimmed_line.starts_with('#') {
            continue;
        }
        // Split only on the *first* '='
        if let Some((key, value)) = trimmed_line.split_once('=') {
            let key_trimmed = key.trim();
            // --- START: Modification Area ---
            // OLD LOGIC:
            // let value_trimmed = value.trim();

            // NEW LOGIC (with quote stripping):
            let value_initially_trimmed = value.trim(); // 1. Trim whitespace first
            let final_value = // 2. Check for surrounding quotes and strip if found
                if value_initially_trimmed.starts_with('"') && value_initially_trimmed.ends_with('"') && value_initially_trimmed.len() >= 2 {
                    &value_initially_trimmed[1..value_initially_trimmed.len() - 1] // Strip double quotes
                } else if value_initially_trimmed.starts_with('\'') && value_initially_trimmed.ends_with('\'') && value_initially_trimmed.len() >= 2 {
                    &value_initially_trimmed[1..value_initially_trimmed.len() - 1] // Strip single quotes
                } else {
                    value_initially_trimmed // No surrounding quotes, use the trimmed value
                };
            // --- END: Modification Area ---

            if key_trimmed.is_empty() {
                 println!("Auth: Warning - Parsed empty key in embedded .env line {}: {}", line_num + 1, line);
                 continue;
            }
             // Use the 'final_value' which might have had quotes stripped
             println!("Auth: Parsed line {}: KEY='{}', VALUE='{}'", line_num + 1, key_trimmed, final_value);
            // Insert the potentially modified value into the map
            vars.insert(key_trimmed.to_string(), final_value.to_string()); // Use final_value here

        } else {
             if !trimmed_line.is_empty() {
                 println!("Auth: Warning - Could not parse line {} in embedded .env (missing '='?): {}", line_num + 1, line);
             }
        }
    }
    println!("Auth: Finished parsing embedded content. Found {} potential variables.", vars.len());

    // --- Extraction logic remains the same, but uses the parsed 'vars' map ---
    let config = EnvConfig {
        github_client_id: {
            println!("Auth: Extracting GITHUB_CLIENT_ID...");
            let key = "GITHUB_CLIENT_ID";
            let val = vars.get(key) // Get value from the map we populated
                .unwrap_or_else(|| panic!("Embedded .env file must contain {}", key))
                .clone(); // Clone the String value
            println!("Auth: GITHUB_CLIENT_ID = '{}'", val);
            if val.is_empty() { panic!("Embedded GITHUB_CLIENT_ID must not be empty"); }
            val
        },
        // ... (similar extraction for other keys: GITHUB_CLIENT_SECRET, WORKER_API_URL, WORKER_API_KEY) ...
        github_client_secret: {
             println!("Auth: Extracting GITHUB_CLIENT_SECRET...");
             let key = "GITHUB_CLIENT_SECRET";
             let val = vars.get(key).unwrap_or_else(|| panic!("...must contain {}", key)).clone();
             let secret_len = val.len();
             let masked_secret = if secret_len > 4 { format!("***{}", &val[secret_len-4..]) } else { "***".to_string() };
             println!("Auth: GITHUB_CLIENT_SECRET = '{}'", masked_secret);
             if val.is_empty() { panic!("...must not be empty"); }
             val
         },
         worker_api_url: {
             println!("Auth: Extracting WORKER_API_URL...");
             let key = "WORKER_API_URL";
             let val = vars.get(key).unwrap_or_else(|| panic!("...must contain {}", key)).clone();
             println!("Auth: WORKER_API_URL = '{}'", val);
              if val.is_empty() { panic!("...must not be empty"); }
             val
         },
         worker_api_key: {
              println!("Auth: Extracting WORKER_API_KEY...");
              let key = "WORKER_API_KEY";
              let val = vars.get(key).unwrap_or_else(|| panic!("...must contain {}", key)).clone();
              let key_len = val.len();
              let masked_key = if key_len > 4 { format!("***{}", &val[key_len-4..]) } else { "***".to_string() };
              println!("Auth: WORKER_API_KEY = '{}'", masked_key);
              if val.is_empty() { panic!("...must not be empty"); }
              val
         },
    };
     println!("Auth: Embedded configuration initialized successfully.");
     config
});

// --- Accessor functions for embedded config ---
// These provide clean access to the lazily initialized static CONFIG
fn get_github_client_id() -> &'static str {
    &CONFIG.github_client_id
}

fn get_github_client_secret() -> &'static str {
    &CONFIG.github_client_secret
}

fn get_worker_api_url() -> &'static str {
    &CONFIG.worker_api_url
}

 fn get_worker_api_key() -> &'static str {
    &CONFIG.worker_api_key
}

// --- Dynamic Redirect URI based on build type (remains the same) ---
fn get_redirect_uri() -> &'static str {
    if cfg!(debug_assertions) {
        "http://127.0.0.1:54321/callback" // Development: Local server
    } else {
        "revision://github/callback" // Production: Use YOUR custom scheme "revision"
    }
}

const CSRF_STATE_EXPIRY_SECS: u64 = 300; // 5 minutes

// --- State Management ---
// Shared state for pending requests (used by both dev server and deep link handler)
pub type PendingAuthState = Arc<StdMutex<HashMap<String, oneshot::Sender<Result<String, AuthError>>>>>;

// --- Dev Server Specific State ---
#[cfg(debug_assertions)]
#[derive(Default)]
pub struct ServerHandle {
   pub shutdown_tx: Option<oneshot::Sender<()>>,
   pub join_handle: Option<tokio::task::JoinHandle<()>>,
}
#[cfg(debug_assertions)]
pub type AuthServerState = Arc<TokioMutex<ServerHandle>>; // TokioMutex needed for async locking around start/stop

// --- Data Structures ---
#[derive(Deserialize, Debug)]
struct CallbackParams {
    code: String,
    state: String,
}

#[derive(Deserialize, Debug)]
struct GithubTokenResponse {
    access_token: String,
    // scope: String, // Often included, keep if needed
    // token_type: String, // Often included, keep if needed
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GithubUserProfile {
    login: String,
    id: u64,
    name: Option<String>,
    avatar_url: String,
    email: Option<String>, // Make sure 'user:email' scope is requested
}

#[derive(Serialize, Debug)]
struct BackendSyncPayload<'a> {
    profile: &'a GithubUserProfile,
}

#[derive(Deserialize, Debug)]
struct BackendSyncResponse {
    success: bool,
    message: Option<String>,
}

// --- Error Handling ---
#[derive(Serialize, Debug, Clone, Error)]
pub enum AuthError {
    #[error("Network request failed: {0}")]
    ReqwestError(String),
    #[cfg(debug_assertions)]
    #[error("Failed to start local callback server: {0}")]
    ServerStartError(String),
    #[error("Invalid CSRF state received")]
    InvalidState,
    #[error("GitHub returned an error: {0}")]
    GitHubError(String),
    #[error("Callback timed out or was cancelled")]
    CallbackTimeout,
    #[error("Failed to parse response: {0}")]
    ParseError(String),
    #[error("Internal error: {0}")]
    InternalError(String),
    #[error("Authentication cancelled by user or system")]
    Cancelled,
    #[error("Failed to sync user data to backend: {0}")]
    BackendSyncFailed(String),
    #[error("Deep link error: {0}")]
    DeepLinkError(String),
    // Added specific error for config issues if needed, though panic is current behavior
    // #[error("Configuration error: {0}")]
    // ConfigError(String),
}

// Convert reqwest errors
impl From<reqwest::Error> for AuthError {
    fn from(err: reqwest::Error) -> Self {
        AuthError::ReqwestError(err.to_string())
    }
}

// --- Tauri Command ---
#[tauri::command]
pub async fn login_with_github<R: Runtime>(
    app: AppHandle<R>,
    pending_auth_state: State<'_, PendingAuthState>,
) -> Result<String, String> { // Returns GitHub Auth URL or an error string
    println!("Auth: Initiating GitHub OAuth flow...");

    // --- Determine Redirect URI ---
    let redirect_uri = get_redirect_uri();
    println!("Auth: Using redirect URI: {}", redirect_uri);

    // --- Get Client ID and Log It Carefully ---
    // Access the embedded config via the accessor function.
    // This triggers the Lazy initialization on the first call.
    let github_client_id = get_github_client_id();
    // Log the raw ID value obtained from config to verify it's correct and not empty.
    println!("Auth: Using Client ID from config: '{}'", github_client_id);
    // Ensure client_id is not empty after retrieval, otherwise the URL will be invalid.
    if github_client_id.is_empty() {
        let err_msg = "Fatal: Embedded GITHUB_CLIENT_ID is empty after initialization.".to_string();
        eprintln!("Auth: {}", err_msg);
        // Optionally emit an error event
        let _ = app.emit("github_auth_error", Some(AuthError::InternalError(err_msg.clone())));
        return Err(err_msg); // Return error to frontend
    }


    // --- State and Channel Setup ---
    let state: String = thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32) // Generate a random state string
        .map(char::from)
        .collect();
    let (code_tx, code_rx) = oneshot::channel::<Result<String, AuthError>>();

    // --- Conditional: Start Dev Server ---
    #[cfg(debug_assertions)]
    {
        if let Some(server_state) = app.try_state::<AuthServerState>() {
             println!("Auth [Debug]: Attempting to start local callback server...");
             let server_start_result = start_dev_server(
                 app.clone(),
                 pending_auth_state.inner().clone(), // Pass Arc<StdMutex<...>>
                 server_state.inner().clone() // Pass Arc<TokioMutex<...>>
             ).await;

             if let Err(e) = server_start_result {
                 eprintln!("Auth [Debug]: Failed to start server: {:?}", e);
                 let _ = app.emit("github_auth_error", Some(e.clone())); // Emit specific error
                 return Err(e.to_string()); // Return error to frontend invoke
             }
             println!("Auth [Debug]: Local callback server running or already started.");
        } else {
            let err = AuthError::InternalError("AuthServerState not managed in debug build".to_string());
             eprintln!("Auth [Debug]: Error - {}", err);
             let _ = app.emit("github_auth_error", Some(err.clone()));
             return Err(err.to_string());
        }
    } // End #[cfg(debug_assertions)] block for starting server

    // --- Store state and sender *before* returning URL ---
    {
        let mut pending_map = pending_auth_state.lock().expect("Failed to lock pending auth state");
        pending_map.insert(state.clone(), code_tx);
        println!("Auth: State '{}' stored. Ready for callback/deep link.", state);
    }

    // --- Encode parameters needed for the URL ---
    // Encode redirect_uri
    let encoded_redirect_uri = urlencoding::encode(redirect_uri);
    println!("Auth: Encoded Redirect URI: {}", encoded_redirect_uri);

    // Encode scope
    let scope = "read:user user:email"; // Request basic profile and email access
    let encoded_scope = urlencoding::encode(scope);
     println!("Auth: Encoded Scope: {}", encoded_scope);

    // State usually doesn't *need* encoding unless it contains special URL characters,
    // but it's safer if you expect unusual state values. Standard Alphanumeric is fine.
    // let encoded_state = urlencoding::encode(&state);

    // --- Build GitHub Authorization URL ---
    let auth_url = format!(
        "https://github.com/login/oauth/authorize?client_id={}&redirect_uri={}&scope={}&state={}",
        github_client_id,     // Use the validated, non-empty client_id
        encoded_redirect_uri, // Use encoded redirect URI
        encoded_scope,        // Use encoded scope
        state.clone()         // Use the original state string
    );

    // --- !!! PRINT THE FINAL URL FOR DEBUGGING !!! ---
    println!("Auth: Generated Auth URL to open: {}", auth_url);


    // --- Spawn the Task to Wait for Callback/Deep Link and Handle Flow ---
    let task_app_handle = app.clone();
    let task_pending_auth_state = pending_auth_state.inner().clone();
    let task_state = state.clone(); // Clone state for the task

    tokio::spawn(async move { // This is the "Authentication Processing Task"
        println!("Auth Task [{}]: Spawned. Waiting for callback/deep link...", task_state);

        // --- Wait for callback/deep link or timeout ---
        let code_result = match tokio::time::timeout(
            std::time::Duration::from_secs(CSRF_STATE_EXPIRY_SECS),
            code_rx, // Wait on the receiver end of the oneshot channel
        )
        .await
        {
            Ok(Ok(code_res)) => { // Received from channel successfully
                println!("Auth Task [{}]: Code received via channel.", task_state);
                code_res // This is Result<String, AuthError>
            },
            Ok(Err(_rx_err)) => { // Channel sender was dropped
                eprintln!("Auth Task [{}]: Callback/Deep Link sender dropped (state likely removed).", task_state);
                Err(AuthError::Cancelled) // Indicate cancellation/interruption
            }
            Err(_timeout_err) => { // Timeout waiting for channel
                 let removed = task_pending_auth_state.lock().unwrap().remove(&task_state).is_some();
                 if removed {
                    println!("Auth Task [{}]: Timed out waiting for code. State removed.", task_state);
                 } else {
                    println!("Auth Task [{}]: Timed out, but state was already removed.", task_state);
                 }
                Err(AuthError::CallbackTimeout)
            }
        };

         // --- Process Result (Exchange code, Get Profile, Sync, Emit events) ---
        let final_result: Result<(), AuthError> = async {
            let code = code_result?; // Propagate error
            println!("Auth Task [{}]: Exchanging code for token...", task_state);
            let token_info = exchange_code_for_token(&code).await?;
            println!("Auth Task [{}]: Fetching GitHub profile...", task_state);
            let profile = fetch_github_user_profile(&token_info.access_token).await?;
            println!("Auth Task [{}]: Profile fetched for '{}'", task_state, profile.login);
            println!("Auth Task [{}]: Syncing profile to backend...", task_state);
            sync_user_profile_to_backend(&profile).await?;
            println!("Auth Task [{}]: Authentication successful. Emitting event.", task_state);
            task_app_handle.emit("github_auth_success", Some(serde_json::json!({ "profile": profile }))); // Use ? to propagate emit error
            Ok(())
        }.await;

        // --- Handle Final Result (Error Emission, State Removal) ---
        if let Err(final_err) = final_result {
            eprintln!("Auth Task [{}]: Authentication flow failed: {:?}", task_state, final_err);
             match final_err {
                 AuthError::CallbackTimeout | AuthError::InvalidState | AuthError::DeepLinkError(_) | AuthError::Cancelled => (), // State handled elsewhere or N/A
                 _ => { // Remove state on other errors
                    if task_pending_auth_state.lock().unwrap().remove(&task_state).is_some() {
                       println!("Auth Task [{}]: State removed due to error: {:?}", task_state, final_err);
                    }
                 }
             }
            let _ = task_app_handle.emit("github_auth_error", Some(final_err));
        }

        // --- Conditional: Shutdown Dev Server ---
        #[cfg(debug_assertions)]
        {
            if let Some(task_server_state) = task_app_handle.try_state::<AuthServerState>() {
                println!("Auth Task [{}]: Requesting dev server shutdown...", task_state);
                shutdown_dev_server(task_server_state.inner().clone()).await;
            } else {
                 eprintln!("Auth Task [{}]: Could not get AuthServerState to shut down server.", task_state);
            }
        }
        println!("Auth Task [{}]: Finished.", task_state);
    }); // End of tokio::spawn

    // --- Return the Auth URL immediately ---
    println!("Auth: Returning auth URL to frontend.");
    Ok(auth_url) // Return the URL for the frontend to open
}

// --- === DEV SERVER SPECIFIC CODE (Only compiled in debug) === ---

#[cfg(debug_assertions)]
async fn start_dev_server<R: Runtime>(
    app_handle: AppHandle<R>,
    pending_state_clone: PendingAuthState, // Arc<StdMutex<...>>
    server_state_clone: AuthServerState,   // Arc<TokioMutex<...>>
) -> Result<(), AuthError> {
    let mut server_handle_guard = server_state_clone.lock().await; // Lock the server state

    if server_handle_guard.join_handle.is_some() {
         println!("Auth [Debug]: Server already running.");
         return Ok(());
    }

    let addr_str = get_redirect_uri();
     let addr = match addr_str.parse::<http::Uri>() {
        Ok(uri) => {
            let host = uri.host().unwrap_or("127.0.0.1");
            let port = uri.port_u16().unwrap_or(54321);
            let ip = match host.parse::<std::net::IpAddr>() {
                 Ok(ip_addr) => ip_addr,
                 Err(_) => if host == "localhost" { [127, 0, 0, 1].into() } else {
                     eprintln!("Auth [Debug]: Failed to parse host '{}', defaulting to 127.0.0.1", host);
                     [127, 0, 0, 1].into()
                 }
             };
            SocketAddr::new(ip, port)
        },
        Err(_) => {
            eprintln!("Auth [Debug]: Failed to parse redirect URI '{}', defaulting to 127.0.0.1:54321", addr_str);
            SocketAddr::from(([127, 0, 0, 1], 54321))
        },
     };

     println!("Auth [Debug]: Attempting to bind server to {}", addr);
     let listener = match tokio::net::TcpListener::bind(addr).await {
         Ok(l) => l,
         Err(e) => {
             let err_msg = format!("Failed to bind to {}: {}", addr, e);
             eprintln!("Auth [Debug]: {}", err_msg);
             let _ = app_handle.emit("github_auth_error", Some(AuthError::ServerStartError(err_msg.clone())));
             return Err(AuthError::ServerStartError(err_msg));
         }
     };

     let (internal_shutdown_tx, internal_shutdown_rx) = oneshot::channel::<()>();

     let app_router = Router::new()
         .route("/callback", get(github_callback_handler))
         .with_state(pending_state_clone); // Share pending state

     let server_config = axum::serve(listener, app_router.into_make_service())
         .with_graceful_shutdown(async {
             internal_shutdown_rx.await.ok();
             println!("Auth [Debug]: Callback server received shutdown signal.");
         });

     println!("Auth [Debug]: Callback server listening on {}", addr);

     let task_server_state_clone = server_state_clone.clone();
     let server_task = tokio::spawn(async move {
         if let Err(e) = server_config.await { eprintln!("Auth [Debug]: Server error: {}", e); }
         else { println!("Auth [Debug]: Server task finished gracefully."); }
         let mut guard = task_server_state_clone.lock().await;
         guard.shutdown_tx = None; guard.join_handle = None; // Clear state
         println!("Auth [Debug]: Server handle state cleared.");
     });

     server_handle_guard.shutdown_tx = Some(internal_shutdown_tx);
     server_handle_guard.join_handle = Some(server_task);
     println!("Auth [Debug]: Server started, shutdown sender and join handle stored.");

     Ok(())
 }

#[cfg(debug_assertions)]
async fn shutdown_dev_server(server_state: AuthServerState) {
    let server_task_join_handle: Option<tokio::task::JoinHandle<()>>;
    {
        let mut guard = server_state.lock().await;
        if let Some(tx) = guard.shutdown_tx.take() {
            println!("Auth [Debug]: Sending shutdown signal to server...");
             let _ = tx.send(());
             server_task_join_handle = guard.join_handle.take();
             println!("Auth [Debug]: Shutdown signal sent.");
        } else {
            println!("Auth [Debug]: Server already shut down or handle missing.");
            return;
        }
    }

    if let Some(handle) = server_task_join_handle {
        println!("Auth [Debug]: Waiting for server task to finish...");
        match tokio::time::timeout(std::time::Duration::from_secs(5), handle).await {
            Ok(Ok(_)) => println!("Auth [Debug]: Server task joined successfully."),
            Ok(Err(e)) => eprintln!("Auth [Debug]: Server task panicked or finished with error: {}", e),
            Err(_) => eprintln!("Auth [Debug]: Timed out waiting for server task to finish."),
       }
    } else {
         println!("Auth [Debug]: No server task handle found to join.");
    }
}

// Axum Callback Handler (Only compiled in debug builds)
#[cfg(debug_assertions)]
async fn github_callback_handler(
    Query(params): Query<CallbackParams>,
    AxumState(pending_state): AxumState<PendingAuthState>,
) -> Html<String> {
    println!("Auth [Debug] Callback: Received. State: {}, Code: [hidden]", params.state);

     let sender = pending_state.lock().unwrap().remove(&params.state);

     match sender {
         Some(tx) => {
             println!("Auth [Debug] Callback: State matched. Sending code via channel.");
             let send_result = tx.send(Ok(params.code));
             if send_result.is_err() {
                 eprintln!("Auth [Debug] Callback: Receiver dropped (Task likely timed out/errored). State: {}", params.state);
                 return Html( "<html><body><h1>Auth Error</h1><p>App no longer waiting. Timeout/cancelled? Close & retry.</p></body></html>".to_string() );
             }
             Html( "<html><body><h1>Auth Success</h1><p>You can close this window.</p><script>window.close();</script></body></html>".to_string() )
         }
         None => {
             eprintln!("Auth [Debug] Callback: Invalid or expired state received: {}", params.state);
             Html( "<html><body><h1>Auth Failed</h1><p>Invalid/expired state. Close & retry.</p></body></html>".to_string() )
         }
     }
}

// --- === CORE API INTERACTION LOGIC (Uses embedded config via accessors, with logging) === ---

// Exchanges the authorization code for an access token
async fn exchange_code_for_token(code: &str) -> Result<GithubTokenResponse, AuthError> {
    let client = reqwest::Client::new();
    let redirect_uri = get_redirect_uri();
    // Use accessors to get compile-time embedded values
    let github_client_id = get_github_client_id();
    let github_client_secret = get_github_client_secret();

     // Log parameters being used for the request
     println!("Auth: Exchanging code. Using Client ID: '{}'", github_client_id);
     let secret_len = github_client_secret.len();
     let masked_secret = if secret_len > 4 { format!("***{}", &github_client_secret[secret_len-4..]) } else { "***".to_string() };
     println!("Auth: Exchanging code. Using Client Secret: '{}'", masked_secret);
     println!("Auth: Exchanging code. Using Redirect URI: '{}'", redirect_uri);
     println!("Auth: Exchanging code. Using Code: [hidden]"); // Don't log the code itself

    let params = [
        ("client_id", github_client_id),
        ("client_secret", github_client_secret),
        ("code", code),
        ("redirect_uri", redirect_uri),
    ];

    let response = client
        .post("https://github.com/login/oauth/access_token")
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "Tauri GitHub Auth (Rust)")
        .form(&params)
        .send()
        .await?;

    if response.status().is_success() {
        let token_response = response.json::<GithubTokenResponse>().await
            .map_err(|e| AuthError::ParseError(format!("Failed to parse token response: {}", e)))?;
        if token_response.access_token.is_empty() {
             eprintln!("Auth: Token exchange successful but received empty access token.");
             Err(AuthError::GitHubError("Received empty access token from GitHub".to_string()))
        } else {
            println!("Auth: Token exchanged successfully.");
            Ok(token_response)
        }
    } else {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_else(|_| "Failed to read error body".to_string());
        eprintln!("Auth: GitHub token exchange error ({}): {}", status, error_text);
        Err(AuthError::GitHubError(format!(
            "Failed to exchange code (status {}): {}",
            status, error_text
        )))
    }
}

// Fetches the user's profile from the GitHub API using the access token
async fn fetch_github_user_profile(access_token: &str) -> Result<GithubUserProfile, AuthError> {
    let client = reqwest::Client::new();
    println!("Auth: Fetching GitHub profile using token: Bearer ***"); // Don't log token

    let response = client
        .get("https://api.github.com/user")
        .header(AUTHORIZATION, format!("Bearer {}", access_token)) // Use Bearer token auth
        .header(USER_AGENT, "Tauri GitHub Auth (Rust)")
        .send()
        .await?;

     if response.status().is_success() {
        let profile = response.json::<GithubUserProfile>().await
            .map_err(|e| AuthError::ParseError(format!("Failed to parse GitHub user profile: {}", e)))?;
        println!("Auth: User profile fetched successfully for {}.", profile.login);
        Ok(profile)
     } else {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_else(|_| "Failed to read error body".to_string());
        eprintln!("Auth: GitHub profile fetch error ({}): {}", status, error_text);
        Err(AuthError::GitHubError(format!(
            "Failed to fetch user profile (status {}): {}",
             status, error_text
        )))
    }
}

// Sends the fetched GitHub profile to your backend worker/API
async fn sync_user_profile_to_backend(profile: &GithubUserProfile) -> Result<(), AuthError> {
    println!("Auth: Attempting backend sync for user ID: {}", profile.id);
    let client = reqwest::Client::new();
    let payload = BackendSyncPayload { profile };

    // Use accessors to get compile-time embedded values for backend API
    let worker_api_url = get_worker_api_url();
    let worker_api_key = get_worker_api_key();

     println!("Auth: Syncing to backend URL: {}", worker_api_url);
     let key_len = worker_api_key.len();
     let masked_key = if key_len > 4 { format!("***{}", &worker_api_key[key_len-4..]) } else { "***".to_string() };
     println!("Auth: Syncing with backend API Key: {}", masked_key);


    let response = client
        .post(worker_api_url)
        .header(AUTHORIZATION, format!("Bearer {}", worker_api_key))
        .header(CONTENT_TYPE, "application/json")
        .header(USER_AGENT, "Tauri Backend Sync (Rust)")
        .json(&payload)
        .send()
        .await?;

    let status = response.status();
    println!("Auth: Backend sync response status: {}", status);

    if status.is_success() {
        match response.json::<BackendSyncResponse>().await {
            Ok(sync_response) => {
                if sync_response.success {
                    println!("Auth: Backend sync reported success.");
                    Ok(())
                } else {
                    let err_msg = format!("Backend reported sync failure: {}", sync_response.message.unwrap_or_default());
                    eprintln!("Auth: {}", err_msg);
                    Err(AuthError::BackendSyncFailed(err_msg))
                }
            }
            Err(e) => {
                 let err_msg = format!("Failed to parse successful backend sync response: {}", e);
                 eprintln!("Auth: {}", err_msg);
                 Err(AuthError::ParseError(err_msg)) // Treat parse error as backend failure
            }
        }
    } else {
        let error_text = response.text().await.unwrap_or_else(|_| format!("HTTP error {}", status));
        let err_msg = format!("Backend API returned error (status {}): {}", status, error_text);
        eprintln!("Auth: {}", err_msg);
        Err(AuthError::BackendSyncFailed(err_msg))
    }
}