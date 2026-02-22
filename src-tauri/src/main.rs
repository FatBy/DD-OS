// DD-OS Tauri Application
// 主入口：管理 Python 后端 Sidecar 进程

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

// 存储后端进程句柄
struct ServerState {
    child: Mutex<Option<CommandChild>>,
}

// 启动后端服务器
fn start_backend(app: &AppHandle) -> Result<CommandChild, String> {
    let shell = app.shell();
    
    // 获取用户数据目录
    let data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    
    // 确保数据目录存在
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data dir: {}", e))?;
    
    let data_path = data_dir.to_string_lossy().to_string();
    
    println!("[DD-OS] Starting backend server...");
    println!("[DD-OS] Data directory: {}", data_path);
    
    // 启动 Sidecar 进程
    let (mut rx, child) = shell
        .sidecar("ddos-server")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?
        .args(["--path", &data_path, "--port", "3001"])
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;
    
    // 异步读取输出
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    println!("[Backend] {}", line_str);
                }
                CommandEvent::Stderr(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    eprintln!("[Backend Error] {}", line_str);
                }
                CommandEvent::Error(err) => {
                    eprintln!("[Backend] Process error: {}", err);
                }
                CommandEvent::Terminated(payload) => {
                    println!("[Backend] Process terminated with code: {:?}", payload.code);
                    break;
                }
                _ => {}
            }
        }
    });
    
    println!("[DD-OS] Backend server started on http://localhost:3001");
    Ok(child)
}

// 停止后端服务器
fn stop_backend(state: &ServerState) {
    let mut child_guard = state.child.lock().unwrap();
    if let Some(child) = child_guard.take() {
        println!("[DD-OS] Stopping backend server...");
        let _ = child.kill();
        println!("[DD-OS] Backend server stopped");
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // 启动后端服务器
            match start_backend(&app.handle()) {
                Ok(child) => {
                    app.manage(ServerState {
                        child: Mutex::new(Some(child)),
                    });
                    println!("[DD-OS] Application started successfully");
                }
                Err(e) => {
                    eprintln!("[DD-OS] Failed to start backend: {}", e);
                    // 继续运行，用户可以手动启动后端
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // 窗口关闭时停止后端
                if let Some(state) = window.try_state::<ServerState>() {
                    stop_backend(&state);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
