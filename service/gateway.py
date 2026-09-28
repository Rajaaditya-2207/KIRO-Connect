"""
KIRO-Connect — Swarm Gateway & Orchestration API Server
Implements the external OpenAI-compatible API, 6-digit pairing handshake,
Mixture-of-Agents fan-out, live host metrics, and ChromaDB correction memory.
"""

import os
import sys
import random
import string
import logging
import asyncio
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, Header, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from service.llama_manager import LlamaServerManager
from service.discovery import SwarmHostBroadcaster, SwarmWorkerBrowser, get_local_ip
from service.orchestrator import MoAOrchestrator, SwarmNode
from service.memory import CorrectionMemory
from service.worker_agent import WorkerAgent

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("kiro.gateway")

app = FastAPI(
    title="KIRO-Connect Swarm Gateway",
    description="LAN Mixture-of-Agents LLM Inference Swarm Gateway & Orchestrator",
    version="1.0.0"
)

# Enable CORS for Tauri desktop webview and external LAN clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Core singletons
llama_manager = LlamaServerManager()
worker_agent = WorkerAgent()
orchestrator = MoAOrchestrator()
memory = CorrectionMemory()
broadcaster: Optional[SwarmHostBroadcaster] = None
worker_browser: Optional[SwarmWorkerBrowser] = None

# Swarm Security State
HOST_API_KEY = "kc-swarm-" + "".join(random.choices(string.ascii_lowercase + string.digits, k=16))
current_pairing_code: str = str(random.randint(100000, 999999))
authenticated_worker_tokens: Dict[str, str] = {}  # worker_id -> session_token
gateway_port: int = 8000
host_display_name: str = f"Host-{get_local_ip().replace('.', '-')}"


# ============================================================================
# Pydantic Schemas
# ============================================================================

class ChatMessage(BaseModel):
    role: str
    content: str


class ChatCompletionRequest(BaseModel):
    model: Optional[str] = "kiro-connect-moa"
    messages: List[ChatMessage]
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = 1024
    stream: Optional[bool] = False


class PairingRequest(BaseModel):
    pairing_code: str
    worker_id: str
    node_name: str
    worker_endpoint: str
    api_key: Optional[str] = ""
    model: str
    hardware: Optional[str] = "CPU/GPU"


class HeartbeatRequest(BaseModel):
    worker_id: str
    tokens_generated: Optional[int] = 0
    current_status: Optional[str] = "idle"


class StartLlamaRequest(BaseModel):
    model_path: str
    ctx_size: Optional[int] = 4096
    port: Optional[int] = 8081
    api_key: Optional[str] = "kiro-internal-key"
    n_gpu_layers: Optional[int] = 99


class CorrectionRequest(BaseModel):
    query: str
    wrong_answer: str
    correct_answer: str


class ScanFolderRequest(BaseModel):
    folder_path: str


class StartWorkerEngineRequest(BaseModel):
    model_path: str
    ctx_size: Optional[int] = 4096
    port: Optional[int] = 8082
    n_gpu_layers: Optional[int] = 99


class JoinSwarmRequest(BaseModel):
    host_endpoint: str
    pairing_code: str
    hardware: Optional[str] = "Worker CPU/GPU"


# ============================================================================
# Security Dependency
# ============================================================================

def verify_external_api_key(authorization: Optional[str] = Header(None)):
    """Validates external client OpenAI API key against the host's issued key."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header. Use Bearer <API_KEY>")
    token = authorization.replace("Bearer ", "").strip()
    if token != HOST_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API Key for KIRO-Connect Swarm Gateway")
    return token


# ============================================================================
# OpenAI-Compatible External API (PRD Section 5.4a)
# ============================================================================

@app.get("/v1/models")
async def list_models(auth: str = Depends(verify_external_api_key)):
    """External OpenAI endpoint returning the unified swarm model."""
    return {
        "object": "list",
        "data": [
            {
                "id": "kiro-connect-moa",
                "object": "model",
                "created": 1700000000,
                "owned_by": "kiro-connect-swarm",
                "permission": [],
                "root": "kiro-connect-moa",
                "parent": None
            }
        ]
    }


@app.post("/v1/chat/completions")
async def chat_completions(req: ChatCompletionRequest, auth: str = Depends(verify_external_api_key)):
    """
    Unified OpenAI-compatible Gateway endpoint.
    Fans out to LAN-only llama.cpp worker instances, aggregates MoA-style,
    and returns an OpenAI-standard response with non-breaking metadata.
    """
    messages_dicts = [{"role": m.role, "content": m.content} for m in req.messages]

    # Check Correction Memory for past mistakes on similar prompts
    latest_user_prompt = ""
    for m in reversed(req.messages):
        if m.role == "user":
            latest_user_prompt = m.content
            break

    correction_context = None
    if latest_user_prompt:
        matches = memory.query_similar_corrections(latest_user_prompt, n_results=1)
        if matches:
            top_match = matches[0]
            correction_context = (
                f"Previous Similar Query: {top_match['matched_query']}\n"
                f"Previous Incorrect Answer: {top_match['wrong_answer']}\n"
                f"Correction: {top_match['correct_answer']}"
            )
            logger.info(f"Injecting correction memory for query: '{latest_user_prompt[:40]}...'")

    try:
        response = await orchestrator.execute_moa_pipeline(
            messages=messages_dicts,
            correction_context=correction_context,
            temperature=req.temperature or 0.7,
            max_tokens=req.max_tokens or 1024
        )
        return response
    except Exception as e:
        logger.error(f"MoA pipeline execution failed: {e}")
        raise HTTPException(status_code=500, detail=f"Swarm orchestration error: {str(e)}")


# ============================================================================
# Swarm Authentication & Pairing (6-Digit Code)
# ============================================================================

@app.post("/api/swarm/pair")
async def pair_worker(req: PairingRequest):
    """
    Worker authentication endpoint.
    Worker presents the 6-digit code displayed on the Host dashboard.
    """
    global current_pairing_code
    if req.pairing_code.strip() != current_pairing_code:
        logger.warning(f"Failed pairing attempt from {req.node_name} (code: {req.pairing_code})")
        raise HTTPException(status_code=403, detail="Invalid 6-digit pairing code")

    # Issue session token
    session_token = "sess-" + "".join(random.choices(string.ascii_letters + string.digits, k=24))
    authenticated_worker_tokens[req.worker_id] = session_token

    # Register worker node in the orchestrator pool
    node = SwarmNode(
        id=req.worker_id,
        name=req.node_name,
        endpoint=req.worker_endpoint,
        api_key=req.api_key or "",
        model=req.model,
        hardware=req.hardware or "Worker",
        is_host_local=False
    )
    orchestrator.register_node(node)

    logger.info(f"Worker '{req.node_name}' successfully paired and joined the swarm!")
    return {
        "success": True,
        "message": f"Successfully paired with swarm host",
        "session_token": session_token,
        "host_name": host_display_name
    }


@app.post("/api/swarm/heartbeat")
async def worker_heartbeat(req: HeartbeatRequest):
    """Periodic worker heartbeat to report health."""
    node = orchestrator.nodes.get(req.worker_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not registered")
    return {"status": "ok", "divergence_count": node.divergence_count}


# ============================================================================
# Host Swarm Management & Monitoring APIs
# ============================================================================

@app.get("/api/swarm/status")
async def swarm_status():
    """Returns overall swarm status, gateway endpoint, and pairing code."""
    local_ip = get_local_ip()
    return {
        "host_name": host_display_name,
        "local_ip": local_ip,
        "gateway_port": gateway_port,
        "gateway_endpoint": f"http://{local_ip}:{gateway_port}/v1",
        "host_api_key": HOST_API_KEY,
        "pairing_code": current_pairing_code,
        "total_nodes": len(orchestrator.nodes),
        "healthy_nodes": len(orchestrator.get_healthy_nodes()),
        "total_requests": orchestrator.total_gateway_requests,
        "total_tokens": orchestrator.total_gateway_tokens,
        "is_broadcasting": broadcaster.is_broadcasting if broadcaster else False
    }


@app.post("/api/swarm/refresh-pairing-code")
async def refresh_pairing_code():
    """Generates a fresh 6-digit pairing code."""
    global current_pairing_code
    current_pairing_code = str(random.randint(100000, 999999))
    logger.info(f"New pairing code generated: {current_pairing_code}")
    return {"pairing_code": current_pairing_code}


@app.get("/api/swarm/nodes")
async def list_swarm_nodes():
    """Returns detailed list of all connected nodes with live throughput and health."""
    node_list = []
    for node in orchestrator.nodes.values():
        node_list.append({
            "id": node.id,
            "name": node.name,
            "endpoint": node.endpoint,
            "model": node.model,
            "hardware": node.hardware,
            "status": node.status,
            "divergence_count": node.divergence_count,
            "total_prompts": node.total_prompts,
            "total_tokens": node.total_tokens,
            "last_latency_ms": node.last_latency_ms,
            "tokens_per_sec": node.last_tokens_per_sec,
            "avg_tokens_per_sec": node.avg_tokens_per_sec,
            "is_host_local": node.is_host_local
        })
    return {"nodes": node_list}


@app.post("/api/swarm/benchmark")
async def run_benchmark():
    """
    Executes a standard benchmark prompt across all nodes to measure relative latency
    and tokens/second throughput.
    """
    active_nodes = orchestrator.get_healthy_nodes()
    if not active_nodes:
        return {"success": False, "error": "No active nodes to benchmark"}

    test_messages = [
        {"role": "user", "content": "Explain in two sentences how Mixture-of-Agents LLM swarms work."}
    ]

    tasks = [
        orchestrator._query_single_node(node, test_messages, temperature=0.1, max_tokens=100)
        for node in active_nodes
    ]
    results = await asyncio.gather(*tasks)

    benchmark_data = []
    for r in results:
        if r:
            benchmark_data.append({
                "node_name": r["node_name"],
                "latency_ms": r["latency_ms"],
                "tokens_per_sec": r["tokens_per_sec"],
                "tokens": r["tokens"]
            })

    return {"success": True, "results": benchmark_data}


@app.post("/api/swarm/nodes/{node_id}/reset-flag")
async def reset_node_flag(node_id: str):
    """Restores a flagged or divergent node back to active status in the swarm."""
    success = orchestrator.reset_node_flag(node_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found in active swarm registry")
    return {"success": True, "message": f"Node '{node_id}' has been unflagged and restored to active inference pool"}


# ============================================================================
# Local llama.cpp Process Controls (Host & Worker)
# ============================================================================

@app.get("/api/host/local-models")
async def get_local_models():
    """Discovers available GGUF models on disk."""
    models = LlamaServerManager.discover_local_models()
    return {"models": models}


@app.post("/api/host/scan-folder")
async def scan_custom_folder(req: ScanFolderRequest):
    """Scans any custom folder provided by the user for GGUF model files."""
    models = LlamaServerManager.scan_custom_directory(req.folder_path)
    return {"models": models, "scanned_path": req.folder_path, "count": len(models)}


@app.post("/api/host/start-llama")
async def start_host_llama(req: StartLlamaRequest):
    """Starts local llama-server instance for the host and awaits readiness."""
    res = llama_manager.start(
        model_path=req.model_path,
        ctx_size=req.ctx_size or 4096,
        port=req.port or 8081,
        host="127.0.0.1",
        api_key=req.api_key or "kiro-host-internal",
        n_gpu_layers=req.n_gpu_layers or 99,
        alias="host-local-model"
    )
    if not res.get("success"):
        return res

    # Wait until llama-server is ready and accepting requests
    is_ready = await llama_manager.wait_until_ready(timeout_secs=45.0)
    if not is_ready:
        logs = llama_manager.get_last_logs(20)
        llama_manager.stop()
        return {
            "success": False,
            "error": f"Host llama-server failed to initialize within 45s. Recent logs:\n{logs}"
        }

    # Automatically register host's local model into orchestrator pool
    model_name = os.path.basename(req.model_path)
    host_node = SwarmNode(
        id="host-local",
        name=f"{host_display_name} (Host)",
        endpoint=f"http://127.0.0.1:{req.port or 8081}",
        api_key=req.api_key or "kiro-host-internal",
        model="host-local-model",
        hardware="Host GPU/CPU",
        is_host_local=True
    )
    orchestrator.register_node(host_node)

    return {
        "success": True,
        "pid": res.get("pid"),
        "port": req.port or 8081,
        "endpoint": f"http://127.0.0.1:{req.port or 8081}",
        "message": "Host engine started and ready for MoA inference"
    }


@app.post("/api/host/stop-llama")
async def stop_host_llama():
    """Stops the host's local llama-server instance."""
    orchestrator.unregister_node("host-local")
    return llama_manager.stop()


@app.get("/api/host/llama-status")
async def host_llama_status():
    """Returns operational status of host llama-server."""
    return llama_manager.get_status()


# ============================================================================
# Worker Mode Discovery & Joining
# ============================================================================

@app.get("/api/worker/discovered-hosts")
async def get_discovered_hosts():
    """Returns hosts found on LAN via mDNS."""
    global worker_browser
    if not worker_browser:
        worker_browser = SwarmWorkerBrowser()
        worker_browser.start()
    return {"hosts": worker_browser.get_hosts()}


@app.post("/api/worker/start-engine")
async def start_worker_engine(req: StartWorkerEngineRequest):
    """Launches local llama-server for worker node bound to 0.0.0.0 (accessible over LAN)."""
    res = worker_agent.start_local_llama(
        model_path=req.model_path,
        ctx_size=req.ctx_size or 4096,
        port=req.port or 8082,
        n_gpu_layers=req.n_gpu_layers or 99
    )
    if not res.get("success"):
        return res

    is_ready = await worker_agent.llama_manager.wait_until_ready(timeout_secs=45.0)
    if not is_ready:
        logs = worker_agent.llama_manager.get_last_logs(20)
        worker_agent.stop_local_llama()
        return {
            "success": False,
            "error": f"Worker llama-server failed to initialize within 45s. Recent logs:\n{logs}"
        }

    local_ip = get_local_ip()
    return {
        "success": True,
        "pid": res.get("pid"),
        "port": req.port or 8082,
        "endpoint": f"http://{local_ip}:{req.port or 8082}",
        "message": f"Worker engine is running on LAN at http://{local_ip}:{req.port or 8082}"
    }


@app.post("/api/worker/stop-engine")
async def stop_worker_engine():
    """Stops worker local llama-server."""
    return worker_agent.stop_local_llama()


@app.post("/api/worker/join-swarm")
async def worker_join_swarm(req: JoinSwarmRequest):
    """Authenticates worker node with host over LAN using 6-digit code and starts heartbeat."""
    res = await worker_agent.pair_with_host(
        host_endpoint=req.host_endpoint,
        pairing_code=req.pairing_code,
        hardware_info=req.hardware or "Worker CPU/GPU"
    )
    if res.get("success"):
        worker_agent.start_heartbeat()
    return res


@app.get("/api/worker/status")
async def get_worker_status():
    """Returns worker status including LAN IP and engine state."""
    st = worker_agent.get_status()
    local_ip = get_local_ip()
    st["local_ip"] = local_ip
    st["worker_endpoint"] = f"http://{local_ip}:{worker_agent.port}"
    return st


# ============================================================================
# Correction Memory APIs (ChromaDB)
# ============================================================================

@app.post("/api/memory/correct")
async def add_correction(req: CorrectionRequest):
    """Records a new (query, wrong_answer, correct_answer) triple in ChromaDB."""
    success = memory.store_correction(req.query, req.wrong_answer, req.correct_answer)
    return {"success": success}


@app.get("/api/memory/list")
async def list_corrections():
    """Returns all stored correction memories."""
    items = memory.get_all_corrections()
    return {"corrections": items}


# ============================================================================
# Startup & Shutdown Events
# ============================================================================

@app.on_event("startup")
async def on_startup():
    global broadcaster
    broadcaster = SwarmHostBroadcaster(host_display_name, gateway_port)
    broadcaster.start()
    logger.info(f"KIRO-Connect Swarm Gateway started on port {gateway_port}")
    logger.info(f"Issued Host API Key: {HOST_API_KEY}")
    logger.info(f"Current 6-Digit Pairing Code: {current_pairing_code}")


@app.on_event("shutdown")
async def on_shutdown():
    if broadcaster:
        broadcaster.stop()
    if worker_browser:
        worker_browser.stop()
    if llama_manager.is_running():
        llama_manager.stop()
    if worker_agent.llama_manager.is_running():
        worker_agent.stop_local_llama()
    logger.info("KIRO-Connect Swarm Gateway shut down cleanly.")


# ============================================================================
# Frontend Static Files Mount (React Desktop Build)
# ============================================================================
from fastapi.staticfiles import StaticFiles

dist_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist")
if os.path.exists(dist_dir):
    app.mount("/", StaticFiles(directory=dist_dir, html=True), name="frontend")
    logger.info(f"Mounted frontend static files from {dist_dir}")
