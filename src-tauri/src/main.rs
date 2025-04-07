// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod auth; // 确保 auth 模块被声明
use dotenvy::dotenv;
use auth::{login_with_github, AuthServerState, PendingAuthState, ServerHandle}; // 引入命令和状态类型
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::Mutex as TokioMutex;

fn main() {
    dotenv().ok();
    let pending_auth_state: PendingAuthState = Arc::new(Mutex::new(HashMap::new()));
    let auth_server_state: AuthServerState = Arc::new(TokioMutex::new(ServerHandle { shutdown_tx: None }));

    tauri::Builder::default()
        // ---> 添加插件初始化 <---
        .plugin(tauri_plugin_opener::init())
        // 也可以链式添加其他需要的插件，比如 os
        // .plugin(tauri_plugin_os::init()) // 如果 lib.rs 不再是入口，os 插件也需在此初始化
        .manage(pending_auth_state)
        .manage(auth_server_state)
        .invoke_handler(tauri::generate_handler![
            login_with_github, // 直接使用引入的函数名
            // auth::greet, // 如果 greet 命令也需要的话
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}