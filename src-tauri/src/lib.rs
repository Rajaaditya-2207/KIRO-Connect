use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[allow(dead_code)]
struct BackendProcess(Mutex<Option<Child>>);

fn is_port_open(port: u16) -> bool {
    if let Ok(addr) = format!("127.0.0.1:{}", port).parse() {
        TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
    } else {
        false
    }
}

fn try_launch_backend() -> Option<Child> {
    if is_port_open(8000) {
        println!("KIRO-Connect Swarm Gateway is already listening on port 8000.");
        return None;
    }

    let possible_paths = [
        (PathBuf::from(r".venv\Scripts\python.exe"), PathBuf::from(r"service\run_server.py")),
        (PathBuf::from(r"..\.venv\Scripts\python.exe"), PathBuf::from(r"..\service\run_server.py")),
        (PathBuf::from(r"python.exe"), PathBuf::from(r"service\run_server.py")),
    ];

    for (py, script) in &possible_paths {
        if py.exists() || py.to_str() == Some("python.exe") {
            let mut cmd = Command::new(py);
            cmd.args([script.to_str().unwrap_or("service/run_server.py"), "--port", "8000"]);
            #[cfg(target_os = "windows")]
            cmd.creation_flags(CREATE_NO_WINDOW);

            if let Ok(child) = cmd.spawn() {
                println!("Spawned Swarm Gateway via {:?} with script {:?}", py, script);
                return Some(child);
            }
        }
    }

    println!("Notice: Swarm Gateway python environment not directly auto-spawned; will connect to active gateway.");
    None
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let child_proc = try_launch_backend();

    tauri::Builder::default()
        .manage(BackendProcess(Mutex::new(child_proc)))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<BackendProcess>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(mut child) = guard.take() {
                            println!("Terminating backend child process on window close...");
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
