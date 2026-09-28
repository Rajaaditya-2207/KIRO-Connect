# KIRO-Connect Remediation & Fix Plan

## Goal
Fix all identified defects in KIRO-Connect across process startup (`sys.path`), LAN worker networking (IP routing & lifecycle), engine readiness synchronization, consensus outlier detection, and desktop process cleanup so that the Mixture-of-Agents swarm runs seamlessly end-to-end on Windows LAN.

---

## Root Causes & Identified Issues Addressed
1. **ModuleNotFoundError on launch:** `service/run_server.py` and `launch.ps1` run without project root in `sys.path`.
2. **Worker 127.0.0.1 LAN routing flaw:** `App.tsx` sends `127.0.0.1` as worker endpoint, so Host queries its own loopback instead of the worker laptop.
3. **Worker engine disconnect:** Worker Mode UI has no button/API to start `llama-server.exe` on the worker machine.
4. **Asynchronous engine start race:** `start_host_llama` returns success before weights load, causing immediate playground queries to throw 500 errors.
5. **Host binding loopback only:** `host="127.0.0.1"` prevents external nodes from communicating with worker instances.
6. **Consensus outlier math flaw:** `overall_semantic >= 0.50` fails when a single bad node drags down the mean, so outliers never get flagged.
7. **Permanent node banishment:** Flagged nodes cannot recover; no UI or API exists to reset flags.
8. **`asyncio_sleep` scope bug:** Defined at file bottom in `llama_manager.py`.
9. **Hardcoded API base URL:** Hardcoded `http://127.0.0.1:8000` prevents remote browser access to dashboard.
10. **Orphan process leaks:** Stale `llama-server.exe` processes occupy ports 8081/8082 after terminal exits.

---

## Actionable Tasks

### Phase 1: Python Environment & Launchers (`launch.ps1`, `service/run_server.py`, `service/llama_manager.py`)
- [x] **Task 1.1:** Add project root auto-resolution in `service/run_server.py` (`sys.path.insert(0, ...)`) and set `$env:PYTHONPATH = $PSScriptRoot` in `launch.ps1`.
  - *Verified:* `python service/run_server.py --port 8000` launches without `ModuleNotFoundError: No module named 'service'`.
- [x] **Task 1.2:** Clean up `service/llama_manager.py` imports: move `import asyncio` to top, replace `asyncio_sleep` with standard `await asyncio.sleep(0.5)`, and add pre-launch check to kill stale `llama-server.exe` processes holding ports 8081/8082.
  - *Verified:* `llama_manager.py` imports cleanly with zero linter errors.

### Phase 2: Engine Readiness & Process Synchronization (`service/gateway.py`, `service/llama_manager.py`)
- [x] **Task 2.1:** Update `start_host_llama` in `service/gateway.py` to await `llama_manager.wait_until_ready(timeout_secs=45)`. Only register `host-local` in `orchestrator` once the `/health` endpoint reports `ready`/`ok`.
  - *Verified:* `POST /api/host/start-llama` blocks until engine is truly accepting completions; returns error log extract if process exits prematurely.
- [x] **Task 2.2:** Allow configurable bind host (`0.0.0.0` for workers, `127.0.0.1` for host) and ensure `llama-status` reports actual process health.
  - *Verified:* `GET /api/host/llama-status` reflects accurate state if process terminates unexpectedly.

### Phase 3: Swarm LAN Networking & Worker Lifecycle (`service/gateway.py`, `src/App.tsx`)
- [x] **Task 3.1:** Implement Worker Node APIs in `service/gateway.py`:
  - `POST /api/worker/start-engine`: Launches worker `llama-server.exe` on specified port bound to `0.0.0.0`.
  - `POST /api/worker/stop-engine`: Stops worker local inference engine.
  - `POST /api/worker/join-swarm`: Auto-detects worker's LAN IP via `get_local_ip()`, pairs with Host, and starts background heartbeat.
  - `GET /api/worker/status`: Returns current worker engine status, connection status, and assigned host.
  - *Verified:* Worker node can start its own engine and pair with host using its real LAN IP (`http://192.168.x.x:8082`).
- [x] **Task 3.2:** Update `src/App.tsx` Worker Mode:
  - Add "Launch Worker Engine" and "Stop Worker Engine" controls with port and GGUF model selector.
  - Replace hardcoded `127.0.0.1` with worker's detected LAN IP in pairing payload.
  - Add mDNS discovered hosts dropdown list with 1-click select.
  - Dynamic `API_BASE`: `window.location.origin` (when in browser/WebView) with fallback to `http://127.0.0.1:8000`.
  - *Verified:* Worker UI displays engine status, discovered hosts, and pairs successfully without manual endpoint guessing.

### Phase 4: MoA Consensus Math & Node Recovery (`service/orchestrator.py`, `service/gateway.py`, `src/App.tsx`)
- [x] **Task 4.1:** Fix consensus and divergence detection in `service/orchestrator.py`:
  - Compute peer consensus excluding the candidate node itself. If the remaining peer group exhibits agreement $\ge 0.50$ while candidate agreement is $< 0.45$, increment divergence count.
  - *Verified:* In a 3-node swarm where 2 nodes agree (sim = 0.85) and 1 diverges (sim = 0.1), the outlier is correctly flagged without lowering overall consensus.
- [x] **Task 4.2:** Add unflag / reset mechanism:
  - Add `POST /api/swarm/nodes/{node_id}/reset-flag` in `service/gateway.py` and `orchestrator.reset_node_flag(node_id)`.
  - Add "Unflag / Re-admit" action button in `src/App.tsx` on the Swarm Fleet table for flagged nodes.
  - *Verified:* Flagged node can be reset and immediately rejoins the active inference pool.

### Phase 5: Verification & End-to-End Testing
- [x] **Task 5.1:** Rebuild frontend via `npm run build`.
- [x] **Task 5.2:** Run integration tests (`scratch/test_integration.py` and MoA pipeline test) validating:
  - Gateway status and pairing.
  - Host engine launch and readiness check.
  - MoA query completion returning OpenAI-compliant schema with `kiro_confidence` and `contributing_nodes`.
  - Divergence detection and unflagging.

---

## Done When
- [x] Gateway server boots without `ModuleNotFoundError` from `launch.ps1`, `launch.py`, or direct CLI.
- [x] Host engine reliably boots and verifies `/health` before allowing playground queries.
- [x] Workers launch their local `llama-server.exe` on `0.0.0.0` and register their real LAN IP with the Host.
- [x] Outlier nodes that diverge are accurately flagged, and the host user can unflag them from the UI.
- [x] `npm run build` succeeds and desktop app opens cleanly.
