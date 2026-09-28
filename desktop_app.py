"""
KIRO-Connect — Desktop Application Window
Launches the private Swarm Gateway and displays the always-dark
Mixture-of-Agents desktop UI in a dedicated WebView2 desktop window.
"""

import os
import sys
import time
import socket
import threading
import logging
import uvicorn
import webview

from service.gateway import app, llama_manager, broadcaster

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("kiro.desktop")


def run_gateway_server():
    """Runs the FastAPI gateway and MoA orchestrator on port 8000."""
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning")


def wait_for_server(port: int = 8000, timeout: float = 10.0):
    """Waits until the local gateway server binds and accepts TCP connections."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.1)
    return False


def on_closed():
    """Clean teardown when user closes desktop app window."""
    logger.info("Closing KIRO-Connect desktop window...")
    if llama_manager.is_running():
        llama_manager.stop()
    if broadcaster and broadcaster.is_broadcasting:
        broadcaster.stop()
    logger.info("Shutdown complete.")
    os._exit(0)


def main():
    print("=" * 60)
    print("  KIRO-Connect: LAN Mixture-of-Agents Inference Swarm")
    print("=" * 60)

    # 1. Start gateway server in daemon thread
    server_thread = threading.Thread(target=run_gateway_server, daemon=True)
    server_thread.start()

    # 2. Wait for server readiness
    print("Starting background Swarm Gateway on http://127.0.0.1:8000 ...")
    if not wait_for_server(8000):
        print("Warning: Gateway server took longer than expected to bind.")

    # 3. Create native desktop window
    print("Opening KIRO-Connect desktop window...")
    window = webview.create_window(
        title="KIRO-Connect — LAN Mixture-of-Agents Swarm",
        url="http://127.0.0.1:8000/",
        width=1320,
        height=860,
        min_size=(1000, 680),
        background_color="#08080c",
        text_select=True,
    )
    window.events.closed += on_closed

    # 4. Start GUI event loop
    webview.start(debug=False)


if __name__ == "__main__":
    main()
