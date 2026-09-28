import React, { useState, useEffect } from "react";
import "./App.css";

const API_BASE =
  typeof window !== "undefined" &&
  window.location.origin &&
  (window.location.port !== "1420" && window.location.port !== "5173")
    ? window.location.origin
    : "http://127.0.0.1:8000";

interface SwarmStatus {
  host_name: string;
  local_ip: string;
  all_local_ips?: string[];
  gateway_port: number;
  gateway_endpoint: string;
  gateway_endpoints?: string[];
  host_api_key: string;
  pairing_code: string;
  total_nodes: number;
  healthy_nodes: number;
  total_requests: number;
  total_tokens: number;
  is_broadcasting: boolean;
  shared_memory_mappings?: number;
  shared_memory_status?: string;
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

export default function App() {
  const [mode, setMode] = useState<"host" | "worker">("host");
  const [activeTab, setActiveTab] = useState<"overview" | "playground" | "models" | "nodes">("overview");

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
  const [playgroundPrompt, setPlaygroundPrompt] = useState<string>(
    "Explain how decentralized peer-to-peer Mixture-of-Agents consensus prevents single-model hallucinations."
  );
  const [playgroundTemperature, setPlaygroundTemperature] = useState<number>(0.7);
  const [playgroundMaxTokens, setPlaygroundMaxTokens] = useState<number>(512);
  const [isPlaygroundRunning, setIsPlaygroundRunning] = useState<boolean>(false);
  const [playgroundResult, setPlaygroundResult] = useState<{
    text: string;
    confidence: number;
    nodesParticipated: string[];
    divergentNodes: any[];
    memoryApplied: boolean;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    latencyMs?: number;
  } | null>(null);

  // Non-blocking Toast State
  const [toast, setToast] = useState<{ message: string; type: "success" | "info" | "error" } | null>(null);

  const showToast = (message: string, type: "success" | "info" | "error" = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Resilient Clipboard Copy Helper (works on HTTP and HTTPS)
  const copyTextToClipboard = async (text: string, successMessage?: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
      showToast(successMessage || "Copied to clipboard!", "success");
      return true;
    } catch (err) {
      console.error("Failed to copy:", err);
      showToast("Failed to copy to clipboard", "error");
      return false;
    }
  };

  // Worker Mode State
  const [workerHostEndpoint, setWorkerHostEndpoint] = useState<string>("");
  const [workerPairingCode, setWorkerPairingCode] = useState<string>("");
  const [workerPort, setWorkerPort] = useState<number>(8082);
  const [workerEngineRunning, setWorkerEngineRunning] = useState<boolean>(false);
  const [isWorkerEngineStarting, setIsWorkerEngineStarting] = useState<boolean>(false);
  const [discoveredHosts, setDiscoveredHosts] = useState<any[]>([]);
  const [isScanningHosts, setIsScanningHosts] = useState<boolean>(false);
  const [workerStatus, setWorkerStatus] = useState<{
    connected: boolean;
    session?: string;
    host?: string;
    error?: string;
    local_ip?: string;
    all_local_ips?: string[];
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
          showToast(`Successfully discovered ${scanned.length} GGUF model(s) in custom folder!`, "success");
        } else {
          showToast(`No .gguf model files were found in "${customFolderPath}".`, "info");
        }
      }
    } catch (e: any) {
      showToast("Error scanning custom folder: " + e.message, "error");
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
        showToast("Error launching llama-server: " + data.error, "error");
      } else {
        showToast("Host llama-server launched successfully!", "success");
      }
      fetchStatusAndNodes();
    } catch (e: any) {
      showToast("Failed to communicate with engine: " + e.message, "error");
    } finally {
      setIsLlamaStarting(false);
    }
  };

  const stopHostLlama = async () => {
    try {
      await fetch(`${API_BASE}/api/host/stop-llama`, { method: "POST" });
      showToast("Host engine stopped.", "info");
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
        showToast("Generated new 6-digit worker pairing code!", "success");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const copyApiKey = () => {
    if (swarmStatus?.host_api_key) {
      copyTextToClipboard(swarmStatus.host_api_key, "Swarm Host API Key copied to clipboard!");
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const handleRunPlayground = async () => {
    if (!playgroundPrompt.trim()) {
      showToast("Please enter a prompt to test swarm consensus.", "error");
      return;
    }
    setIsPlaygroundRunning(true);
    const startTime = Date.now();
    try {
      const res = await fetch(`${API_BASE}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${swarmStatus?.host_api_key || ""}`,
        },
        body: JSON.stringify({
          model: "kiro-connect-moa",
          messages: [{ role: "user", content: playgroundPrompt.trim() }],
          temperature: playgroundTemperature,
          max_tokens: playgroundMaxTokens,
          stream: false,
        }),
      });
      const data = await res.json();
      const duration = Date.now() - startTime;
      if (res.ok && data.choices && data.choices.length > 0) {
        setPlaygroundResult({
          text: data.choices[0].message?.content || "",
          confidence: data.kiro_confidence ?? 1.0,
          nodesParticipated: data.nodes_participated || [],
          divergentNodes: data._divergent_candidates || [],
          memoryApplied: data.shared_memory_applied || false,
          usage: data.usage,
          latencyMs: duration,
        });
        showToast("Swarm consensus inference complete!", "success");
        fetchStatusAndNodes();
      } else {
        showToast(`Inference error: ${data.detail || data.error || "Unknown error"}`, "error");
      }
    } catch (err: any) {
      showToast(`Inference failed: ${err.message}`, "error");
    } finally {
      setIsPlaygroundRunning(false);
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

  const fetchWorkerInfo = async (forceRefresh = false) => {
    if (forceRefresh) setIsScanningHosts(true);
    try {
      const url = forceRefresh
        ? `${API_BASE}/api/worker/discovered-hosts?refresh=true`
        : `${API_BASE}/api/worker/discovered-hosts`;
      const hostsRes = await fetch(url);
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
          all_local_ips: data.all_local_ips,
        }));
      }
    } catch (e) {
      // Worker info loading
    } finally {
      if (forceRefresh) setIsScanningHosts(false);
    }
  };

  const startWorkerEngine = async () => {
    if (!selectedModelPath) {
      showToast("Please select a GGUF model for the worker node first.", "error");
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
        showToast(`Worker engine started on LAN at ${data.endpoint}!`, "success");
      } else {
        showToast("Failed to start worker engine: " + (data.error || JSON.stringify(data)), "error");
      }
      fetchWorkerInfo();
    } catch (e: any) {
      showToast("Error starting worker engine: " + e.message, "error");
    } finally {
      setIsWorkerEngineStarting(false);
    }
  };

  const stopWorkerEngine = async () => {
    try {
      await fetch(`${API_BASE}/api/worker/stop-engine`, { method: "POST" });
      setWorkerEngineRunning(false);
      showToast("Worker engine stopped.", "info");
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
        showToast("Node restored to active inference pool!", "success");
        fetchStatusAndNodes();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleWorkerPair = async () => {
    if (!workerHostEndpoint || !workerPairingCode) {
      showToast("Please provide the host endpoint and 6-digit pairing code.", "error");
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
        showToast("Worker successfully authenticated and joined the swarm!", "success");
      } else {
        setWorkerStatus({ connected: false, error: data.error || data.detail });
        showToast("Pairing failed: " + (data.error || data.detail), "error");
      }
      fetchWorkerInfo();
    } catch (e: any) {
      setWorkerStatus({ connected: false, error: e.message });
      showToast("Pairing error: " + e.message, "error");
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
                className={`nav-tab-btn ${activeTab === "playground" ? "active" : ""}`}
                onClick={() => setActiveTab("playground")}
              >
                ⚡ MoA Playground
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
                    <div className="stat-widget-label">Shared Swarm Memory</div>
                    <div className="stat-widget-val" style={{ color: "var(--accent-purple-light)" }}>
                      {swarmStatus?.shared_memory_mappings || 0}
                    </div>
                    <div className="stat-widget-sub">Host auto-mapped (Wrong ➔ Right)</div>
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
                        <span>Gateway Base URL ({swarmStatus?.all_local_ips?.length || 1} LAN Adapter{(swarmStatus?.all_local_ips?.length || 1) > 1 ? "s" : ""})</span>
                        <span className="copy-pill" onClick={() => copyTextToClipboard(swarmStatus?.gateway_endpoint || "", "Gateway endpoint copied!")}>
                          Copy Primary
                        </span>
                      </div>
                      <input
                        type="text"
                        readOnly
                        className="input-field input-field-mono"
                        value={swarmStatus?.gateway_endpoint || "http://127.0.0.1:8000/v1"}
                      />
                      {swarmStatus?.gateway_endpoints && swarmStatus.gateway_endpoints.length > 1 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" }}>
                          {swarmStatus.gateway_endpoints.map((ep, i) => (
                            <span
                              key={i}
                              className="copy-pill"
                              style={{ fontSize: "10.5px" }}
                              onClick={() => copyTextToClipboard(ep, `Copied adapter endpoint: ${ep}`)}
                              title="Click to copy this LAN adapter endpoint"
                            >
                              📋 {ep}
                            </span>
                          ))}
                        </div>
                      )}
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

                {/* Panel: OpenAI-Compatible Client Testing & Quickstart */}
                <div className="panel" style={{ marginBottom: "16px" }}>
                  <div className="panel-header">
                    <div>
                      <div className="panel-title">OpenAI-Compatible Testing & Client Quickstart</div>
                      <div className="panel-subtitle">
                        Test and query the swarm directly with standard OpenAI SDKs, cURL, or third-party web UIs
                      </div>
                    </div>
                    <span className="panel-tag">Direct MoA Gateway</span>
                  </div>

                  <div className="grid-cards-2" style={{ gap: "14px" }}>
                    <div>
                      <div className="input-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                        <span style={{ fontWeight: 600 }}>Python (openai SDK)</span>
                        <span
                          className="copy-pill"
                          onClick={() => {
                            const code = `from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${swarmStatus?.gateway_endpoint || "http://127.0.0.1:8000/v1"}",\n    api_key="${swarmStatus?.host_api_key || "YOUR_KEY"}"\n)\n\nresponse = client.chat.completions.create(\n    model="kiro-connect-moa",\n    messages=[{"role": "user", "content": "Explain peer-to-peer MoA swarms."}]\n)\nprint(response.choices[0].message.content)`;
                            copyTextToClipboard(code, "Python snippet copied!");
                          }}
                        >
                          Copy Python
                        </span>
                      </div>
                      <pre
                        className="input-field-mono"
                        style={{
                          background: "var(--bg-input)",
                          padding: "12px",
                          borderRadius: "8px",
                          fontSize: "11px",
                          color: "var(--accent-purple-light)",
                          lineHeight: "1.5",
                          whiteSpace: "pre-wrap",
                          overflowX: "auto",
                          margin: 0
                        }}
                      >
{`from openai import OpenAI

client = OpenAI(
    base_url="${swarmStatus?.gateway_endpoint || "http://127.0.0.1:8000/v1"}",
    api_key="${swarmStatus?.host_api_key || "YOUR_KEY"}"
)

response = client.chat.completions.create(
    model="kiro-connect-moa",
    messages=[{"role": "user", "content": "Explain peer-to-peer MoA swarms."}]
)
print(response.choices[0].message.content)`}
                      </pre>
                    </div>

                    <div>
                      <div className="input-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                        <span style={{ fontWeight: 600 }}>cURL (Terminal CLI)</span>
                        <span
                          className="copy-pill"
                          onClick={() => {
                            const code = `curl -X POST "${swarmStatus?.gateway_endpoint || "http://127.0.0.1:8000/v1"}/chat/completions" \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${swarmStatus?.host_api_key || "YOUR_KEY"}" \\\n  -d '{\n    "model": "kiro-connect-moa",\n    "messages": [{"role": "user", "content": "Hello Swarm"}]\n  }'`;
                            copyTextToClipboard(code, "cURL snippet copied!");
                          }}
                        >
                          Copy cURL
                        </span>
                      </div>
                      <pre
                        className="input-field-mono"
                        style={{
                          background: "var(--bg-input)",
                          padding: "12px",
                          borderRadius: "8px",
                          fontSize: "11px",
                          color: "var(--accent-emerald)",
                          lineHeight: "1.5",
                          whiteSpace: "pre-wrap",
                          overflowX: "auto",
                          margin: 0
                        }}
                      >
{`curl -X POST "${swarmStatus?.gateway_endpoint || "http://127.0.0.1:8000/v1"}/chat/completions" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${swarmStatus?.host_api_key || "YOUR_KEY"}" \\
  -d '{
    "model": "kiro-connect-moa",
    "messages": [{"role": "user", "content": "Hello Swarm"}]
  }'`}
                      </pre>
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

            {/* TAB: MOA SWARM PLAYGROUND */}
            {activeTab === "playground" && (
              <div>
                <div className="panel" style={{ marginBottom: "20px" }}>
                  <div className="panel-header">
                    <div>
                      <div className="panel-title">Interactive MoA Swarm Playground</div>
                      <div className="panel-subtitle">
                        Test decentralized Mixture-of-Agents consensus inference with real-time confidence & node alignment
                      </div>
                    </div>
                    <span className="panel-tag">Live Swarm Execution</span>
                  </div>

                  <div className="chat-container">
                    <div className="chat-input-box">
                      <label className="input-label" style={{ marginBottom: "6px" }}>
                        Prompt / Query to Swarm
                      </label>
                      <textarea
                        className="chat-textarea"
                        placeholder="Enter your prompt here... (e.g. Compare Rust and C++ for high-performance network services)"
                        value={playgroundPrompt}
                        onChange={(e) => setPlaygroundPrompt(e.target.value)}
                        disabled={isPlaygroundRunning}
                      />

                      <div className="grid-cards-2" style={{ marginTop: "12px", gap: "14px" }}>
                        <div className="input-group" style={{ marginBottom: 0 }}>
                          <div className="input-label">
                            <span>Temperature</span>
                            <span style={{ color: "var(--accent-purple-light)", fontWeight: "bold" }}>
                              {playgroundTemperature.toFixed(2)}
                            </span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="1.5"
                            step="0.05"
                            style={{ width: "100%", accentColor: "var(--accent-purple)" }}
                            value={playgroundTemperature}
                            onChange={(e) => setPlaygroundTemperature(parseFloat(e.target.value))}
                            disabled={isPlaygroundRunning}
                          />
                        </div>

                        <div className="input-group" style={{ marginBottom: 0 }}>
                          <div className="input-label">
                            <span>Max Tokens</span>
                            <span style={{ color: "var(--accent-purple-light)", fontWeight: "bold" }}>
                              {playgroundMaxTokens}
                            </span>
                          </div>
                          <input
                            type="range"
                            min="128"
                            max="2048"
                            step="128"
                            style={{ width: "100%", accentColor: "var(--accent-purple)" }}
                            value={playgroundMaxTokens}
                            onChange={(e) => setPlaygroundMaxTokens(parseInt(e.target.value, 10))}
                            disabled={isPlaygroundRunning}
                          />
                        </div>
                      </div>

                      <div className="chat-action-bar">
                        <div style={{ fontSize: "11.5px", color: "var(--text-dim)" }}>
                          {nodes.length > 0 ? (
                            <span>Targeting {nodes.length} active node{nodes.length > 1 ? "s" : ""} on LAN</span>
                          ) : (
                            <span style={{ color: "var(--accent-rose)" }}>Warning: No swarm nodes active. Launch host engine or pair workers.</span>
                          )}
                        </div>
                        <button
                          className="btn-action btn-purple"
                          disabled={isPlaygroundRunning || !playgroundPrompt.trim() || nodes.length === 0}
                          onClick={handleRunPlayground}
                        >
                          {isPlaygroundRunning ? "Synthesizing Consensus..." : "⚡ Run Swarm Inference"}
                        </button>
                      </div>
                    </div>

                    {/* Result Output Card */}
                    {playgroundResult && (
                      <div className="chat-response-card" style={{ marginTop: "10px" }}>
                        <div className="chat-meta-bar">
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                            <span
                              className="pill"
                              style={{
                                background: playgroundResult.confidence >= 0.75 ? "rgba(16, 185, 129, 0.15)" : "rgba(245, 158, 11, 0.15)",
                                color: playgroundResult.confidence >= 0.75 ? "var(--accent-emerald)" : "var(--accent-amber)",
                                border: `1px solid ${playgroundResult.confidence >= 0.75 ? "rgba(16, 185, 129, 0.3)" : "rgba(245, 158, 11, 0.3)"}`
                              }}
                            >
                              ★ {(playgroundResult.confidence * 100).toFixed(0)}% Consensus Alignment
                            </span>
                            {playgroundResult.memoryApplied && (
                              <span className="q4-kv-badge" style={{ fontSize: "10.5px" }}>
                                🧠 Shared Memory Applied
                              </span>
                            )}
                            {playgroundResult.latencyMs && (
                              <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                                ⏱️ {playgroundResult.latencyMs} ms
                              </span>
                            )}
                            {playgroundResult.usage && (
                              <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                                📊 {playgroundResult.usage.completion_tokens} tokens
                              </span>
                            )}
                          </div>
                          <span
                            className="copy-pill"
                            onClick={() => copyTextToClipboard(playgroundResult.text, "Synthesized response copied!")}
                          >
                            📋 Copy Response
                          </span>
                        </div>

                        <div className="chat-bubble-text">
                          {playgroundResult.text}
                        </div>

                        {/* Contributing & Divergent Nodes */}
                        <div style={{ marginTop: "14px", paddingTop: "10px", borderTop: "1px solid rgba(255, 255, 255, 0.05)", display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
                          <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>Participating Nodes:</span>
                          {playgroundResult.nodesParticipated.length > 0 ? (
                            playgroundResult.nodesParticipated.map((n, i) => (
                              <span key={i} className="pill pill-idle" style={{ fontSize: "10.5px" }}>
                                ✓ {n}
                              </span>
                            ))
                          ) : (
                            <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>Swarm default</span>
                          )}

                          {playgroundResult.divergentNodes && playgroundResult.divergentNodes.length > 0 && (
                            <div style={{ width: "100%", marginTop: "6px" }}>
                              <span style={{ fontSize: "11px", color: "var(--accent-rose)", fontWeight: "bold" }}>
                                ⚠️ Filtered Divergent Proposals ({playgroundResult.divergentNodes.length}):
                              </span>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "4px" }}>
                                {playgroundResult.divergentNodes.map((d: any, idx: number) => (
                                  <span key={idx} className="pill pill-flagged" style={{ fontSize: "10px" }}>
                                    {d.node_name || "Unknown node"} (score: {typeof d.divergence_score === "number" ? d.divergence_score.toFixed(2) : "divergent"})
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
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

              {/* Local Adapter Information & Refresh Bar */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", padding: "10px 14px", background: "var(--bg-input)", borderRadius: "8px" }}>
                <div style={{ fontSize: "11.5px", color: "var(--text-dim)" }}>
                  Your LAN IP(s): <strong style={{ color: "var(--accent-purple-light)" }}>{workerStatus.all_local_ips?.join(", ") || workerStatus.local_ip || "Detecting..."}</strong>
                </div>
                <button
                  type="button"
                  className="btn-action btn-ghost"
                  style={{ fontSize: "11px", padding: "4px 8px" }}
                  disabled={isScanningHosts}
                  onClick={() => fetchWorkerInfo(true)}
                >
                  {isScanningHosts ? "Scanning LAN (mDNS)..." : "🔄 Refresh LAN Discovery"}
                </button>
              </div>

              {/* Discovered Hosts on LAN */}
              <div style={{ marginBottom: "14px", padding: "12px", background: "var(--bg-input)", borderRadius: "8px" }}>
                <div style={{ fontSize: "11.5px", fontWeight: "700", color: "var(--accent-purple-light)", marginBottom: "8px" }}>
                  Discovered Swarm Hosts on LAN (mDNS):
                </div>
                {discoveredHosts.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {discoveredHosts.map((h, i) => (
                      <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {(h.endpoints && h.endpoints.length > 0 ? h.endpoints : [h.endpoint]).map((ep: string, epIdx: number) => (
                          <button
                            key={epIdx}
                            type="button"
                            className="btn-action btn-ghost"
                            style={{
                              fontSize: "11px",
                              borderColor: workerHostEndpoint === ep ? "var(--accent-purple)" : undefined,
                              background: workerHostEndpoint === ep ? "rgba(168, 85, 247, 0.15)" : undefined
                            }}
                            onClick={() => setWorkerHostEndpoint(ep)}
                          >
                            ✓ {h.display_name} ({ep})
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: "11.5px", color: "var(--text-dim)", lineHeight: "1.5" }}>
                    No hosts auto-discovered via mDNS yet. Ensure the Host has started KIRO-Connect on the same LAN / Wi-Fi network, or type the Host's IP address directly below.
                  </div>
                )}
              </div>

              <div className="input-group">
                <label className="input-label">Host Swarm Endpoint</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder={workerStatus.local_ip ? `e.g. http://${workerStatus.local_ip}:8000` : "e.g. http://<host-ip>:8000"}
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

      {/* Global Non-blocking Toast Notification */}
      {toast && (
        <div className={`toast-banner toast-${toast.type}`}>
          <span>{toast.message}</span>
          <span
            style={{ cursor: "pointer", marginLeft: "10px", fontWeight: "bold", opacity: 0.8 }}
            onClick={() => setToast(null)}
          >
            ✕
          </span>
        </div>
      )}
    </div>
  );
}
