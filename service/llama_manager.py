"""
KIRO-Connect — Local llama.cpp Process Manager
Manages real lifecycle of llama-server.exe instances (Host and Worker mode)
with exact Q4 KV cache flags, context sizing, and health monitoring.
"""

import os
import sys
import time
import shutil
import logging
import asyncio
import socket
import subprocess
from pathlib import Path
from typing import Optional, Dict, Any, List
import httpx

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("kiro.llama_manager")


class LlamaServerManager:
    def __init__(self, binary_path: Optional[str] = None):
        self.binary_path = binary_path or self.find_llama_server()
        self.process: Optional[subprocess.Popen] = None
        self.current_config: Dict[str, Any] = {}
        self.start_time: Optional[float] = None
        self.port: int = 8081
        self.host: str = "127.0.0.1"
        self.api_key: str = ""
        self.model_path: str = ""

    @staticmethod
    def find_llama_server() -> Optional[str]:
        """Locates the llama-server executable on PATH or known directories."""
        # 1. Check PATH
        path_bin = shutil.which("llama-server")
        if path_bin and os.path.exists(path_bin):
            return path_bin

        # 2. Check Windows WinGet standard installation folder
        local_app_data = os.environ.get("LOCALAPPDATA", "")
        if local_app_data:
            winget_dir = Path(local_app_data) / "Microsoft" / "WinGet" / "Packages"
            if winget_dir.exists():
                matches = list(winget_dir.glob("*llama*/**/llama-server.exe"))
                if matches:
                    return str(matches[0])

        return None

    @staticmethod
    @staticmethod
    def scan_custom_directory(custom_dir: str, max_depth: int = 4, max_results: int = 100) -> List[Dict[str, Any]]:
        """Scans a custom user-provided directory path for GGUF model files with safety bounds."""
        candidates = []
        p = Path(custom_dir.strip().strip('"').strip("'"))
        if not p.exists() or not p.is_dir():
            return []

        seen_paths = set()
        base_depth = len(p.parts)
        try:
            for root, dirs, files in os.walk(p, topdown=True):
                current_depth = len(Path(root).parts) - base_depth
                if current_depth >= max_depth:
                    dirs.clear()
                    continue
                # Skip system and bulky non-model directories
                dirs[:] = [d for d in dirs if not d.startswith(".") and d.lower() not in (
                    "windows", "$recycle.bin", "system volume information", "node_modules", ".venv", "appdata"
                )]
                for file in files:
                    if file.lower().endswith(".gguf") and "mmproj" not in file.lower():
                        full_path = os.path.join(root, file)
                        try:
                            resolved = str(Path(full_path).resolve())
                            if resolved not in seen_paths:
                                seen_paths.add(resolved)
                                size_gb = round(os.path.getsize(full_path) / (1024 ** 3), 2)
                                candidates.append({
                                    "name": file,
                                    "path": resolved,
                                    "size_gb": size_gb,
                                    "parent_folder": os.path.basename(root)
                                })
                                if len(candidates) >= max_results:
                                    break
                        except Exception:
                            continue
                if len(candidates) >= max_results:
                    break
        except Exception as e:
            logger.error(f"Error scanning custom folder '{custom_dir}': {e}")

        return sorted(candidates, key=lambda x: x["name"])

    @staticmethod
    def discover_local_models(custom_dirs: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """Scans well-known local paths and any custom paths for real GGUF model files."""
        candidates = []
        user_home = Path.home()
        search_dirs = [
            user_home / ".cache" / "huggingface" / "hub",
            user_home / "Downloads",
            user_home / "models",
            user_home / "AppData" / "Local" / "nomic.ai" / "GPT4All",
            Path("C:/models"),
            Path("D:/models"),
        ]
        if custom_dirs:
            for cd in custom_dirs:
                if cd and os.path.exists(cd):
                    search_dirs.append(Path(cd))

        seen_paths = set()
        for base_dir in search_dirs:
            if base_dir.exists():
                try:
                    for gguf_file in base_dir.rglob("*.gguf"):
                        # Skip mmproj projection files
                        if "mmproj" in gguf_file.name.lower():
                            continue
                        resolved = str(gguf_file.resolve())
                        if resolved not in seen_paths:
                            seen_paths.add(resolved)
                            size_gb = round(gguf_file.stat().st_size / (1024 ** 3), 2)
                            candidates.append({
                                "name": gguf_file.name,
                                "path": resolved,
                                "size_gb": size_gb,
                                "parent_folder": gguf_file.parent.name
                            })
                except Exception as e:
                    logger.debug(f"Error scanning {base_dir}: {e}")

        return sorted(candidates, key=lambda x: x["name"])

    def is_running(self) -> bool:
        """Returns True if the llama-server subprocess is alive."""
        if self.process is None:
            return False
        return self.process.poll() is None

    async def wait_until_ready(self, timeout_secs: float = 45.0) -> bool:
        """Polls the /health endpoint until the llama-server reports ready."""
        check_host = "127.0.0.1" if self.host in ("0.0.0.0", "", "::") else self.host
        url = f"http://{check_host}:{self.port}/health"
        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        start = time.time()
        async with httpx.AsyncClient(timeout=3.0) as client:
            while time.time() - start < timeout_secs:
                if not self.is_running():
                    logger.error("llama-server process exited prematurely.")
                    return False
                try:
                    resp = await client.get(url, headers=headers)
                    if resp.status_code == 200:
                        data = resp.json()
                        # llama.cpp server returns status 'ok' when fully loaded
                        if data.get("status") in ("ok", "ready") or "slots_idle" in data:
                            logger.info(f"llama-server is READY on {url}")
                            return True
                except Exception:
                    pass
                await asyncio.sleep(0.5)

        logger.warning(f"llama-server did not become ready within {timeout_secs}s")
        return False

    def start(
        self,
        model_path: str,
        ctx_size: int = 4096,
        port: int = 8081,
        host: str = "127.0.0.1",
        api_key: str = "kiro-local-internal",
        n_gpu_layers: int = 99,
        alias: str = "kiro-node-model"
    ) -> Dict[str, Any]:
        """
        Launches the llama.cpp server process with exact Q4 KV cache quantization flags:
        -ctk q4_0 -ctv q4_0
        """
        if self.is_running():
            return {
                "success": False,
                "error": f"llama-server is already running (PID {self.process.pid} on port {self.port})"
            }

        if not self.binary_path or not os.path.exists(self.binary_path):
            return {
                "success": False,
                "error": f"llama-server binary not found at '{self.binary_path}'. Please install llama.cpp or add to PATH."
            }

        if not os.path.exists(model_path):
            return {
                "success": False,
                "error": f"Model file not found at '{model_path}'"
            }

        self.host = host
        self.port = port
        self.api_key = api_key
        self.model_path = model_path

        # PRD Section 5.2 requirement:
        # KV cache quantization fixed to Q4 (--cache-type-k q4_0 --cache-type-v q4_0 or -ctk q4_0 -ctv q4_0)
        cmd = [
            self.binary_path,
            "-m", model_path,
            "-c", str(ctx_size),
            "-ctk", "q4_0",
            "-ctv", "q4_0",
            "--host", host,
            "--port", str(port),
            "--alias", alias,
            "-ngl", str(n_gpu_layers),
        ]
        if api_key:
            cmd.extend(["--api-key", api_key])

        logger.info(f"Starting llama-server: {' '.join(cmd)}")

        try:
            local_app_data = os.environ.get("LOCALAPPDATA")
            if local_app_data:
                logs_dir = os.path.join(local_app_data, "KIRO-Connect", "logs")
            else:
                logs_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "logs")
            os.makedirs(logs_dir, exist_ok=True)
            self.log_file_path = os.path.join(logs_dir, f"llama_server_{port}.log")
            self.log_file_handle = open(self.log_file_path, "a", encoding="utf-8")
            self.process = subprocess.Popen(
                cmd,
                stdout=self.log_file_handle,
                stderr=subprocess.STDOUT,
                text=True
            )
            self.start_time = time.time()
            self.current_config = {
                "model_path": model_path,
                "ctx_size": ctx_size,
                "port": port,
                "host": host,
                "api_key": api_key,
                "n_gpu_layers": n_gpu_layers,
                "alias": alias,
                "pid": self.process.pid
            }
            reported_host = "127.0.0.1" if host in ("0.0.0.0", "", "::") else host
            return {
                "success": True,
                "pid": self.process.pid,
                "port": port,
                "host": host,
                "endpoint": f"http://{reported_host}:{port}"
            }
        except Exception as e:
            logger.error(f"Failed to spawn llama-server: {e}")
            return {"success": False, "error": str(e)}

    def stop(self) -> Dict[str, Any]:
        """Stops the running llama-server process."""
        if not self.is_running():
            return {"success": True, "message": "Server was not running"}

        pid = self.process.pid
        try:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
            logger.info(f"llama-server (PID {pid}) stopped successfully.")
            self.process = None
            self.start_time = None
            if hasattr(self, "log_file_handle") and self.log_file_handle and not self.log_file_handle.closed:
                try:
                    self.log_file_handle.close()
                except Exception:
                    pass
            return {"success": True, "message": f"Stopped PID {pid}"}
        except Exception as e:
            logger.error(f"Error stopping llama-server: {e}")
            return {"success": False, "error": str(e)}

    def get_status(self) -> Dict[str, Any]:
        """Returns current operational status and hardware metrics."""
        running = self.is_running()
        reported_host = "127.0.0.1" if self.host in ("0.0.0.0", "", "::") else self.host
        return {
            "running": running,
            "pid": self.process.pid if running else None,
            "port": self.port if running else None,
            "host": self.host if running else None,
            "endpoint": f"http://{reported_host}:{self.port}" if running else None,
            "model_path": self.model_path if running else None,
            "uptime_seconds": round(time.time() - self.start_time, 1) if (running and self.start_time) else 0,
            "config": self.current_config if running else None,
            "binary_path": self.binary_path
        }

    def get_last_logs(self, n_lines: int = 25) -> str:
        """Returns the last n_lines from the server log file."""
        if hasattr(self, "log_file_path") and os.path.exists(self.log_file_path):
            try:
                with open(self.log_file_path, "r", encoding="utf-8", errors="replace") as f:
                    lines = f.readlines()
                    return "".join(lines[-n_lines:])
            except Exception as e:
                return f"Could not read log file: {e}"
        return ""

    @staticmethod
    def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
        """Checks if a TCP port is currently open and accepting connections."""
        target_host = "127.0.0.1" if host in ("0.0.0.0", "", "::") else host
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            return s.connect_ex((target_host, port)) == 0

