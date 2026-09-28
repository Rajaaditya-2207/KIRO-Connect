import sys
import os
from pathlib import Path
from fastapi.testclient import TestClient

# Ensure root dir on sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from service.gateway import app, orchestrator
from service.orchestrator import SwarmNode

client = TestClient(app)

print("=" * 60)
print("  KIRO-Connect: Comprehensive Integration Verification Suite")
print("=" * 60)

# 1. Swarm Status & Pairing
print("\n--- 1. Testing Swarm Status & Gateway ---")
r = client.get("/api/swarm/status")
assert r.status_code == 200, f"Expected 200, got {r.status_code}"
status = r.json()
print("[PASS] Host Name:", status.get("host_name"))
print("[PASS] Pairing Code:", status.get("pairing_code"))
print("[PASS] Gateway Endpoint:", status.get("gateway_endpoint"))
pairing_code = status.get("pairing_code")
host_api_key = status.get("host_api_key")

# 2. Model Discovery & Custom Folder Scan
print("\n--- 2. Testing Model Discovery & Scanner ---")
r = client.get("/api/host/local-models")
assert r.status_code == 200
models = r.json().get("models", [])
print(f"[PASS] Discovered {len(models)} default local models.")

r = client.post("/api/host/scan-folder", json={"folder_path": "C:/Users/rajaa/.cache/huggingface/hub"})
assert r.status_code == 200
custom_models = r.json().get("models", [])
print(f"[PASS] Custom folder scan discovered {len(custom_models)} models.")

# 3. ChromaDB Correction Memory
print("\n--- 3. Testing ChromaDB Correction Memory ---")
r = client.post("/api/memory/correct", json={
    "query": "What is the capital of Australia?",
    "wrong_answer": "Sydney",
    "correct_answer": "Canberra"
})
assert r.status_code == 200 and r.json().get("success") is True
print("[PASS] Recorded correction triple into ChromaDB.")

r = client.get("/api/memory/list")
corrections = r.json().get("corrections", [])
assert len(corrections) > 0
print(f"[PASS] Stored corrections retrieved count: {len(corrections)}")

# 4. Worker Lifecycle & LAN Status
print("\n--- 4. Testing Worker Node Endpoints ---")
r = client.get("/api/worker/status")
assert r.status_code == 200
w_status = r.json()
print("[PASS] Worker Node Local IP:", w_status.get("local_ip"))
print("[PASS] Worker Endpoint:", w_status.get("worker_endpoint"))
print("[PASS] Worker Running:", w_status.get("llama_status", {}).get("running"))

r = client.get("/api/worker/discovered-hosts")
assert r.status_code == 200
print("[PASS] mDNS Discovered Hosts API returned successfully.")

# 5. Worker Pairing with Real LAN Credentials
print("\n--- 5. Testing Worker Authentication & Pairing ---")
r = client.post("/api/swarm/pair", json={
    "pairing_code": pairing_code,
    "worker_id": "test-worker-node-1",
    "node_name": "Laptop-Worker-Alpha",
    "worker_endpoint": f"http://{w_status.get('local_ip')}:8082",
    "api_key": "kiro-worker-internal",
    "model": "Qwen3.5-2B-UD-IQ2_M.gguf",
    "hardware": "Worker CPU"
})
assert r.status_code == 200, f"Pairing failed: {r.text}"
pair_res = r.json()
assert pair_res.get("success") is True
print("[PASS] Worker paired successfully! Session token issued:", pair_res.get("session_token"))

# Verify node is in fleet
r = client.get("/api/swarm/nodes")
nodes = r.json().get("nodes", [])
assert any(n["id"] == "test-worker-node-1" for n in nodes), "Worker not found in swarm fleet"
print("[PASS] Worker verified in active Swarm Fleet list.")

# 6. MoA Consensus & Outlier Divergence Detection
print("\n--- 6. Testing Consensus Math & Outlier Flagging ---")
# Setup 3 mock nodes: 2 agree, 1 severely diverges
node1 = SwarmNode(id="node-1", name="Node-1-Good", endpoint="http://127.0.0.1:9001", api_key="", model="m1")
node2 = SwarmNode(id="node-2", name="Node-2-Good", endpoint="http://127.0.0.1:9002", api_key="", model="m2")
node3 = SwarmNode(id="node-3", name="Node-3-Outlier", endpoint="http://127.0.0.1:9003", api_key="", model="m3")
orchestrator.register_node(node1)
orchestrator.register_node(node2)
orchestrator.register_node(node3)

candidate_outputs = [
    {"node_id": "node-1", "node_name": "Node-1-Good", "content": "The capital of Australia is Canberra.", "token_certainty": 0.95},
    {"node_id": "node-2", "node_name": "Node-2-Good", "content": "Canberra is the federal capital city of Australia.", "token_certainty": 0.92},
    {"node_id": "node-3", "node_name": "Node-3-Outlier", "content": "Kangaroos live in the desert and play tennis in Paris.", "token_certainty": 0.50}
]

# Run divergence checks 3 times to trigger flag limit
for step in range(3):
    conf, flagged, agreements = orchestrator._evaluate_consensus_and_flag(candidate_outputs)

assert node3.status == "flagged", f"Expected Node-3 to be flagged, got {node3.status}"
assert node1.status == "idle" and node2.status == "idle"
print(f"[PASS] Outlier node successfully identified and flagged! (Flags: {node3.divergence_count}/3, Status: {node3.status})")
print(f"[PASS] Consensus confidence computed: {round(conf * 100, 1)}%")

# 7. Unflag / Rehabilitation Endpoint
print("\n--- 7. Testing Node Rehabilitation / Unflag Endpoint ---")
r = client.post("/api/swarm/nodes/node-3/reset-flag")
assert r.status_code == 200, f"Unflag failed: {r.text}"
assert node3.status == "idle" and node3.divergence_count == 0
print("[PASS] Node-3 successfully unflagged and restored to active pool.")

# 8. OpenAI API Key Protection
print("\n--- 8. Testing OpenAI Gateway API Key Validation ---")
r = client.get("/v1/models")
assert r.status_code == 401, "Expected 401 Unauthorized without API key"
r = client.get("/v1/models", headers={"Authorization": f"Bearer {host_api_key}"})
assert r.status_code == 200, f"Expected 200 with API key, got {r.status_code}"
print("[PASS] OpenAI /v1/models endpoint successfully validated with Host API Key.")

# 9. Frontend Static Serving
print("\n--- 9. Testing Frontend Static Delivery ---")
r = client.get("/")
assert r.status_code == 200
assert "KIRO-Connect" in r.text
print("[PASS] React desktop application static assets served cleanly.")

print("\n" + "=" * 60)
print("  ALL 9 INTEGRATION & REMEDIATION TESTS PASSED WITH 100% SUCCESS!")
print("=" * 60)
