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

    let current_exe = std::env::current_exe().ok();
    let exe_dir = current_exe.as_ref().and_then(|p| p.parent().map(|p| p.to_path_buf()));

    // 1. Check for bundled standalone backend executable (kiro-backend.exe)
    if let Some(ref dir) = exe_dir {
        let sidecar_candidates = [
            dir.join("kiro-backend.exe"),
            dir.join("resources").join("kiro-backend.exe"),
            dir.join("..").join("kiro-backend.exe"),
            dir.join("..").join("release").join("kiro-backend.exe"),
        ];
        for sidecar in &sidecar_candidates {
            if sidecar.exists() {
                println!("Found standalone backend binary at {:?}", sidecar);
                let mut cmd = Command::new(sidecar);
                cmd.args(["--port", "8000"]);
                if let Some(parent) = sidecar.parent() {
                    cmd.current_dir(parent);
                }
                #[cfg(target_os = "windows")]
                cmd.creation_flags(CREATE_NO_WINDOW);
                if let Ok(child) = cmd.spawn() {
                    println!("Spawned standalone backend sidecar.");
                    return Some(child);
                }
            }
        }
    }

    // 2. Discover project root and virtual environment
    let mut search_roots: Vec<PathBuf> = Vec::new();
    if let Some(ref dir) = exe_dir {
        search_roots.push(dir.clone());
        if let Some(p1) = dir.parent() {
            search_roots.push(p1.to_path_buf());
            if let Some(p2) = p1.parent() {
                search_roots.push(p2.to_path_buf());
                if let Some(p3) = p2.parent() {
                    search_roots.push(p3.to_path_buf());
                }
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        search_roots.push(cwd);
    }
    search_roots.push(PathBuf::from(r"C:\Users\rajaa\Desktop\Kiro-Connect"));

    for root in search_roots {
        let py_venv = root.join(".venv").join("Scripts").join("python.exe");
        let script = root.join("service").join("run_server.py");

        if py_venv.exists() && script.exists() {
            println!("Found virtual environment at {:?} with script {:?}", py_venv, script);
            let mut cmd = Command::new(&py_venv);
            cmd.args([script.to_str().unwrap_or("service/run_server.py"), "--port", "8000"]);
            cmd.current_dir(&root);
            cmd.env("PYTHONPATH", &root);
            #[cfg(target_os = "windows")]
            cmd.creation_flags(CREATE_NO_WINDOW);

            if let Ok(child) = cmd.spawn() {
                println!("Successfully spawned Swarm Gateway from root {:?}", root);
                return Some(child);
            }
        }
    }

    // 3. Fallback: check system python.exe with relative service/run_server.py
    let mut cmd = Command::new("python.exe");
    cmd.args(["service/run_server.py", "--port", "8000"]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    if let Ok(child) = cmd.spawn() {
        println!("Spawned Swarm Gateway via system python.exe");
        return Some(child);
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
    if child_proc.is_some() {
        for _ in 0..30 {
            if is_port_open(8000) {
                println!("Gateway port 8000 verified active!");
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

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
