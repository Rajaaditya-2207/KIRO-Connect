import React, { useState, useEffect } from "react";
import "./App.css";

const API_BASE =
  typeof window !== "undefined" &&
  window.location.origin &&
  (window.location.origin.startsWith("http://localhost:8000") ||
   window.location.origin.startsWith("http://127.0.0.1:8000") ||
   window.location.origin.startsWith("http://0.0.0.0:8000") ||
   (window.location.port === "8000"))
    ? window.location.origin
    : "http://127.0.0.1:8000";

interface SwarmStatus {
  host_name: string;
  local_ip: string;
  gateway_port: number;
  gateway_endpoint: string;
  host_api_key: string;
  pairing_code: string;
  total_nodes: number;
  healthy_nodes: number;
  total_requests: number;
  total_tokens: number;
  is_broadcasting: boolean;
}

interface SwarmNode {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  hardware: string;
  status: "idle" | "busy" | "flagged";
  divergence_count: number;
  total_prompts: number;
  total_tokens: number;
  last_latency_ms: number;
  tokens_per_sec: number;
  avg_tokens_per_sec: number;
  is_host_local: boolean;
}

interface LocalModel {
  name: string;
  path: string;
  size_gb: number;
  parent_folder: string;
}

interface LlamaStatus {
  running: boolean;
  pid: number | null;
  port: number | null;
  endpoint: string | null;
  model_path: string | null;
  uptime_seconds: number;
}

interface CorrectionItem {
  id: string;
  query: string;
  wrong_answer: string;
  correct_answer: string;
}

export default function App() {
  const [mode, setMode] = useState<"host" | "worker">("host");
  const [activeTab, setActiveTab] = useState<"overview" | "models" | "nodes" | "playground" | "memory">("overview");

  // Swarm & Node State
  const [swarmStatus, setSwarmStatus] = useState<SwarmStatus | null>(null);
  const [nodes, setNodes] = useState<SwarmNode[]>([]);
  const [hostLlamaStatus, setHostLlamaStatus] = useState<LlamaStatus | null>(null);

  // Models & Custom Folder State
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [customFolderPath, setCustomFolderPath] = useState<string>("");
  const [isScanningFolder, setIsScanningFolder] = useState<boolean>(false);
  const [selectedModelPath, setSelectedModelPath] = useState<string>("");
  const [contextSize, setContextSize] = useState<number>(4096);
  const [isLlamaStarting, setIsLlamaStarting] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<boolean>(false);

  // Benchmarking State
  const [isBenchmarking, setIsBenchmarking] = useState<boolean>(false);
  const [benchmarkResults, setBenchmarkResults] = useState<any[]>([]);

  // MoA Playground State
  const [promptInput, setPromptInput] = useState<string>(
    "What are the key benefits of running a private Mixture-of-Agents inference swarm over LAN?"
  );
  const [isQuerying, setIsQuerying] = useState<boolean>(false);
  const [queryResponse, setQueryResponse] = useState<any>(null);

  // Correction Memory State
  const [corrections, setCorrections] = useState<CorrectionItem[]>([]);
  const [corrQuery, setCorrQuery] = useState<string>("");
  const [corrWrong, setCorrWrong] = useState<string>("");
  const [corrRight, setCorrRight] = useState<string>("");

  // Worker Mode State
  const [workerHostEndpoint, setWorkerHostEndpoint] = useState<string>("");
  const [workerPairingCode, setWorkerPairingCode] = useState<string>("");
  const [workerPort, setWorkerPort] = useState<number>(8082);
  const [workerEngineRunning, setWorkerEngineRunning] = useState<boolean>(false);
  const [isWorkerEngineStarting, setIsWorkerEngineStarting] = useState<boolean>(false);
  const [discoveredHosts, setDiscoveredHosts] = useState<any[]>([]);
  const [workerStatus, setWorkerStatus] = useState<{
    connected: boolean;
    session?: string;
    host?: string;
    error?: string;
    local_ip?: string;
  }>({ connected: false });

  // Polling loop
  useEffect(() => {
    fetchInitialData();
    const interval = setInterval(() => {
      fetchStatusAndNodes();
      if (mode === "worker") {
        fetchWorkerInfo();
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [mode]);

  const fetchInitialData = async () => {
    try {
      const modelsRes = await fetch(`${API_BASE}/api/host/local-models`);
      if (modelsRes.ok) {
        const data = await modelsRes.json();
        setLocalModels(data.models || []);
        if (data.models && data.models.length > 0 && !selectedModelPath) {
          setSelectedModelPath(data.models[0].path);
        }
      }
      fetchStatusAndNodes();
      fetchCorrections();
    } catch (e) {
      console.warn("Backend starting or not yet connected:", e);
    }
  };

  const fetchStatusAndNodes = async () => {
    try {
      const statusRes = await fetch(`${API_BASE}/api/swarm/status`);
      if (statusRes.ok) {
        const data = await statusRes.json();
        setSwarmStatus(data);
      }

      const nodesRes = await fetch(`${API_BASE}/api/swarm/nodes`);
      if (nodesRes.ok) {
        const data = await nodesRes.json();
        setNodes(data.nodes || []);
      }

      const llamaRes = await fetch(`${API_BASE}/api/host/llama-status`);
      if (llamaRes.ok) {
        const data = await llamaRes.json();
        setHostLlamaStatus(data);
      }
    } catch (e) {
      // Offline or loading
    }
  };

  const fetchCorrections = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/memory/list`);
      if (res.ok) {
        const data = await res.json();
        setCorrections(data.corrections || []);
      }
    } catch (e) {
      console.warn("Error fetching corrections:", e);
    }
  };

  // Custom Folder Scanner
  const handleScanCustomFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customFolderPath.trim()) return;
    setIsScanningFolder(true);
    try {
      const res = await fetch(`${API_BASE}/api/host/scan-folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_path: customFolderPath.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        const scanned: LocalModel[] = data.models || [];
        if (scanned.length > 0) {
          // Merge unique models
          const existingPaths = new Set(localModels.map((m) => m.path));
          const newModels = [...localModels];
          for (const m of scanned) {
            if (!existingPaths.has(m.path)) {
              newModels.push(m);
              existingPaths.add(m.path);
            }
          }
          setLocalModels(newModels);
          setSelectedModelPath(scanned[0].path);
          alert(`Successfully discovered ${scanned.length} GGUF model(s) in custom folder!`);
        } else {
          alert(`No .gguf model files were found in "${customFolderPath}".`);
        }
      }
    } catch (e: any) {
      alert("Error scanning custom folder: " + e.message);
    } finally {
      setIsScanningFolder(false);
    }
  };

  const startHostLlama = async () => {
    if (!selectedModelPath) return;
    setIsLlamaStarting(true);
    try {
      const res = await fetch(`${API_BASE}/api/host/start-llama`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_path: selectedModelPath,
          ctx_size: contextSize,
          port: 8081,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        alert("Error launching llama-server: " + data.error);
      }
      fetchStatusAndNodes();
    } catch (e: any) {
      alert("Failed to communicate with engine: " + e.message);
    } finally {
      setIsLlamaStarting(false);
    }
  };

  const stopHostLlama = async () => {
    try {
      await fetch(`${API_BASE}/api/host/stop-llama`, { method: "POST" });
      fetchStatusAndNodes();
    } catch (e) {
      console.error(e);
    }
  };

  const refreshPairingCode = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/swarm/refresh-pairing-code`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (swarmStatus) {
          setSwarmStatus({ ...swarmStatus, pairing_code: data.pairing_code });
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const copyApiKey = () => {
    if (swarmStatus?.host_api_key) {
      navigator.clipboard.writeText(swarmStatus.host_api_key);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const handleTestQuery = async () => {
    if (!promptInput.trim() || !swarmStatus) return;
    setIsQuerying(true);
    setQueryResponse(null);
    try {
      const res = await fetch(`${API_BASE}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${swarmStatus.host_api_key}`,
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: promptInput }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setQueryResponse(data);
      } else {
        const err = await res.json();
        alert("Gateway Error: " + (err.detail || JSON.stringify(err)));
      }
    } catch (e: any) {
      alert("Query execution failed: " + e.message);
    } finally {
      setIsQuerying(false);
    }
  };

  const handleRunBenchmark = async () => {
    setIsBenchmarking(true);
    setBenchmarkResults([]);
    try {
      const res = await fetch(`${API_BASE}/api/swarm/benchmark`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setBenchmarkResults(data.results || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsBenchmarking(false);
    }
  };

  const handleSaveCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!corrQuery || !corrWrong || !corrRight) return;
    try {
      const res = await fetch(`${API_BASE}/api/memory/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: corrQuery,
          wrong_answer: corrWrong,
          correct_answer: corrRight,
        }),
      });
      if (res.ok) {
        setCorrQuery("");
        setCorrWrong("");
        setCorrRight("");
        fetchCorrections();
        alert("Correction recorded in ChromaDB!");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchWorkerInfo = async () => {
    try {
      const hostsRes = await fetch(`${API_BASE}/api/worker/discovered-hosts`);
      if (hostsRes.ok) {
        const data = await hostsRes.json();
        setDiscoveredHosts(data.hosts || []);
        if (data.hosts && data.hosts.length > 0 && !workerHostEndpoint) {
          setWorkerHostEndpoint(data.hosts[0].endpoint);
        }
      }
      const stRes = await fetch(`${API_BASE}/api/worker/status`);
      if (stRes.ok) {
        const data = await stRes.json();
        setWorkerEngineRunning(data.llama_status?.running || false);
        setWorkerStatus((prev) => ({
          ...prev,
          connected: data.is_connected || false,
          host: data.host_endpoint || prev.host,
          local_ip: data.local_ip,
        }));
      }
    } catch (e) {
      // Worker info loading
    }
  };

  const startWorkerEngine = async () => {
    if (!selectedModelPath) {
      alert("Please select a GGUF model for the worker node first.");
      return;
    }
    setIsWorkerEngineStarting(true);
    try {
      const res = await fetch(`${API_BASE}/api/worker/start-engine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_path: selectedModelPath,
          port: workerPort,
          ctx_size: contextSize,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setWorkerEngineRunning(true);
        alert(`Worker engine started on LAN at ${data.endpoint}!`);
      } else {
        alert("Failed to start worker engine: " + (data.error || JSON.stringify(data)));
      }
      fetchWorkerInfo();
    } catch (e: any) {
      alert("Error starting worker engine: " + e.message);
    } finally {
      setIsWorkerEngineStarting(false);
    }
  };

  const stopWorkerEngine = async () => {
    try {
      await fetch(`${API_BASE}/api/worker/stop-engine`, { method: "POST" });
      setWorkerEngineRunning(false);
      fetchWorkerInfo();
    } catch (e) {
      console.error(e);
    }
  };

  const handleResetNodeFlag = async (nodeId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/swarm/nodes/${nodeId}/reset-flag`, {
        method: "POST",
      });
      if (res.ok) {
        fetchStatusAndNodes();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleWorkerPair = async () => {
    if (!workerHostEndpoint || !workerPairingCode) {
      alert("Please provide the host endpoint and 6-digit pairing code.");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/worker/join-swarm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host_endpoint: workerHostEndpoint.trim(),
          pairing_code: workerPairingCode.trim(),
          hardware: "Worker GPU/CPU",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setWorkerStatus({
          connected: true,
          session: data.data?.session_token,
          host: data.data?.host_name || workerHostEndpoint,
        });
        alert("Worker successfully authenticated and joined the swarm!");
      } else {
        setWorkerStatus({ connected: false, error: data.error || data.detail });
        alert("Pairing failed: " + (data.error || data.detail));
      }
      fetchWorkerInfo();
    } catch (e: any) {
      setWorkerStatus({ connected: false, error: e.message });
      alert("Pairing error: " + e.message);
    }
  };

  return (
    <div className="app-shell">
      {/* Top Navigation */}
      <header className="top-nav">
        <div className="brand-wrapper">
          <img src="/kiro-logo.png" className="kc-logo-img" alt="KIRO-Connect Logo" />
          <div className="brand-text">
            <h1>KIRO-Connect</h1>
            <p>Peer-to-Peer LAN Mixture-of-Agents Inference Swarm</p>
          </div>
        </div>

        {/* Center: Mode & Sub-Tabs */}
        <div className="nav-center">
          <div className="mode-toggle-group">
            <button
              className={`mode-toggle-btn ${mode === "host" ? "active" : ""}`}
              onClick={() => setMode("host")}
            >
              Host Swarm
            </button>
            <button
              className={`mode-toggle-btn ${mode === "worker" ? "active" : ""}`}
              onClick={() => setMode("worker")}
            >
              Worker Node
            </button>
          </div>

          {mode === "host" && (
            <div className="nav-tabs">
              <button
                className={`nav-tab-btn ${activeTab === "overview" ? "active" : ""}`}
                onClick={() => setActiveTab("overview")}
              >
                Overview
              </button>
              <button
                className={`nav-tab-btn ${activeTab === "models" ? "active" : ""}`}
                onClick={() => setActiveTab("models")}
              >
                Models & Engine
              </button>
              <button
                className={`nav-tab-btn ${activeTab === "nodes" ? "active" : ""}`}
                onClick={() => setActiveTab("nodes")}
              >
                Swarm Fleet ({nodes.length})
              </button>
              <button
                className={`nav-tab-btn ${activeTab === "playground" ? "active" : ""}`}
                onClick={() => setActiveTab("playground")}
              >
                MoA Playground
              </button>
              <button
                className={`nav-tab-btn ${activeTab === "memory" ? "active" : ""}`}
                onClick={() => setActiveTab("memory")}
              >
                Memory ({corrections.length})
              </button>
            </div>
          )}
        </div>

        {/* Status Indicator */}
        <div className="top-status-group">
          {swarmStatus ? (
            <div className="status-chip chip-online">
              <span className="chip-dot"></span>
              {swarmStatus.total_nodes} Node{swarmStatus.total_nodes !== 1 ? "s" : ""} Online
            </div>
          ) : (
            <div className="status-chip chip-offline">
              <span className="chip-dot"></span> Gateway Offline
            </div>
          )}
        </div>
      </header>

      {/* Main Viewport */}
      <main className="viewport">
        {mode === "host" ? (
          <div>
            {/* TAB: OVERVIEW */}
            {activeTab === "overview" && (
              <div>
                {/* 4 Stat Widgets */}
                <div className="grid-cards-4">
                  <div className="stat-widget">
                    <div className="stat-widget-label">Swarm Nodes</div>
                    <div className="stat-widget-val">{nodes.length}</div>
                    <div className="stat-widget-sub">
                      <span>{nodes.filter((n) => n.status !== "flagged").length} consensus-aligned</span>
                    </div>
                  </div>

                  <div className="stat-widget">
                    <div className="stat-widget-label">Total Prompts</div>
                    <div className="stat-widget-val">{swarmStatus?.total_requests || 0}</div>
                    <div className="stat-widget-sub">Aggregated gateway requests</div>
                  </div>

                  <div className="stat-widget">
                    <div className="stat-widget-label">Swarm Tokens</div>
                    <div className="stat-widget-val">
                      {(swarmStatus?.total_tokens || 0).toLocaleString()}
                    </div>
                    <div className="stat-widget-sub">Zero cloud API cost</div>
                  </div>

                  <div className="stat-widget">
                    <div className="stat-widget-label">Engine Status</div>
                    <div className="stat-widget-val" style={{ fontSize: "18px", color: hostLlamaStatus?.running ? "var(--accent-emerald)" : "var(--accent-rose)" }}>
                      {hostLlamaStatus?.running ? "RUNNING" : "STOPPED"}
                    </div>
                    <div className="stat-widget-sub">
                      {hostLlamaStatus?.running ? `PID ${hostLlamaStatus.pid} on port ${hostLlamaStatus.port}` : "Launch in Models tab"}
                    </div>
                  </div>
                </div>

                {/* Gateway & Authentication Grid */}
                <div className="grid-cards-2">
                  {/* Panel 1: Gateway Credentials */}
                  <div className="panel">
                    <div className="panel-header">
                      <div>
                        <div className="panel-title">Unified OpenAI Gateway Endpoint</div>
                        <div className="panel-subtitle">External clients connect to this single endpoint</div>
                      </div>
                      <span className="panel-tag">v1/chat/completions</span>
                    </div>

                    <div className="input-group">
                      <div className="input-label">
                        <span>Gateway Base URL</span>
                        <span className="copy-pill" onClick={() => navigator.clipboard.writeText(swarmStatus?.gateway_endpoint || "")}>
                          Copy URL
                        </span>
                      </div>
                      <input
                        type="text"
                        readOnly
                        className="input-field input-field-mono"
                        value={swarmStatus?.gateway_endpoint || "http://127.0.0.1:8000/v1"}
                      />
                    </div>

                    <div className="input-group">
                      <div className="input-label">
                        <span>Host Swarm API Key</span>
                        <span className="copy-pill" onClick={copyApiKey}>
                          {copiedKey ? "Copied!" : "Copy Key"}
                        </span>
                      </div>
                      <input
                        type="text"
                        readOnly
                        className="input-field input-field-mono"
                        value={swarmStatus?.host_api_key || "Loading..."}
                      />
                    </div>

                    <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
                      <span className="q4-kv-badge">Model: kiro-connect-moa</span>
                      <span className="q4-kv-badge">mDNS: _kiro-connect._tcp.local</span>
                    </div>
                  </div>

                  {/* Panel 2: 6-Digit Pairing Code */}
                  <div className="panel">
                    <div className="panel-header">
                      <div>
                        <div className="panel-title">Worker Node Pairing Code</div>
                        <div className="panel-subtitle">Single-use PIN to authenticate worker laptops</div>
                      </div>
                      <button className="btn-action btn-ghost" style={{ padding: "4px 8px", fontSize: "11px" }} onClick={refreshPairingCode}>
                        Regenerate
                      </button>
                    </div>

                    <div className="pairing-cluster">
                      <div className="code-row">
                        {(swarmStatus?.pairing_code || "------").split("").map((ch, i) => (
                          <div key={i} className="code-cell">
                            {ch}
                          </div>
                        ))}
                      </div>
                      <p style={{ color: "var(--text-dim)", fontSize: "11.5px", textAlign: "center" }}>
                        Enter this 6-digit code on any worker laptop running KIRO-Connect on your LAN.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Quick Fleet Snapshot */}
                <div className="panel">
                  <div className="panel-header">
                    <div className="panel-title">Swarm Node Topology</div>
                    <button className="btn-action btn-ghost" onClick={() => setActiveTab("nodes")}>
                      View Detailed Fleet →
                    </button>
                  </div>
                  {nodes.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-dim)" }}>
                      No nodes currently active. Start the host model or pair workers on the network.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
                      {nodes.map((node) => (
                        <div key={node.id} style={{ background: "var(--bg-input)", border: "1px solid var(--border-subtle)", borderRadius: "8px", padding: "12px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                            <strong>{node.name}</strong>
                            <span className={`pill pill-${node.status}`}>{node.status.toUpperCase()}</span>
                          </div>
                          <div style={{ fontSize: "11.5px", color: "var(--text-dim)" }}>{node.model}</div>
                          <div style={{ fontSize: "11px", color: "var(--accent-purple-light)", marginTop: "6px" }}>
                            {node.tokens_per_sec ? `${node.tokens_per_sec} tok/s` : "Idle"} • {node.last_latency_ms ? `${node.last_latency_ms} ms` : "—"}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB: MODELS & CUSTOM FOLDER SCANNER */}
            {activeTab === "models" && (
              <div>
                {/* Custom Folder Scanner Panel */}
                <div className="panel" style={{ marginBottom: "20px" }}>
                  <div className="panel-header">
                    <div>
                      <div className="panel-title">Custom Folder Model Scanner</div>
                      <div className="panel-subtitle">
                        Point to any directory on your computer or external drive containing GGUF model files
                      </div>
                    </div>
                    <span className="panel-tag">Custom Path Support</span>
                  </div>

                  <form onSubmit={handleScanCustomFolder} style={{ display: "flex", gap: "10px", marginBottom: "14px" }}>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g. D:\models or C:\Users\rajaa\Downloads or /path/to/models"
                      value={customFolderPath}
                      onChange={(e) => setCustomFolderPath(e.target.value)}
                    />
                    <button
                      type="submit"
                      disabled={isScanningFolder || !customFolderPath.trim()}
                      className="btn-action btn-purple"
                      style={{ flexShrink: 0 }}
                    >
                      {isScanningFolder ? "Scanning..." : "Scan Folder"}
                    </button>
                  </form>

                  {/* Discovered Models List */}
                  <div className="input-label">Available GGUF Models ({localModels.length} discovered)</div>
                  {localModels.length === 0 ? (
                    <div style={{ padding: "16px", background: "var(--bg-input)", borderRadius: "8px", color: "var(--text-dim)", textAlign: "center" }}>
                      No GGUF models discovered yet. Enter a custom folder path above or place models in <code>~/models</code>.
                    </div>
                  ) : (
                    <div className="model-list-grid">
                      {localModels.map((m, idx) => (
                        <div
                          key={idx}
                          className={`model-card-item ${selectedModelPath === m.path ? "selected" : ""}`}
                          onClick={() => setSelectedModelPath(m.path)}
                        >
                          <div>
                            <div className="model-card-name">{m.name}</div>
                            <div className="model-card-meta">
                              <span>Size: {m.size_gb} GB</span>
                              <span>Folder: {m.parent_folder}</span>
                            </div>
                          </div>
                          <button
                            className="btn-action btn-ghost"
                            style={{ padding: "4px 8px", fontSize: "11px" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedModelPath(m.path);
                            }}
                          >
                            {selectedModelPath === m.path ? "Selected ✓" : "Select"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Engine Runtime Settings */}
                <div className="panel">
                  <div className="panel-header">
                    <div>
                      <div className="panel-title">Host llama.cpp Process Configuration</div>
                      <div className="panel-subtitle">
                        Fixed Q4 KV cache quantization flags translated directly into <code>llama-server.exe</code>
                      </div>
                    </div>
                    <span className="q4-kv-badge">Q4 KV Cache (-ctk q4_0 -ctv q4_0)</span>
                  </div>

                  <div className="grid-cards-2">
                    <div className="input-group">
                      <div className="input-label">Active GGUF Model Path</div>
                      <input
                        type="text"
                        className="input-field input-field-mono"
                        placeholder="Path to model file"
                        value={selectedModelPath}
                        onChange={(e) => setSelectedModelPath(e.target.value)}
                      />
                    </div>

                    <div className="input-group">
                      <div className="input-label">
                        <span>Context Window (--ctx-size)</span>
                        <span style={{ color: "var(--accent-purple-light)", fontWeight: "bold" }}>{contextSize} tokens</span>
                      </div>
                      <input
                        type="range"
                        min="2048"
                        max="16384"
                        step="1024"
                        style={{ width: "100%", accentColor: "var(--accent-purple)" }}
                        value={contextSize}
                        onChange={(e) => setContextSize(Number(e.target.value))}
                      />
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px", borderTop: "1px solid var(--border-subtle)", paddingTop: "14px" }}>
                    <div style={{ fontSize: "12px", color: "var(--text-dim)" }}>
                      {hostLlamaStatus?.running ? (
                        <span style={{ color: "var(--accent-emerald)" }}>
                          Engine running on port {hostLlamaStatus.port} (PID {hostLlamaStatus.pid})
                        </span>
                      ) : (
                        <span>Ready to launch local engine process</span>
                      )}
                    </div>

                    {hostLlamaStatus?.running ? (
                      <button className="btn-action btn-danger" onClick={stopHostLlama}>
                        Stop Host Engine
                      </button>
                    ) : (
                      <button
                        className="btn-action btn-purple"
                        disabled={isLlamaStarting || !selectedModelPath}
                        onClick={startHostLlama}
                      >
                        {isLlamaStarting ? "Starting llama-server..." : "Launch Host Engine"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB: SWARM FLEET & BENCHMARK */}
            {activeTab === "nodes" && (
              <div>
                <div className="panel">
                  <div className="panel-header">
                    <div>
                      <div className="panel-title">Connected Swarm Fleet ({nodes.length})</div>
                      <div className="panel-subtitle">
                        Mixture-of-Agents node pool with real-time throughput & integrity checking
                      </div>
                    </div>
                    <button
                      className="btn-action btn-ghost"
                      disabled={isBenchmarking || nodes.length === 0}
                      onClick={handleRunBenchmark}
                    >
                      {isBenchmarking ? "Benchmarking Swarm..." : "Run Fleet Benchmark"}
                    </button>
                  </div>

                  {nodes.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "30px 0", color: "var(--text-dim)" }}>
                      No nodes registered. Launch the host model or pair worker laptops to view live fleet metrics.
                    </div>
                  ) : (
                    <table className="swarm-table">
                      <thead>
                        <tr>
                          <th>Node Name</th>
                          <th>Model Loaded</th>
                          <th>Hardware</th>
                          <th>Status</th>
                          <th>Throughput</th>
                          <th>Latency</th>
                          <th>Divergence Checks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nodes.map((node) => (
                          <tr key={node.id}>
                            <td>
                              <strong>{node.name}</strong>
                              {node.is_host_local && (
                                <span style={{ marginLeft: "6px", color: "var(--accent-purple-light)", fontSize: "11px" }}>
                                  (Host)
                                </span>
                              )}
                            </td>
                            <td style={{ color: "var(--text-muted)" }}>{node.model}</td>
                            <td>{node.hardware}</td>
                            <td>
                              <span className={`pill pill-${node.status}`}>{node.status.toUpperCase()}</span>
                            </td>
                            <td>
                              {node.tokens_per_sec ? (
                                <strong style={{ color: "var(--accent-emerald)" }}>{node.tokens_per_sec} tok/s</strong>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td>{node.last_latency_ms ? `${node.last_latency_ms} ms` : "—"}</td>
                            <td>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                {node.divergence_count > 0 ? (
                                  <span style={{ color: "var(--accent-amber)", fontWeight: "bold" }}>
                                    {node.divergence_count} / 3 flags
                                  </span>
                                ) : (
                                  <span style={{ color: "var(--accent-emerald)" }}>Aligned</span>
                                )}
                                {node.status === "flagged" && (
                                  <button
                                    className="btn-action btn-ghost"
                                    style={{ padding: "2px 6px", fontSize: "10px", color: "var(--accent-emerald)" }}
                                    onClick={() => handleResetNodeFlag(node.id)}
                                    title="Clear flags and restore node to active inference pool"
                                  >
                                    Unflag ↺
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {/* Benchmark Output */}
                  {benchmarkResults.length > 0 && (
                    <div style={{ marginTop: "18px", padding: "14px", background: "var(--bg-input)", borderRadius: "8px" }}>
                      <div style={{ fontWeight: "700", marginBottom: "8px", color: "var(--accent-purple-light)" }}>
                        Fleet Benchmark Results
                      </div>
                      <div className="grid-cards-4">
                        {benchmarkResults.map((b, i) => (
                          <div key={i} className="stat-widget">
                            <div className="stat-widget-label">{b.node_name}</div>
                            <div className="stat-widget-val" style={{ fontSize: "18px" }}>{b.tokens_per_sec} tok/s</div>
                            <div className="stat-widget-sub">{b.latency_ms} ms latency</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB: MOA PLAYGROUND */}
            {activeTab === "playground" && (
              <div className="grid-cards-3-2">
                {/* Chat Panel */}
                <div className="panel">
                  <div className="panel-header">
                    <div>
                      <div className="panel-title">Interactive Swarm Playground</div>
                      <div className="panel-subtitle">Dispatches queries through the unified OpenAI gateway</div>
                    </div>
                    <span className="panel-tag">Propose-then-Aggregate</span>
                  </div>

                  <div className="chat-container">
                    <div className="chat-input-box">
                      <textarea
                        className="chat-textarea"
                        value={promptInput}
                        onChange={(e) => setPromptInput(e.target.value)}
                        placeholder="Ask the swarm anything..."
                      />
                      <div className="chat-action-bar">
                        <span style={{ fontSize: "11.5px", color: "var(--text-dim)" }}>
                          Fans out to {nodes.length} peer node(s)
                        </span>
                        <button
                          className="btn-action btn-purple"
                          disabled={isQuerying || nodes.length === 0}
                          onClick={handleTestQuery}
                        >
                          {isQuerying ? "Synthesizing Answers..." : "Send Query"}
                        </button>
                      </div>
                    </div>

                    {queryResponse && (
                      <div className="chat-response-card">
                        <div className="chat-meta-bar">
                          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                            <span style={{ color: "var(--accent-purple-light)", fontWeight: "bold" }}>
                              Consensus Confidence: {Math.round((queryResponse.kiro_confidence || 0) * 100)}%
                            </span>
                            <span style={{ color: "var(--text-dim)", fontSize: "11px" }}>
                              • {queryResponse.usage?.total_tokens || 0} tokens
                            </span>
                          </div>
                          <span className="copy-pill" onClick={() => navigator.clipboard.writeText(queryResponse.choices?.[0]?.message?.content || "")}>
                            Copy Response
                          </span>
                        </div>
                        <div className="chat-bubble-text">
                          {queryResponse.choices?.[0]?.message?.content}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Inspect Contributing Nodes Panel */}
                <div className="panel">
                  <div className="panel-header">
                    <div className="panel-title">MoA Orchestration Breakdown</div>
                  </div>

                  {queryResponse ? (
                    <div>
                      <div style={{ marginBottom: "12px" }}>
                        <div className="input-label">Contributing Nodes</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                          {(queryResponse.contributing_nodes || []).map((n: string, i: number) => (
                            <span key={i} className="q4-kv-badge">{n}</span>
                          ))}
                        </div>
                      </div>

                      {queryResponse.flagged_nodes && queryResponse.flagged_nodes.length > 0 && (
                        <div style={{ marginBottom: "12px" }}>
                          <div className="input-label" style={{ color: "var(--accent-rose)" }}>Flagged / Divergent Nodes</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                            {queryResponse.flagged_nodes.map((n: string, i: number) => (
                              <span key={i} className="pill pill-flagged">{n}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div style={{ fontSize: "11.5px", color: "var(--text-dim)", marginTop: "14px", lineHeight: "1.6" }}>
                        Queries are fanned out concurrently to all peer nodes on LAN. Each candidate output is scored using cross-model semantic agreement and token log probabilities. High-agreement answers are synthesized into the final response.
                      </div>
                    </div>
                  ) : (
                    <div style={{ color: "var(--text-dim)", textAlign: "center", padding: "30px 0" }}>
                      Dispatch a test prompt to inspect contributing node contributions and consensus metrics.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB: CORRECTION MEMORY */}
            {activeTab === "memory" && (
              <div className="grid-cards-2">
                {/* Form */}
                <div className="panel">
                  <div className="panel-header">
                    <div>
                      <div className="panel-title">Teach Swarm Memory</div>
                      <div className="panel-subtitle">Record query / mistake / correction triples in ChromaDB</div>
                    </div>
                    <span className="panel-tag">ChromaDB Vector Store</span>
                  </div>

                  <form onSubmit={handleSaveCorrection}>
                    <div className="input-group">
                      <label className="input-label">Query Pattern or Prompt</label>
                      <input
                        type="text"
                        className="input-field"
                        placeholder="e.g. 'What is the capital of Australia?'"
                        value={corrQuery}
                        onChange={(e) => setCorrQuery(e.target.value)}
                      />
                    </div>

                    <div className="input-group">
                      <label className="input-label">Incorrect Swarm Output</label>
                      <input
                        type="text"
                        className="input-field"
                        placeholder="e.g. 'Sydney'"
                        value={corrWrong}
                        onChange={(e) => setCorrWrong(e.target.value)}
                      />
                    </div>

                    <div className="input-group">
                      <label className="input-label">Correct Ground Truth</label>
                      <input
                        type="text"
                        className="input-field"
                        placeholder="e.g. 'Canberra'"
                        value={corrRight}
                        onChange={(e) => setCorrRight(e.target.value)}
                      />
                    </div>

                    <button type="submit" className="btn-action btn-purple" style={{ width: "100%", marginTop: "6px" }}>
                      Store Correction Triple
                    </button>
                  </form>
                </div>

                {/* Stored Memory List */}
                <div className="panel">
                  <div className="panel-header">
                    <div className="panel-title">Stored Memories ({corrections.length})</div>
                  </div>

                  {corrections.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "30px 0", color: "var(--text-dim)" }}>
                      No corrections recorded yet. When a node diverges or makes a mistake, teach it here!
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "320px", overflowY: "auto" }}>
                      {corrections.map((c) => (
                        <div
                          key={c.id}
                          style={{
                            background: "var(--bg-input)",
                            border: "1px solid var(--border-subtle)",
                            borderRadius: "8px",
                            padding: "10px",
                            fontSize: "12px",
                          }}
                        >
                          <div><strong>Query:</strong> {c.query}</div>
                          <div style={{ color: "var(--accent-rose)", marginTop: "2px" }}>✗ Mistake: {c.wrong_answer}</div>
                          <div style={{ color: "var(--accent-emerald)", marginTop: "2px" }}>✓ Correction: {c.correct_answer}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* WORKER MODE */
          <div style={{ maxWidth: "800px", margin: "0 auto" }}>
            {/* Worker Engine Panel */}
            <div className="panel" style={{ marginBottom: "20px" }}>
              <div className="panel-header">
                <div>
                  <div className="panel-title">Worker Compute Node Engine</div>
                  <div className="panel-subtitle">Donate your laptop's local LLM compute to a LAN Swarm Host</div>
                </div>
                <span className={`pill ${workerEngineRunning ? "pill-busy" : "pill-idle"}`}>
                  {workerEngineRunning ? "ENGINE RUNNING" : "ENGINE STOPPED"}
                </span>
              </div>

              <div className="input-group">
                <label className="input-label">Select Worker GGUF Model</label>
                {localModels.length > 0 ? (
                  <select
                    className="input-field"
                    value={selectedModelPath}
                    onChange={(e) => setSelectedModelPath(e.target.value)}
                  >
                    {localModels.map((m, idx) => (
                      <option key={idx} value={m.path}>
                        {m.name} ({m.size_gb} GB)
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Path to worker model"
                    value={selectedModelPath}
                    onChange={(e) => setSelectedModelPath(e.target.value)}
                  />
                )}
              </div>

              <div className="grid-cards-2">
                <div className="input-group">
                  <label className="input-label">Worker llama.cpp Port (LAN Bound: 0.0.0.0)</label>
                  <input
                    type="number"
                    className="input-field"
                    value={workerPort}
                    onChange={(e) => setWorkerPort(Number(e.target.value))}
                  />
                </div>

                <div className="input-group">
                  <label className="input-label">KV Cache Quantization</label>
                  <div className="q4-kv-badge" style={{ marginTop: "4px" }}>
                    Q4 Fixed (-ctk q4_0 -ctv q4_0)
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "14px", borderTop: "1px solid var(--border-subtle)", paddingTop: "14px" }}>
                <div style={{ fontSize: "12px", color: "var(--text-dim)" }}>
                  {workerEngineRunning ? (
                    <span style={{ color: "var(--accent-emerald)" }}>
                      Engine active on port {workerPort} (LAN IP: {workerStatus.local_ip || "detecting..."})
                    </span>
                  ) : (
                    <span>Launch engine before pairing with Swarm Host</span>
                  )}
                </div>

                {workerEngineRunning ? (
                  <button className="btn-action btn-danger" onClick={stopWorkerEngine}>
                    Stop Worker Engine
                  </button>
                ) : (
                  <button
                    className="btn-action btn-purple"
                    disabled={isWorkerEngineStarting || !selectedModelPath}
                    onClick={startWorkerEngine}
                  >
                    {isWorkerEngineStarting ? "Starting Engine..." : "Launch Worker Engine"}
                  </button>
                )}
              </div>
            </div>

            {/* Join Swarm Card */}
            <div className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Authenticate & Join Host Swarm</div>
                  <div className="panel-subtitle">Connect to Host via mDNS auto-discovery or enter Host URL</div>
                </div>
                {workerStatus.connected ? (
                  <span className="pill pill-idle">CONNECTED TO SWARM</span>
                ) : (
                  <span className="pill pill-flagged">DISCONNECTED</span>
                )}
              </div>

              {/* Discovered Hosts on LAN */}
              {discoveredHosts.length > 0 && (
                <div style={{ marginBottom: "14px", padding: "12px", background: "var(--bg-input)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "11.5px", fontWeight: "700", color: "var(--accent-purple-light)", marginBottom: "8px" }}>
                    Discovered Swarm Hosts on LAN (mDNS):
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {discoveredHosts.map((h, i) => (
                      <button
                        key={i}
                        type="button"
                        className="btn-action btn-ghost"
                        style={{ fontSize: "11px", borderColor: workerHostEndpoint === h.endpoint ? "var(--accent-purple)" : undefined }}
                        onClick={() => setWorkerHostEndpoint(h.endpoint)}
                      >
                        ✓ {h.display_name} ({h.endpoint})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="input-group">
                <label className="input-label">Host Swarm Endpoint</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. http://192.168.1.100:8000"
                  value={workerHostEndpoint}
                  onChange={(e) => setWorkerHostEndpoint(e.target.value)}
                />
              </div>

              <div className="input-group">
                <label className="input-label">Enter 6-Digit Pairing Code from Host Dashboard</label>
                <input
                  type="text"
                  maxLength={6}
                  className="input-field input-field-mono"
                  style={{ letterSpacing: "6px", fontSize: "20px", fontWeight: "bold", textAlign: "center" }}
                  placeholder="000000"
                  value={workerPairingCode}
                  onChange={(e) => setWorkerPairingCode(e.target.value)}
                />
              </div>

              {workerStatus.error && (
                <div style={{ color: "var(--accent-rose)", fontSize: "12px", marginBottom: "12px" }}>
                  {workerStatus.error}
                </div>
              )}

              {workerStatus.connected ? (
                <div style={{ padding: "14px", background: "rgba(16,185,129,0.1)", borderRadius: "8px", border: "1px solid rgba(16,185,129,0.3)" }}>
                  <div style={{ color: "var(--accent-emerald)", fontWeight: "bold" }}>
                    ✓ Authenticated with Swarm Host: {workerStatus.host}
                  </div>
                  <div style={{ fontSize: "11.5px", color: "var(--text-dim)", marginTop: "4px" }}>
                    Heartbeat active. The Host will route MoA subtask prompts to this worker over LAN.
                  </div>
                </div>
              ) : (
                <button
                  className="btn-action btn-purple"
                  style={{ width: "100%", marginTop: "6px" }}
                  disabled={!workerEngineRunning}
                  onClick={handleWorkerPair}
                >
                  {workerEngineRunning ? "Authenticate & Join Swarm" : "Launch Worker Engine First Above"}
                </button>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
