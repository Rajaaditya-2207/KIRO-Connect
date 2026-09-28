# KIRO-Connect — Product Requirements Document & Build Prompt

## 1. Product Summary

**Name:** KIRO-Connect

**One-liner:** A desktop app that turns a group of laptops on the same network into a private, self-hosted Mixture-of-Agents inference swarm — like VS Code Live Share, but for local LLM inference.

**Problem it solves:** Teams and individuals running local LLMs are limited by whatever hardware is in front of them, and cloud APIs cost money and leak data. KIRO-Connect lets a group pool their laptops' compute — one powerful GPU laptop as host, other laptops (GPU or strong CPU) as workers — to run a Mixture-of-Agents setup entirely on-network, with no data leaving the LAN and no per-token API cost.

**Core mechanism:** Every node (host and workers) runs its own `llama.cpp` server instance with a Q4-quantized KV cache. The host's desktop app discovers workers on the network, exposes an OpenAI-compatible endpoint with an API key for external clients (e.g. a demo website), fans queries out to worker nodes, aggregates their responses (MoA-style), and scores confidence based on cross-node agreement.

---

## 2. Goals

1. Let a non-technical user go from "installed the app" to "swarm is answering queries" in under ten minutes.
2. Reduce reliance on paid cloud APIs for teams that already own capable laptops.
3. Keep all inference and data on the local network — nothing sent externally.
4. Demonstrate a working Mixture-of-Agents pattern with visible confidence scoring, not just a single-model relay.
5. Give the host visibility into what's actually happening on their network: which nodes are active, token throughput, latency, and basic benchmarks.
6. Build in integrity/trust checking as a first-class feature, not an afterthought — a node whose answers consistently diverge from consensus should be flagged.

## 3. Non-Goals (out of scope for v1)

- Internet-wide/WAN swarms (LAN only for v1).
- Splitting a single model's layers across devices (this is agent-level parallelism, not tensor/model parallelism).
- Mobile clients.
- Training or fine-tuning anything.
- A full knowledge graph — v1 uses a lightweight vector-store "correction memory" instead (see section 6).

---

## 4. Users & Core Use Cases

- **Host user:** owns the powerful GPU laptop, runs the app in "Host" mode, picks a model, sets context window and KV cache settings, watches the network dashboard.
- **Worker user:** joins an existing host's network in "Worker" mode, picks a model that fits their hardware, contributes compute.
- **External consumer:** a simple demo website or API client that hits the host's OpenAI-compatible endpoint with the issued API key to send a query and see the MoA response with a confidence score.

---

## 5. Functional Requirements

### 5.1 Desktop App (Tauri)
- Built with Tauri (lightweight, better security posture than Electron).
- Always-dark theme, matching llama.cpp's own aesthetic.
- Logo: a "K-C" monogram mark, purple color scheme.
- Two modes selectable on launch: **Host** or **Worker**.
- Manages the lifecycle of a local `llama.cpp` server process (start/stop/restart) rather than reimplementing inference.

### 5.2 Model & Runtime Configuration
- User picks a locally-available GGUF model file (or provides a path/download URL).
- Adjustable context window size.
- KV cache quantization fixed to Q4 (`--cache-type-k q4_0 --cache-type-v q4_0` or current equivalent flags — verify against the installed llama.cpp build/version, since flag names have shifted across releases).
- App translates these settings into the correct llama.cpp launch command and manages the process.

### 5.3 Networking & Discovery
- Host and worker nodes discover each other on the LAN via mDNS/zeroconf.
- Worker nodes authenticate to the host before being accepted into the swarm (pre-shared key or lightweight certificate handshake — exact mechanism is an open question for the agent to propose, see clarifying questions below).
- Host issues an OpenAI-compatible endpoint URL + API key for external consumption (this maps directly to llama.cpp server's built-in `--api-key` support, potentially fronted by the host app's own gateway if you want the MoA aggregation to happen before returning a response).

### 5.4 Mixture-of-Agents Orchestration
- Host fans a query out to some/all connected worker nodes (each potentially running a different model).
- Each node returns a response, optionally with token-level logprobs.
- Host aggregates responses using an MoA-style approach: either a designated strongest node acts as "judge," or a semantic-similarity comparison across responses produces a confidence score (high agreement = high confidence, divergence = low confidence and a flag).
- A node whose outputs repeatedly diverge from consensus gets down-weighted or temporarily evicted from the active pool — this is the trust/integrity layer and is a headline feature, not an optional extra.

### 5.4a Gateway Architecture (Critical — External Endpoint vs. LAN Nodes)
This is a distinction the build agent must get right, so it's called out explicitly:

- The external OpenAI-compatible endpoint the host issues to clients (the demo website, or any OpenAI-SDK-compatible tool) is **not** a direct pass-through to the host's own llama.cpp server. It is a **gateway/orchestrator service** that sits in front of the entire swarm.
- From the outside, a client only ever sees one endpoint and one model name (e.g. `kiro-connect-moa`) and has no visibility into the fact that multiple laptops are involved.
- Request flow: external request arrives at the orchestrator/gateway → gateway fans the prompt out to connected worker nodes' local llama.cpp servers (LAN-only, never exposed externally) → gateway collects responses → gateway validates/aggregates (confidence scoring, judge-model selection, or synthesis) → gateway returns a single response in standard OpenAI chat-completion format.
- The individual llama.cpp `--api-key`-protected endpoints on host and worker machines are internal/LAN-only. Only the gateway is internet/network-facing to external clients.
- To preserve compatibility with standard OpenAI client libraries, extra metadata (confidence score, contributing node list) should be added as additional fields alongside the standard response fields, not by breaking the standard response shape.
- This gateway layer is custom code — llama.cpp's own API key support does not provide aggregation, so this must be built, not assumed.

### 5.5 Correction Memory (lightweight, not a full knowledge graph)
- When a mistake is caught (via disagreement flagging or manual correction during testing/demo), store a record: original query, wrong answer, correct answer, and an embedding of the query.
- Before processing new subtasks, do a quick similarity lookup against this store so the swarm can "recall" past corrections.
- Recommended: a local vector store (e.g. Chroma) rather than a graph database — much less build time for nearly the same practical value at this stage.

### 5.6 Host Monitoring Dashboard
- Live list of connected nodes: name, model loaded, GPU/CPU, status (idle/busy/flagged).
- Traffic monitor: requests routed per node, in/out token counts.
- Token throughput (tokens/sec) per node, live and historical.
- Basic benchmark view: latency per node for a standard test prompt, so the host can see relative node performance at a glance.

### 5.7 Demo Website
- Simple web client that calls the host's OpenAI-compatible endpoint with the issued API key.
- Displays the MoA response along with its confidence score and (optionally) which nodes contributed.

---

## 6. Technical Approach / Suggested Stack

| Layer | Choice | Why |
|---|---|---|
| Inference engine | `ggml-org/llama.cpp` (server mode, OpenAI-compatible endpoint, Q4 KV cache) | Mature, well-documented, does most of the hard work already |
| Desktop shell | `tauri-apps/tauri` | Lightweight, smaller attack surface than Electron |
| Discovery | mDNS/zeroconf (e.g. `python-zeroconf` or a Rust equivalent depending on backend language) | Standard LAN discovery, no custom protocol needed |
| Orchestration | Custom lightweight service (FastAPI-style if a Python sidecar, or native Rust/Tauri backend) | Ray is possible but likely overkill for a LAN swarm of a handful of nodes |
| Correction memory | `chroma-core/chroma` | Simple local vector store, no server setup required |
| MoA reference pattern | `togethercomputer/MoA` (adapt cloud calls to local endpoints) | Established propose-then-aggregate pattern |
