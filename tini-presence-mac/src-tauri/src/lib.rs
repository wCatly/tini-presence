use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, PhysicalPosition,
};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackStatus {
    playing: bool,
    reason: Option<String>,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    cover_url: Option<String>,
    source: Option<String>,
    position_ms: Option<f64>,
    duration_ms: Option<f64>,
    track_id: Option<String>,
    file_path: Option<String>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    music_folders: Vec<String>,
    discord_client_id: Option<String>,
    copyparty_api_key: Option<String>,
    copyparty_url: Option<String>,
    copyparty_path: Option<String>,
    theme: Option<String>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct ProtocolMessage {
    r#type: String,
    payload: serde_json::Value,
}

struct AppState {
    sidecar: Option<CommandChild>,
    is_running: bool,
    last_status: Option<TrackStatus>,
    last_config: Option<AppConfig>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            sidecar: None,
            is_running: false,
            last_status: None,
            last_config: None,
        }
    }
}

/// Kill any orphaned sidecar processes from previous app instances
fn kill_orphaned_sidecars() {
    // Use pkill to kill any existing tini-presence-core processes
    let _ = std::process::Command::new("pkill")
        .args(["-f", "tini-presence-core"])
        .output();
    
    // Small delay to ensure process is fully terminated
    std::thread::sleep(std::time::Duration::from_millis(100));
}

fn start_sidecar(app: &tauri::AppHandle, state: &Arc<Mutex<AppState>>) {
    let mut state_guard = state.lock().unwrap();
    if state_guard.is_running {
        return;
    }

    // Kill any orphaned sidecar processes before starting a new one
    kill_orphaned_sidecars();

    match app.shell().sidecar("tini-presence-core") {
        Ok(cmd) => match cmd.spawn() {
            Ok((mut rx, child)) => {
                let app_handle = app.clone();
                let state_for_events = state.clone();
                let state_for_request = state.clone();

                let _ = app.emit("sidecar-log", "Sidecar started".to_string());

                tauri::async_runtime::spawn(async move {
                    let mut buffer = String::new();
                    while let Some(event) = rx.recv().await {
                        match event {
                            tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                                if let Ok(text) = String::from_utf8(line) {
                                    buffer.push_str(&text);

                                    while let Some(pos) = buffer.find('\n') {
                                        let line = buffer[..pos].trim_end();
                                        if let Ok(message) =
                                            serde_json::from_str::<ProtocolMessage>(line)
                                        {
                                            match message.r#type.as_str() {
                                                "status" => {
                                                    let payload = message.payload.clone();
                                                    if let Ok(parsed) =
                                                        serde_json::from_value::<TrackStatus>(
                                                            payload,
                                                        )
                                                    {
                                                        {
                                                            let mut guard =
                                                                state_for_events.lock().unwrap();
                                                            guard.last_status =
                                                                Some(parsed.clone());
                                                        }
                                                        let _ =
                                                            app_handle.emit("track-status", parsed);
                                                    } else {
                                                        let _ = app_handle.emit(
                                                            "sidecar-log",
                                                            format!(
                                                            "Failed to decode status payload: {}",
                                                            message.payload
                                                        ),
                                                        );
                                                    }
                                                }
                                                "config" => {
                                                    if let Ok(parsed) =
                                                        serde_json::from_value::<AppConfig>(
                                                            message.payload,
                                                        )
                                                    {
                                                        {
                                                            let mut guard =
                                                                state_for_events.lock().unwrap();
                                                            guard.last_config =
                                                                Some(parsed.clone());
                                                        }
                                                        let _ = app_handle
                                                            .emit("config-updated", parsed);
                                                    } else {
                                                        let _ = app_handle.emit(
                                                            "sidecar-log",
                                                            "Failed to decode config payload"
                                                                .to_string(),
                                                        );
                                                    }
                                                }
                                                _ => {
                                                    let _ = app_handle.emit(
                                                        "sidecar-log",
                                                        format!("Unknown message: {}", line),
                                                    );
                                                }
                                            }
                                        } else if !line.is_empty() {
                                            let _ =
                                                app_handle.emit("sidecar-log", line.to_string());
                                        }
                                        buffer.drain(..=pos);
                                    }
                                }
                            }
                            tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                                if let Ok(text) = String::from_utf8(line) {
                                    let line = text.trim();
                                    if !line.is_empty() {
                                        let _ = app_handle.emit("sidecar-log", line.to_string());
                                    }
                                }
                            }
                            tauri_plugin_shell::process::CommandEvent::Terminated(payload) => {
                                let _ = app_handle.emit(
                                    "sidecar-log",
                                    format!("Sidecar terminated: code={:?}", payload.code),
                                );
                            }
                            tauri_plugin_shell::process::CommandEvent::Error(err) => {
                                let _ = app_handle.emit("sidecar-log", err);
                            }
                            _ => {}
                        }
                    }
                });

                state_guard.sidecar = Some(child);
                state_guard.is_running = true;
                let _ = app.emit("service-status", true);
                println!("Started tini-presence sidecar");
                drop(state_guard);
                if send_command(&state_for_request, "get-config", None).is_err() {
                    let _ = app.emit("sidecar-log", "Failed to request config".to_string());
                }
            }
            Err(e) => {
                let _ = app.emit("sidecar-log", format!("Failed to spawn sidecar: {}", e));
                eprintln!("Failed to spawn sidecar: {}", e)
            }
        },
        Err(e) => {
            let _ = app.emit(
                "sidecar-log",
                format!("Failed to create sidecar command: {}", e),
            );
            eprintln!("Failed to create sidecar command: {}", e)
        }
    }
}

fn stop_sidecar(app: &tauri::AppHandle, state: &Arc<Mutex<AppState>>) {
    let mut state_guard = state.lock().unwrap();
    if let Some(child) = state_guard.sidecar.take() {
        let _ = child.kill();
        state_guard.is_running = false;
        state_guard.last_status = None;
        state_guard.last_config = None;
        let _ = app.emit("service-status", false);
        let _ = app.emit::<Option<TrackStatus>>("track-status", None);
        let _ = app.emit::<Option<AppConfig>>("config-updated", None);
        println!("Stopped tini-presence sidecar");
    }
}

#[tauri::command]
fn toggle_service(app: tauri::AppHandle, state: tauri::State<'_, Arc<Mutex<AppState>>>) -> bool {
    let is_running = state.lock().unwrap().is_running;
    if is_running {
        stop_sidecar(&app, &state);
        false
    } else {
        start_sidecar(&app, &state);
        true
    }
}

#[tauri::command]
fn get_service_status(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> bool {
    state.lock().unwrap().is_running
}

#[tauri::command]
fn get_track_status(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> Option<TrackStatus> {
    state.lock().unwrap().last_status.clone()
}

#[tauri::command]
fn get_config(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> Option<AppConfig> {
    state.lock().unwrap().last_config.clone()
}

#[tauri::command]
fn request_config(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> bool {
    send_command(&state, "get-config", None).is_ok()
}

#[tauri::command]
fn update_config(state: tauri::State<'_, Arc<Mutex<AppState>>>, config: AppConfig) -> bool {
    let payload = serde_json::to_value(config).ok();
    send_command(&state, "update-config", payload).is_ok()
}

#[tauri::command]
fn add_folder(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> bool {
    send_command(&state, "add-folder", None).is_ok()
}

#[tauri::command]
fn open_config(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> bool {
    send_command(&state, "open-config", None).is_ok()
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle, state: tauri::State<'_, Arc<Mutex<AppState>>>) {
    stop_sidecar(&app, &state);
    app.exit(0);
    // Fallback force exit
    std::process::exit(0);
}

const MENU_BAR_MAX_Y: f64 = 120.0;

fn toggle_popover(app: &tauri::AppHandle, position: PhysicalPosition<f64>) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            // Ignore stray clicks not near the menu bar
            if position.y > MENU_BAR_MAX_Y {
                return;
            }

            // Position window below tray icon
            let window_width = 320.0;
            let x = position.x - (window_width / 2.0);
            let y = position.y + 6.0;
            let _ = window.set_position(PhysicalPosition::new(x, y));
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn send_command(
    state: &Arc<Mutex<AppState>>,
    command: &str,
    payload: Option<serde_json::Value>,
) -> Result<(), String> {
    let mut guard = state.lock().unwrap();
    let child = guard
        .sidecar
        .as_mut()
        .ok_or_else(|| "Sidecar not running".to_string())?;

    let message = serde_json::json!({
        "type": "command",
        "command": command,
        "payload": payload,
    });

    child
        .write(format!("{}\n", message).as_bytes())
        .map_err(|err| err.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = Arc::new(Mutex::new(AppState::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .manage(state.clone())
        .setup(move |app| {
            // Hide dock icon (menu bar only)
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let state_for_menu = state.clone();
            let app_handle = app.handle().clone();
            let app_for_tray = app.handle().clone();

            // Create right-click menu
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;

            // Build tray icon
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false) // Left click shows popover
                .on_tray_icon_event(move |_tray, event| {
                    if let TrayIconEvent::Click {
                        button,
                        button_state,
                        position,
                        ..
                    } = event
                    {
                        if button == tauri::tray::MouseButton::Left
                            && button_state == tauri::tray::MouseButtonState::Up
                        {
                            toggle_popover(&app_for_tray, position);
                        }
                    }
                })
                .on_menu_event(move |app, event| {
                    if event.id.as_ref() == "quit" {
                        stop_sidecar(app, &state_for_menu);
                        app.exit(0);
                    }
                })
                .build(app)?;

            // Hide popover when it loses focus
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let _ = window_clone.hide();
                    }
                });
            }

            // Auto-start sidecar
            start_sidecar(&app_handle, &state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            toggle_service,
            get_service_status,
            get_track_status,
            get_config,
            request_config,
            update_config,
            add_folder,
            open_config,
            quit_app
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Handle app exit events to ensure sidecar is stopped
            match event {
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                    if let Some(state) = app.try_state::<Arc<Mutex<AppState>>>() {
                        let mut guard = state.lock().unwrap();
                        if let Some(child) = guard.sidecar.take() {
                            let _ = child.kill();
                            guard.is_running = false;
                            println!("Sidecar killed on app exit");
                        }
                    }
                }
                _ => {}
            }
        });
}
