# KIRO-Connect Implementation Plan

## Goal
Build a Tauri / Native WebView2 desktop app (isolated `.venv` backend, always-dark purple K-C theme) turning LAN laptops into a private Mixture-of-Agents LLM inference swarm using local `llama.cpp` server instances, mDNS discovery, 6-digit pairing authentication, an OpenAI-compatible gateway with cross-node agreement + logprob confidence scoring, a live host dashboard, custom folder model scanner, and a local ChromaDB vector correction memory.

## Architectural Decisions (Confirmed & Implemented)
- **Backend Environment:** Fully isolated in `.venv` with `FastAPI`, `Uvicorn`, `Zeroconf`, `ChromaDB`, and `Httpx`.
- **Node Authentication:** 6-digit pairing code (host generates & displays on UI; worker inputs code to establish authenticated session).
- **Worker Node Requirement:** Mandatory local model (each worker launches its own local `llama.cpp` instance with Q4 KV cache).
- **Confidence Scoring:** Hybrid (Cross-node semantic similarity agreement + token logprobs from `llama.cpp`).
- **Custom Folder Loading:** Scan any directory path on disk for `.gguf` models via `POST /api/host/scan-folder` and 1-click select in UI.
- **Desktop UI:** High-end dark theme (`#08080c`, `#13131e`) with purple glow accents, tabbed navigation (Overview, Models & Engine, Swarm Fleet, MoA Playground, Correction Memory), and dedicated Worker Mode.
- **Target OS:** Windows first with cross-platform code paths.
- **Swarm Scale:** 3 to 5 laptop nodes.

---

## Tasks Status

- [x] **Phase 1: Project Scaffolding & Design System**
  - Scaffolded Tauri v2 / Vite React desktop app with always-dark theme and purple K-C monogram branding.
  - Implemented Host vs. Worker mode selection views and tabbed navigation.
  - *Verified:* `npm run build` succeeds cleanly in 327ms with zero errors.

- [x] **Phase 2: Local `llama.cpp` Process Manager (Host & Worker Mode)**
  - Implemented `service/llama_manager.py` detecting `llama-server.exe`, GGUF model discovery, context window size (`--ctx-size`), and exact Q4 KV cache quantization flags (`-ctk q4_0 -ctv q4_0`).
  - Added custom folder scanning (`scan_custom_directory`) for any directory path.
  - *Verified:* Tested on local machine with real GGUF models (`Qwen3.5-2B-UD-IQ2_M.gguf`, `gemma-4-E2B-it-qat-UD-Q2_K_XL.gguf`).

- [x] **Phase 3: LAN Discovery (mDNS) & 6-Digit Pairing Authentication**
  - Implemented `service/discovery.py` using `zeroconf` to advertise `_kiro-connect._tcp.local` for the Host and browse on Workers.
  - Implemented 6-digit pairing handshake over HTTP (`/api/swarm/pair`): Host validates code, issues session token, and admits worker into the active swarm.
  - Implemented `service/worker_agent.py` to handle worker lifecycle and heartbeats.
  - *Verified:* Handshake tested with valid and invalid pairing codes.

- [x] **Phase 4: OpenAI-Compatible Gateway & MoA Orchestration Engine**
  - Built `service/gateway.py` with `POST /v1/chat/completions` and `GET /v1/models`.
  - Implemented external API key protection (`Authorization: Bearer <HOST_API_KEY>`).
  - Implemented Mixture-of-Agents (MoA) pipeline in `service/orchestrator.py`:
    - Step 1 (Propose): Concurrently fans out prompts to worker `llama.cpp` servers and host local model.
    - Step 2 (Collect & Evaluate): Collects responses and token logprobs.
    - Step 3 (Confidence Scoring): Computes pairwise cross-agreement + token logprob certainty.
    - Step 4 (Aggregate / Synthesize): Selects top consensus response or runs synthesis pass.
    - Step 5 (Node Trust / Flagging): Detects divergent nodes, tracks divergence counts, and flags untrusted nodes.
  - Formatted response adhering to standard OpenAI JSON schema with non-breaking metadata: `kiro_confidence`, `contributing_nodes`, `flagged_nodes`.
  - *Verified:* Tested via integration test suite.

- [x] **Phase 5: Host Monitoring Dashboard & Custom Folder Loading**
  - Implemented tabbed UI in `src/App.tsx` and `src/App.css`:
    - Overview: Gateway endpoint, Host API key, 6-digit pairing tiles, stat widgets.
    - Models & Engine: Custom folder scanner with scan button and list of discovered models, context slider, Q4 KV cache badge, launch/stop buttons.
    - Swarm Fleet: Table of connected nodes, live tokens/sec throughput, latency, divergence flags, and 1-click Fleet Benchmark tool.
    - MoA Playground: Interactive query test console showing consensus confidence score, contributing nodes, and latency.
    - Worker Mode: Dedicated worker joining screen with mDNS host discovery and 6-digit pairing input.
  - *Verified:* Full frontend compiles and mounts cleanly in FastAPI.

- [x] **Phase 6: Correction Memory (Local ChromaDB Vector Store)**
  - Implemented `service/memory.py` with ChromaDB persistent collection `kiro_correction_memory`.
  - Created 100% offline, zero-network-dependency embedding function (`LocalFeatureEmbeddingFunction`) to ensure fast, reliable local operation without external model downloads.
  - Records `(query, wrong_answer, correct_answer)` triples and injects past corrections into system context before new queries.
  - *Verified:* Tested storing and querying triples via `scratch/test_integration.py`.

---

## Done When
1. App launches with always-dark theme and purple K-C monogram branding. [DONE]
2. Host mode launches local `llama-server.exe` with Q4 KV cache and custom context size. [DONE]
3. Custom folder model scanner loads GGUF models from any user folder. [DONE]
4. Workers discover host via mDNS and pair using the 6-digit code. [DONE]
5. External OpenAI requests to host gateway return aggregated MoA responses with confidence scores. [DONE]
6. Host dashboard displays live node status, token throughput, and divergence flags. [DONE]
7. ChromaDB stores correction memory and recalls past mistakes. [DONE]
