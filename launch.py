"""
KIRO-Connect — Swarm Launcher
Starts the isolated backend gateway service and launches the Tauri desktop application.
"""

import os
import sys
import subprocess
import time
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
VENV_PYTHON = ROOT_DIR / ".venv" / "Scripts" / "python.exe"

if not VENV_PYTHON.exists():
    print(f"Error: Virtual environment python not found at {VENV_PYTHON}")
    print("Please run: python -m venv .venv && .venv\\Scripts\\pip install -r requirements.txt")
    sys.exit(1)

def main():
    print("=" * 60)
    print("  KIRO-Connect: LAN Mixture-of-Agents Swarm")
    print("=" * 60)
    print("1. Launching Swarm Gateway service in background (port 8000)...")

    env = os.environ.copy()
    env["PYTHONPATH"] = str(ROOT_DIR)

    gateway_proc = subprocess.Popen(
        [str(VENV_PYTHON), "service/run_server.py", "--port", "8000"],
        cwd=str(ROOT_DIR),
        env=env
    )

    print("2. Gateway process active (PID:", gateway_proc.pid, ")")
    print("3. Launching Tauri desktop application...")
    time.sleep(1.5)

    try:
        subprocess.run(["npm.cmd", "run", "tauri", "dev"], cwd=str(ROOT_DIR))
    except KeyboardInterrupt:
        pass
    finally:
        print("\nShutting down KIRO-Connect Gateway...")
        gateway_proc.terminate()
        try:
            gateway_proc.wait(timeout=3)
        except Exception:
            gateway_proc.kill()
        print("KIRO-Connect stopped.")

if __name__ == "__main__":
    main()
