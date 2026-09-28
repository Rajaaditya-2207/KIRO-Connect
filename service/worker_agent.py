"""
KIRO-Connect — Worker Node Agent
Handles Worker mode lifecycle:
1. Launches local llama.cpp server with Q4 KV cache and selected model.
2. Browses LAN for Host via mDNS.
3. Submits 6-digit pairing code to authenticate.
4. Maintains periodic heartbeat with the swarm host.
"""

import os
import sys
import time
import socket
import logging
import asyncio
from typing import Dict, Any, List, Optional
import httpx

from service.llama_manager import LlamaServerManager
from service.discovery import SwarmWorkerBrowser, get_local_ip

logger = logging.getLogger("kiro.worker_agent")


class WorkerAgent:
    def __init__(self, node_name: Optional[str] = None):
        self.node_name = node_name or f"Worker-{socket.gethostname()}"
        self.worker_id = f"worker-{int(time.time())}"
        self.llama_manager = LlamaServerManager()
        self.browser = SwarmWorkerBrowser()
        self.host_endpoint: Optional[str] = None
        self.session_token: Optional[str] = None
        self.is_connected = False
        self.heartbeat_task: Optional[asyncio.Task] = None
        self.port: int = 8082
        self.api_key: str = "kiro-worker-internal"
        self.current_model: str = ""

    def start_local_llama(
        self,
        model_path: str,
        ctx_size: int = 4096,
        port: int = 8082,
        n_gpu_layers: int = 99
    ) -> Dict[str, Any]:
        """Launches the worker's own local llama.cpp instance."""
        self.port = port
        self.current_model = os.path.basename(model_path)
        return self.llama_manager.start(
            model_path=model_path,
            ctx_size=ctx_size,
            port=port,
            host="0.0.0.0",  # Accessible to Host on the same LAN
            api_key=self.api_key,
            n_gpu_layers=n_gpu_layers,
            alias=self.current_model
        )

    def stop_local_llama(self) -> Dict[str, Any]:
        return self.llama_manager.stop()

    def discover_hosts(self) -> List[Dict[str, Any]]:
        self.browser.start()
        return self.browser.get_hosts()

    async def pair_with_host(
        self,
        host_endpoint: str,
        pairing_code: str,
        hardware_info: str = "Worker CPU/GPU"
    ) -> Dict[str, Any]:
        """
        Sends the 6-digit pairing code to the Host's /api/swarm/pair endpoint.
        """
        local_ip = get_local_ip()
        my_worker_endpoint = f"http://{local_ip}:{self.port}"

        url = f"{host_endpoint.rstrip('/')}/api/swarm/pair"
        payload = {
            "pairing_code": pairing_code.strip(),
            "worker_id": self.worker_id,
            "node_name": self.node_name,
            "worker_endpoint": my_worker_endpoint,
            "api_key": self.api_key,
            "model": self.current_model or "llama-model",
            "hardware": hardware_info
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, json=payload)
                if resp.status_code == 200:
                    data = resp.json()
                    self.session_token = data.get("session_token")
                    self.host_endpoint = host_endpoint
                    self.is_connected = True
                    logger.info(f"Successfully paired with Host at {host_endpoint}")
                    return {"success": True, "data": data}
                else:
                    detail = resp.json().get("detail", resp.text)
                    return {"success": False, "error": f"Pairing failed: {detail}"}
        except Exception as e:
            logger.error(f"Error during pairing: {e}")
            return {"success": False, "error": str(e)}

    async def _heartbeat_loop(self):
        while self.is_connected and self.host_endpoint:
            try:
                url = f"{self.host_endpoint.rstrip('/')}/api/swarm/heartbeat"
                headers = {}
                if self.session_token:
                    headers["Authorization"] = f"Bearer {self.session_token}"
                async with httpx.AsyncClient(timeout=5.0) as client:
                    await client.post(url, json={"worker_id": self.worker_id}, headers=headers)
            except Exception as e:
                logger.debug(f"Heartbeat tick warning: {e}")
            await asyncio.sleep(10.0)

    def start_heartbeat(self):
        if not self.heartbeat_task or self.heartbeat_task.done():
            self.heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    def get_status(self) -> Dict[str, Any]:
        return {
            "node_name": self.node_name,
            "worker_id": self.worker_id,
            "is_connected": self.is_connected,
            "host_endpoint": self.host_endpoint,
            "llama_status": self.llama_manager.get_status()
        }
