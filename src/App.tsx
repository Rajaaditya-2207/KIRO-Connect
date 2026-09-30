import { useState, useEffect } from "react";
import {
  Network,
  Cpu,
  Database,
  Activity,
  ShieldCheck,
  Key,
  RefreshCw,
  Play,
  Square,
  CheckCircle2,
  Wifi,
  Copy,
  FolderSearch,
  Zap,
  Layers,
  FileText,
  Radio,
  Code2,
  Clock,
  Sparkles,
  Trash2,
} from "lucide-react";
import NetworkGraph3D, { SwarmNode3D } from "./components/NetworkGraph3D";
import "./App.css";

const isTauri =
  typeof window !== "undefined" &&
  (window.location.origin.includes("tauri.localhost") ||
    window.location.origin.startsWith("tauri://") ||
    (window as any).__TAURI_INTERNALS__ !== undefined);

const API_BASE = isTauri
  ? "http://127.0.0.1:8000"
  : typeof window !== "undefined" &&
    window.location.origin &&
    window.location.port !== "1420" &&
    window.location.port !== "5173"
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
  session_memory_count?: number;
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
  const [hostTab, setHostTab] = useState<
    "topology" | "gateway" | "fleet" | "models" | "memory" | "docs"
  >("topology");
  const [workerTab, setWorkerTab] = useState<
    "telemetry" | "compute" | "security"
  >("telemetry");

  // Swarm & Node State
  const [swarmStatus, setSwarmStatus] = useState<SwarmStatus | null>(null);
  const [nodes, setNodes] = useState<SwarmNode3D[]>([]);
  const [hostLlamaStatus, setHostLlamaStatus] = useState<LlamaStatus | null>(null);

  // Models & Scanner State
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [customFolderPath, setCustomFolderPath] = useState<string>("");
  const [isScanningFolder, setIsScanningFolder] = useState<boolean>(false);
  const [selectedModelPath, setSelectedModelPath] = useState<string>("");
  const [contextSize, setContextSize] = useState<number>(4096);
  const [gpuLayers, setGpuLayers] = useState<number>(99);
  const [isLlamaStarting, setIsLlamaStarting] = useState<boolean>(false);

  // Benchmarking State
  const [isBenchmarking, setIsBenchmarking] = useState<boolean>(false);
  const [benchmarkResults, setBenchmarkResults] = useState<any[]>([]);

  // Worker Mode State
  const [workerHostIp, setWorkerHostIp] = useState<string>("");
  const [workerPin, setWorkerPin] = useState<string>("");
  const [workerModelPath, setWorkerModelPath] = useState<string>("");
  const [workerStatus, setWorkerStatus] = useState<any>(null);
  const [isWorkerStarting, setIsWorkerStarting] = useState<boolean>(false);
  const [isWorkerJoining, setIsWorkerJoining] = useState<boolean>(false);
  const [discoveredHosts, setDiscoveredHosts] = useState<any[]>([]);
  const [isScanningHosts, setIsScanningHosts] = useState<boolean>(false);

  // Shared Memory State
  const [memoryCorrections, setMemoryCorrections] = useState<any[]>([]);

  // Interactive API Docs Query State
  const [docPrompt, setDocPrompt] = useState<string>(
    "Explain how decentralized peer-to-peer Mixture-of-Agents consensus prevents single-model hallucinations."
  );
  const [docResponse, setDocResponse] = useState<any>(null);
  const [isDocQueryRunning, setIsDocQueryRunning] = useState<boolean>(false);
  const [docActiveLang, setDocActiveLang] = useState<"python" | "curl" | "ts">(
    "python"
  );

  // Toast Banner State
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(`${label} copied to clipboard!`);
  };

  // 1. Polling and status fetching
  const fetchStatusAndNodes = async () => {
    try {
      const [resStatus, resNodes, resLlama] = await Promise.all([
        fetch(`${API_BASE}/api/swarm/status`),
        fetch(`${API_BASE}/api/swarm/nodes`),
        fetch(`${API_BASE}/api/host/llama-status`),
      ]);

      if (resStatus.ok) {
        const s = await resStatus.json();
        setSwarmStatus(s);
      }
      if (resNodes.ok) {
        const n = await resNodes.json();
        setNodes(n.nodes || []);
      }
      if (resLlama.ok) {
        const l = await resLlama.json();
        setHostLlamaStatus(l);
      }
    } catch {
      // Server may be offline during launch
    }
  };

  const fetchLocalModels = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/host/local-models`);
      if (res.ok) {
        const data = await res.json();
        setLocalModels(data.models || []);
        if (data.models && data.models.length > 0 && !selectedModelPath) {
          setSelectedModelPath(data.models[0].path);
          if (!workerModelPath) {
            setWorkerModelPath(data.models[0].path);
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchMemoryCorrections = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/memory/list`);
      if (res.ok) {
        const data = await res.json();
        setMemoryCorrections(data.corrections || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchWorkerStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/worker/status`);
      if (res.ok) {
        const st = await res.json();
        setWorkerStatus(st);
      }
    } catch {
      // Offline
    }
  };

  const scanWorkerHosts = async () => {
    setIsScanningHosts(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/worker/discovered-hosts?refresh=true`
      );
      if (res.ok) {
        const d = await res.json();
        setDiscoveredHosts(d.hosts || []);
        showToast(
          `Discovered ${d.hosts?.length || 0} active swarm hosts on LAN`
        );
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsScanningHosts(false);
    }
  };

  useEffect(() => {
    fetchStatusAndNodes();
    fetchLocalModels();
    fetchMemoryCorrections();

    const interval = setInterval(() => {
      if (mode === "host") {
        fetchStatusAndNodes();
      } else {
        fetchWorkerStatus();
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [mode]);

  // Handle Custom Folder Scanning
  const handleScanFolder = async () => {
    if (!customFolderPath.trim()) {
      showToast("Please enter a directory path to scan");
      return;
    }
    setIsScanningFolder(true);
    try {
      const res = await fetch(`${API_BASE}/api/host/scan-folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_path: customFolderPath.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.models) {
        setLocalModels((prev) => {
          const existing = new Set(prev.map((m) => m.path));
          const additions = data.models.filter(
            (m: LocalModel) => !existing.has(m.path)
          );
          return [...prev, ...additions];
        });
        if (data.models.length > 0) {
          setSelectedModelPath(data.models[0].path);
        }
        showToast(`Discovered ${data.count} GGUF models in directory`);
      } else {
        showToast("No GGUF models found in directory");
      }
    } catch (err: any) {
      showToast(`Scan error: ${err.message}`);
    } finally {
      setIsScanningFolder(false);
    }
  };

  // Start & Stop Host Engine
  const handleStartHostEngine = async () => {
    if (!selectedModelPath) {
      showToast("Please select a GGUF model first");
      return;
    }
    setIsLlamaStarting(true);
    try {
      const res = await fetch(`${API_BASE}/api/host/start-llama`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_path: selectedModelPath,
          ctx_size: contextSize,
          port: 8081,
          n_gpu_layers: gpuLayers,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast("Host model engine started on port 8081!");
        fetchStatusAndNodes();
      } else {
        showToast(`Failed to start engine: ${data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      showToast(`Launch error: ${err.message}`);
    } finally {
      setIsLlamaStarting(false);
    }
  };

  const handleStopHostEngine = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/host/stop-llama`, {
        method: "POST",
      });
      if (res.ok) {
        showToast("Host model engine stopped cleanly");
        fetchStatusAndNodes();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Refresh 6-digit PIN
  const handleRefreshPin = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/swarm/refresh-pairing-code`, {
        method: "POST",
      });
      if (res.ok) {
        const d = await res.json();
        if (swarmStatus) {
          setSwarmStatus({ ...swarmStatus, pairing_code: d.pairing_code });
        }
        showToast("Generated new 6-digit session PIN!");
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Rotate Swarm Host API Key
  const handleRotateApiKey = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/swarm/rotate-api-key`, {
        method: "POST",
      });
      if (res.ok) {
        const d = await res.json();
        if (swarmStatus) {
          setSwarmStatus({ ...swarmStatus, host_api_key: d.host_api_key });
        }
        showToast("Swarm Host API Key rotated to new secure key!");
      }
    } catch (e: any) {
      showToast(`Key rotation error: ${e.message}`);
    }
  };

  // Clear Session Memory
  const handleClearMemory = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/memory/clear`, {
        method: "POST",
      });
      if (res.ok) {
        setMemoryCorrections([]);
        if (swarmStatus) {
          setSwarmStatus({ ...swarmStatus, session_memory_count: 0 });
        }
        showToast("ChromaDB session memory cleared!");
      }
    } catch (e: any) {
      showToast(`Clear error: ${e.message}`);
    }
  };

  // Run Fleet Benchmark
  const handleRunBenchmark = async () => {
    setIsBenchmarking(true);
    setBenchmarkResults([]);
    try {
      const res = await fetch(`${API_BASE}/api/swarm/benchmark`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setBenchmarkResults(data.results || []);
        showToast("Fleet throughput benchmark completed!");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsBenchmarking(false);
    }
  };

  // Unflag a Node
  const handleResetFlag = async (nodeId: string) => {
    try {
      const res = await fetch(
        `${API_BASE}/api/swarm/nodes/${nodeId}/reset-flag`,
        {
          method: "POST",
        }
      );
      if (res.ok) {
        showToast("Node restored to active inference pool!");
        fetchStatusAndNodes();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Worker Launch Engine
  const handleStartWorkerEngine = async () => {
    if (!workerModelPath) {
      showToast("Select a model for the worker sub-agent");
      return;
    }
    setIsWorkerStarting(true);
    try {
      const res = await fetch(`${API_BASE}/api/worker/start-engine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_path: workerModelPath,
          ctx_size: 4096,
          port: 8082,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast("Worker sub-agent engine running on port 8082!");
        fetchWorkerStatus();
      } else {
        showToast(`Worker engine error: ${data.error || "Failed to start"}`);
      }
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    } finally {
      setIsWorkerStarting(false);
    }
  };

  // Worker Join Swarm
  const handleWorkerJoinSwarm = async () => {
    if (!workerHostIp.trim() || !workerPin.trim()) {
      showToast("Provide both Host Endpoint and 6-digit PIN");
      return;
    }
    setIsWorkerJoining(true);
    try {
      const res = await fetch(`${API_BASE}/api/worker/join-swarm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host_endpoint: workerHostIp.trim(),
          pairing_code: workerPin.trim(),
          hardware: "Worker CPU/GPU",
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(
          `Successfully authenticated with Host: ${data.host_name || "Swarm"}`
        );
        fetchWorkerStatus();
      } else {
        showToast(`Pairing rejected: ${data.detail || "Invalid PIN"}`);
      }
    } catch (err: any) {
      showToast(`Pairing failed: ${err.message}`);
    } finally {
      setIsWorkerJoining(false);
    }
  };

  // Interactive API Docs Query Execution
  const handleExecuteDocQuery = async () => {
    if (!docPrompt.trim()) {
      showToast("Please enter a test prompt for the swarm");
      return;
    }
    setIsDocQueryRunning(true);
    setDocResponse(null);
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
          messages: [{ role: "user", content: docPrompt.trim() }],
          temperature: 0.7,
          max_tokens: 512,
        }),
      });
      const data = await res.json();
      const elapsed = Date.now() - startTime;
      if (res.ok && data.choices) {
        setDocResponse({
          ...data,
          client_latency_ms: elapsed,
        });
        showToast("Swarm responded with consensus validation!");
        fetchStatusAndNodes();
        fetchMemoryCorrections();
      } else {
        showToast(`API error: ${data.detail || "Query failed"}`);
      }
    } catch (err: any) {
      showToast(`Query error: ${err.message}`);
    } finally {
      setIsDocQueryRunning(false);
    }
  };

  const primaryEndpoint =
    swarmStatus?.gateway_endpoint ||
    `http://${swarmStatus?.local_ip || "127.0.0.1"}:8000/v1`;

  return (
    <div className="app-shell">
      {/* Top Navigation Bar */}
      <header className="top-nav">
        {/* Brand with Logo */}
        <div className="brand-wrapper">
          <img
            src="/kiro-logo.png"
            className="kc-logo-img"
            alt="KIRO-Connect Logo"
          />
          <div className="view-title-group">
            <span className="brand-title">
              KIRO-Connect
              <span className="brand-badge">MOA SWARM</span>
            </span>
            <span className="brand-subtitle">
              Decentralized Local Inference Network
            </span>
          </div>
        </div>

        {/* Mode Selector Toggle Group */}
        <div className="mode-toggle-group">
          <button
            className={`mode-toggle-btn ${
              mode === "host" ? "active-host" : ""
            }`}
            onClick={() => setMode("host")}
          >
            <ShieldCheck size={16} />
            <span>Host Orchestrator</span>
          </button>
          <button
            className={`mode-toggle-btn ${
              mode === "worker" ? "active-worker" : ""
            }`}
            onClick={() => {
              setMode("worker");
              fetchWorkerStatus();
              scanWorkerHosts();
            }}
          >
            <Cpu size={16} />
            <span>Worker Node</span>
          </button>
        </div>

        {/* Right Status Cluster */}
        <div className="nav-right-cluster">
          {mode === "host" && (
            <button
              className="network-badge-btn"
              onClick={() => copyToClipboard(primaryEndpoint, "Base URL")}
              title="Click to copy OpenAI-compatible Base URL"
            >
              <Key size={13} color="#a855f7" />
              <span>{primaryEndpoint}</span>
              <Copy size={12} color="#64748b" />
            </button>
          )}

          {mode === "host" ? (
            <div className="status-chip online">
              <span className="pulse-dot"></span>
              <span>{nodes.length} Nodes Active</span>
            </div>
          ) : workerStatus?.is_paired ? (
            <div className="status-chip online">
              <span className="pulse-dot"></span>
              <span>Paired with Swarm</span>
            </div>
          ) : (
            <div className="status-chip offline">
              <span className="pulse-dot"></span>
              <span>Standalone Node</span>
            </div>
          )}
        </div>
      </header>

      {/* Body Layout: Left Sidebar + Viewport */}
      <div className="body-layout">
        {/* Dynamic Left Sidebar */}
        <aside className="left-sidebar">
          <div className="sidebar-nav-section">
            <div className="sidebar-section-title">
              {mode === "host" ? "Orchestrator Controls" : "Sub-Agent Controls"}
            </div>

            {mode === "host" ? (
              <>
                <button
                  className={`sidebar-tab-btn ${
                    hostTab === "topology" ? "active-host" : ""
                  }`}
                  onClick={() => setHostTab("topology")}
                >
                  <div className="sidebar-tab-btn-content">
                    <Network size={16} />
                    <span>3D Swarm Topology</span>
                  </div>
                </button>

                <button
                  className={`sidebar-tab-btn ${
                    hostTab === "gateway" ? "active-host" : ""
                  }`}
                  onClick={() => setHostTab("gateway")}
                >
                  <div className="sidebar-tab-btn-content">
                    <Key size={16} />
                    <span>Gateway & Endpoints</span>
                  </div>
                  <span className="sidebar-badge">v1</span>
                </button>

                <button
                  className={`sidebar-tab-btn ${
                    hostTab === "fleet" ? "active-host" : ""
                  }`}
                  onClick={() => setHostTab("fleet")}
                >
                  <div className="sidebar-tab-btn-content">
                    <Activity size={16} />
                    <span>Worker Fleet</span>
                  </div>
                  <span className="sidebar-badge">{nodes.length}</span>
                </button>

                <button
                  className={`sidebar-tab-btn ${
                    hostTab === "models" ? "active-host" : ""
                  }`}
                  onClick={() => setHostTab("models")}
                >
                  <div className="sidebar-tab-btn-content">
                    <Cpu size={16} />
                    <span>Model Engine</span>
                  </div>
                  {hostLlamaStatus?.running && (
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "#10b981",
                        boxShadow: "0 0 6px #10b981",
                      }}
                    ></span>
                  )}
                </button>

                <button
                  className={`sidebar-tab-btn ${
                    hostTab === "memory" ? "active-host" : ""
                  }`}
                  onClick={() => setHostTab("memory")}
                >
                  <div className="sidebar-tab-btn-content">
                    <Database size={16} />
                    <span>Shared Memory</span>
                  </div>
                  <span className="sidebar-badge">
                    {swarmStatus?.session_memory_count || 0}
                  </span>
                </button>

                <button
                  className={`sidebar-tab-btn ${
                    hostTab === "docs" ? "active-host" : ""
                  }`}
                  onClick={() => setHostTab("docs")}
                >
                  <div className="sidebar-tab-btn-content">
                    <FileText size={16} />
                    <span>API Documentation</span>
                  </div>
                  <span className="sidebar-badge">Docs</span>
                </button>
              </>
            ) : (
              <>
                <button
                  className={`sidebar-tab-btn ${
                    workerTab === "telemetry" ? "active-worker" : ""
                  }`}
                  onClick={() => setWorkerTab("telemetry")}
                >
                  <div className="sidebar-tab-btn-content">
                    <Activity size={16} />
                    <span>Node Telemetry</span>
                  </div>
                </button>

                <button
                  className={`sidebar-tab-btn ${
                    workerTab === "compute" ? "active-worker" : ""
                  }`}
                  onClick={() => setWorkerTab("compute")}
                >
                  <div className="sidebar-tab-btn-content">
                    <Cpu size={16} />
                    <span>Compute Engine</span>
                  </div>
                </button>

                <button
                  className={`sidebar-tab-btn ${
                    workerTab === "security" ? "active-worker" : ""
                  }`}
                  onClick={() => setWorkerTab("security")}
                >
                  <div className="sidebar-tab-btn-content">
                    <Radio size={16} />
                    <span>Pairing & Discovery</span>
                  </div>
                  {discoveredHosts.length > 0 && (
                    <span className="sidebar-badge">
                      {discoveredHosts.length} found
                    </span>
                  )}
                </button>
              </>
            )}
          </div>

          <div className="sidebar-footer">
            <div className="sidebar-footer-card">
              <div
                style={{
                  fontWeight: 700,
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Layers size={13} color="#a855f7" />
                <span>MoA Swarm Protocol</span>
              </div>
              <div style={{ color: "#64748b", marginTop: 4, fontSize: "10.5px" }}>
                Host synthesizes peer proposals. Zero data leaks off LAN.
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main className="main-viewport">
          {mode === "host" ? (
            <>
              {/* TAB: 3D Swarm Topology */}
              {hostTab === "topology" && (
                <div className="graph-container">
                  <NetworkGraph3D
                    hostName={swarmStatus?.host_name || "Host Orchestrator"}
                    hostIp={swarmStatus?.local_ip || "127.0.0.1"}
                    hostPort={swarmStatus?.gateway_port || 8000}
                    nodes={nodes}
                  />

                  {/* Overlay Stats */}
                  <div className="graph-overlay-stats">
                    <div className="graph-stat-pill">
                      <ShieldCheck size={16} color="#c084fc" />
                      <div>
                        <div style={{ fontSize: "10.5px", color: "#94a3b8" }}>
                          Orchestrator Core
                        </div>
                        <div style={{ fontWeight: 700 }}>
                          {swarmStatus?.host_name || "Host-Local"}
                        </div>
                      </div>
                    </div>

                    <div className="graph-stat-pill">
                      <Activity size={16} color="#06b6d4" />
                      <div>
                        <div style={{ fontSize: "10.5px", color: "#94a3b8" }}>
                          Sub-Agent Fleet
                        </div>
                        <div style={{ fontWeight: 700 }}>
                          {nodes.length} Nodes Connected
                        </div>
                      </div>
                    </div>

                    <div className="graph-stat-pill">
                      <Database size={16} color="#10b981" />
                      <div>
                        <div style={{ fontSize: "10.5px", color: "#94a3b8" }}>
                          Learned Shared Memory
                        </div>
                        <div style={{ fontWeight: 700 }}>
                          {swarmStatus?.session_memory_count || 0} Corrected Patterns
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Bottom Controls */}
                  <div className="graph-overlay-controls">
                    <button
                      className="cyber-btn cyber-btn-primary"
                      onClick={() => setHostTab("docs")}
                    >
                      <Sparkles size={14} />
                      <span>Test Swarm Query</span>
                    </button>
                  </div>
                </div>
              )}

              {/* TAB: Gateway & Endpoints */}
              {hostTab === "gateway" && (
                <div className="view-container">
                  <div className="view-header">
                    <div className="view-title-group">
                      <h1 className="view-title">
                        <Key size={22} color="#a855f7" />
                        Gateway & Access Endpoints
                      </h1>
                      <p className="view-subtitle">
                        Standard OpenAI-compatible inference endpoint and 6-digit
                        session PIN for worker authentication.
                      </p>
                    </div>
                  </div>

                  <div className="grid-3">
                    <div className="cyber-card highlight">
                      <div className="card-header">
                        <span className="card-title">
                          <Key size={16} color="#a855f7" />
                          OpenAI-Compatible Base URL
                        </span>
                        <span
                          className="copy-pill"
                          onClick={() =>
                            copyToClipboard(primaryEndpoint, "Base URL")
                          }
                        >
                          <Copy size={12} />
                          Copy
                        </span>
                      </div>
                      <input
                        type="text"
                        readOnly
                        className="cyber-input cyber-input-mono"
                        value={primaryEndpoint}
                      />
                      <div
                        style={{
                          fontSize: "11px",
                          color: "#94a3b8",
                          display: "flex",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <span className="q4-kv-badge">Port: 8000</span>
                        <span className="q4-kv-badge">Model: kiro-connect-moa</span>
                      </div>
                    </div>

                    <div className="cyber-card highlight">
                      <div className="card-header">
                        <span className="card-title">
                          <ShieldCheck size={16} color="#a855f7" />
                          Generated Host API Key
                        </span>
                        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                          <button
                            className="cyber-btn cyber-btn-secondary"
                            style={{ padding: "4px 8px", fontSize: "11px" }}
                            onClick={handleRotateApiKey}
                            title="Rotate to a new secure Host Swarm API Key"
                          >
                            <RefreshCw size={11} />
                            Rotate Key
                          </button>
                          <span
                            className="copy-pill"
                            onClick={() =>
                              copyToClipboard(
                                swarmStatus?.host_api_key || "",
                                "Host API Key"
                              )
                            }
                          >
                            <Copy size={12} />
                            Copy Key
                          </span>
                        </div>
                      </div>
                      <input
                        type="text"
                        readOnly
                        className="cyber-input cyber-input-mono"
                        value={swarmStatus?.host_api_key || "Loading..."}
                      />
                      <div style={{ fontSize: "11px", color: "#64748b" }}>
                        Required in Authorization: Bearer header for all calls. Click Rotate to revoke and generate a new key.
                      </div>
                    </div>

                    <div className="cyber-card">
                      <div className="card-header">
                        <span className="card-title">
                          <Radio size={16} color="#06b6d4" />
                          Worker 6-Digit PIN
                        </span>
                        <button
                          className="cyber-btn cyber-btn-secondary"
                          style={{ padding: "4px 8px", fontSize: "11px" }}
                          onClick={handleRefreshPin}
                        >
                          <RefreshCw size={12} />
                          Refresh
                        </button>
                      </div>
                      <div className="pin-display-cluster">
                        {(swarmStatus?.pairing_code || "123456")
                          .split("")
                          .map((digit, idx) => (
                            <div key={idx} className="pin-digit-box">
                              {digit}
                            </div>
                          ))}
                      </div>
                      <div
                        style={{
                          textAlign: "center",
                          fontSize: "11px",
                          color: "#64748b",
                        }}
                      >
                        Enter on Worker laptops to join this swarm
                      </div>
                    </div>
                  </div>

                  {/* Reachable LAN Adapters */}
                  {swarmStatus?.gateway_endpoints &&
                    swarmStatus.gateway_endpoints.length > 1 && (
                      <div className="cyber-card">
                        <span className="card-title">
                          <Wifi size={16} color="#06b6d4" />
                          All Reachable LAN Network Adapters
                        </span>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          {swarmStatus.gateway_endpoints.map((ep, i) => (
                            <button
                              key={i}
                              className="network-badge-btn"
                              onClick={() => copyToClipboard(ep, "LAN Endpoint")}
                            >
                              <Wifi size={12} color="#06b6d4" />
                              <span>{ep}</span>
                              <Copy size={12} color="#64748b" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              )}

              {/* TAB: Worker Fleet */}
              {hostTab === "fleet" && (
                <div className="view-container">
                  <div className="view-header">
                    <div className="view-title-group">
                      <h1 className="view-title">
                        <Activity size={22} color="#a855f7" />
                        Sub-Agent Swarm Fleet
                      </h1>
                      <p className="view-subtitle">
                        Connected worker nodes acting as sub-agents running local
                        models with Q4 KV caches.
                      </p>
                    </div>

                    <button
                      className="cyber-btn cyber-btn-primary"
                      onClick={handleRunBenchmark}
                      disabled={isBenchmarking || nodes.length === 0}
                    >
                      <Zap size={15} />
                      <span>
                        {isBenchmarking ? "Benchmarking..." : "Benchmark Fleet"}
                      </span>
                    </button>
                  </div>

                  <div className="cyber-card">
                    <table className="cyber-table">
                      <thead>
                        <tr>
                          <th>Sub-Agent Node</th>
                          <th>Role</th>
                          <th>Endpoint</th>
                          <th>Model</th>
                          <th>Speed</th>
                          <th>Latency</th>
                          <th>Divergence</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nodes.length === 0 ? (
                          <tr>
                            <td
                              colSpan={9}
                              style={{
                                textAlign: "center",
                                color: "#64748b",
                                padding: 24,
                              }}
                            >
                              No sub-agents currently connected. Launch host
                              engine or pair worker laptops.
                            </td>
                          </tr>
                        ) : (
                          nodes.map((node) => (
                            <tr key={node.id}>
                              <td style={{ fontWeight: 700, color: "#fff" }}>
                                {node.name}
                              </td>
                              <td>
                                <span
                                  className="q4-kv-badge"
                                  style={{
                                    borderColor: node.is_host_local
                                      ? "#8b5cf6"
                                      : "#06b6d4",
                                    color: node.is_host_local
                                      ? "#c084fc"
                                      : "#06b6d4",
                                  }}
                                >
                                  {node.is_host_local
                                    ? "Orchestrator"
                                    : "Sub-Agent"}
                                </span>
                              </td>
                              <td style={{ fontFamily: "monospace" }}>
                                {node.endpoint}
                              </td>
                              <td style={{ color: "#94a3b8" }}>{node.model}</td>
                              <td style={{ color: "#10b981", fontWeight: 600 }}>
                                {node.tokens_per_sec || 0} t/s
                              </td>
                              <td style={{ color: "#f8fafc" }}>
                                {node.last_latency_ms || 0} ms
                              </td>
                              <td>
                                <span
                                  style={{
                                    color:
                                      node.divergence_count > 0
                                        ? "#f43f5e"
                                        : "#64748b",
                                    fontWeight: 600,
                                  }}
                                >
                                  {node.divergence_count}
                                </span>
                              </td>
                              <td>
                                <span
                                  className={`status-chip ${
                                    node.status === "flagged"
                                      ? "offline"
                                      : "online"
                                  }`}
                                  style={{ padding: "3px 8px" }}
                                >
                                  {node.status}
                                </span>
                              </td>
                              <td>
                                {node.status === "flagged" && (
                                  <button
                                    className="cyber-btn cyber-btn-secondary"
                                    style={{
                                      padding: "4px 8px",
                                      fontSize: "11px",
                                    }}
                                    onClick={() => handleResetFlag(node.id)}
                                  >
                                    Restore
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Benchmark Results Display */}
                  {benchmarkResults.length > 0 && (
                    <div className="cyber-card">
                      <span className="card-title">
                        <Zap size={16} color="#f59e0b" />
                        Relative Fleet Performance
                      </span>
                      <div className="grid-3">
                        {benchmarkResults.map((r, i) => (
                          <div key={i} className="stat-box">
                            <span className="stat-box-label">{r.node_name}</span>
                            <span className="stat-box-val">
                              {r.tokens_per_sec} t/s
                            </span>
                            <span className="stat-box-sub">
                              Latency: {r.latency_ms} ms ({r.tokens} tokens)
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB: Model Engine */}
              {hostTab === "models" && (
                <div className="view-container">
                  <div className="view-header">
                    <div className="view-title-group">
                      <h1 className="view-title">
                        <Cpu size={22} color="#a855f7" />
                        Host Model & Engine Configuration
                      </h1>
                      <p className="view-subtitle">
                        Configure the stronger primary LLM model for the Host
                        Orchestrator with Q4 KV Cache.
                      </p>
                    </div>

                    <div style={{ display: "flex", gap: 10 }}>
                      {hostLlamaStatus?.running ? (
                        <button
                          className="cyber-btn cyber-btn-danger"
                          onClick={handleStopHostEngine}
                        >
                          <Square size={14} />
                          <span>Stop Host Engine</span>
                        </button>
                      ) : (
                        <button
                          className="cyber-btn cyber-btn-primary"
                          onClick={handleStartHostEngine}
                          disabled={isLlamaStarting || !selectedModelPath}
                        >
                          <Play size={14} />
                          <span>
                            {isLlamaStarting ? "Starting..." : "Start Host Engine"}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid-2">
                    {/* Discovered Models & Scanner */}
                    <div className="cyber-card">
                      <span className="card-title">
                        <FolderSearch size={16} color="#a855f7" />
                        Custom Directory Scanner & GGUF Models
                      </span>

                      <div className="input-group">
                        <label className="input-label">
                          <span>Custom Folder Path on Disk</span>
                        </label>
                        <div style={{ display: "flex", gap: 8 }}>
                          <input
                            type="text"
                            placeholder="e.g. C:\Models or D:\LLMs"
                            className="cyber-input"
                            value={customFolderPath}
                            onChange={(e) =>
                              setCustomFolderPath(e.target.value)
                            }
                          />
                          <button
                            className="cyber-btn cyber-btn-secondary"
                            onClick={handleScanFolder}
                            disabled={isScanningFolder}
                          >
                            <FolderSearch size={14} />
                            <span>
                              {isScanningFolder ? "Scanning..." : "Scan"}
                            </span>
                          </button>
                        </div>
                      </div>

                      <div className="input-group">
                        <label className="input-label">
                          <span>Select Active Model ({localModels.length} found)</span>
                        </label>
                        <select
                          className="cyber-select"
                          value={selectedModelPath}
                          onChange={(e) => setSelectedModelPath(e.target.value)}
                        >
                          {localModels.length === 0 ? (
                            <option value="">No GGUF models discovered</option>
                          ) : (
                            localModels.map((m) => (
                              <option key={m.path} value={m.path}>
                                {m.name} ({m.size_gb} GB)
                              </option>
                            ))
                          )}
                        </select>
                      </div>

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <span className="q4-kv-badge">KV Cache: Q4 Quantized</span>
                        <span className="q4-kv-badge">Host Port: 8081</span>
                      </div>
                    </div>

                    {/* Parameters & Runtime Status */}
                    <div className="cyber-card">
                      <span className="card-title">
                        <Layers size={16} color="#06b6d4" />
                        Engine Parameters & Runtime
                      </span>

                      <div className="input-group">
                        <label className="input-label">
                          <span>Context Window: {contextSize} tokens</span>
                        </label>
                        <input
                          type="range"
                          min="2048"
                          max="32768"
                          step="2048"
                          value={contextSize}
                          onChange={(e) =>
                            setContextSize(Number(e.target.value))
                          }
                          style={{ width: "100%", accentColor: "#8b5cf6" }}
                        />
                      </div>

                      <div className="input-group">
                        <label className="input-label">
                          <span>GPU Offload Layers (99 = full VRAM)</span>
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="99"
                          className="cyber-input"
                          value={gpuLayers}
                          onChange={(e) => setGpuLayers(Number(e.target.value))}
                        />
                      </div>

                      <div className="stat-box" style={{ marginTop: 8 }}>
                        <span className="stat-box-label">Runtime Engine Status</span>
                        <span className="stat-box-val" style={{ fontSize: "15px" }}>
                          {hostLlamaStatus?.running ? (
                            <span style={{ color: "#10b981" }}>
                              Online (PID: {hostLlamaStatus.pid}, Port:{" "}
                              {hostLlamaStatus.port})
                            </span>
                          ) : (
                            <span style={{ color: "#64748b" }}>Offline</span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: Shared Memory */}
              {hostTab === "memory" && (
                <div className="view-container">
                  <div className="view-header">
                    <div className="view-title-group">
                      <h1 className="view-title">
                        <Database size={22} color="#a855f7" />
                        Swarm Shared Memory State (Live ChromaDB)
                      </h1>
                      <p className="view-subtitle">
                        100% Live Vector Memory (No Mocks). Dynamically updated during the active session by the Host Orchestrator when any worker sub-agent diverges.
                      </p>
                    </div>

                    <button
                      className="cyber-btn cyber-btn-secondary"
                      onClick={handleClearMemory}
                      title="Clear session memory to prevent storage buildup"
                    >
                      <Trash2 size={14} color="#f43f5e" />
                      <span>Clear Session Storage</span>
                    </button>
                  </div>

                  <div className="grid-3">
                    <div className="stat-box">
                      <span className="stat-box-label">Corrected Triples</span>
                      <span className="stat-box-val">
                        {memoryCorrections.length}
                      </span>
                      <span className="stat-box-sub">
                        Active embeddings in ChromaDB
                      </span>
                    </div>

                    <div className="stat-box">
                      <span className="stat-box-label">Consensus Engine</span>
                      <span className="stat-box-val" style={{ color: "#10b981" }}>
                        Live Active
                      </span>
                      <span className="stat-box-sub">
                        Injected automatically into prompts
                      </span>
                    </div>

                    <div className="stat-box">
                      <span className="stat-box-label">Session Lifecycle</span>
                      <span className="stat-box-val" style={{ fontSize: "16px" }}>
                        Session-Scoped
                      </span>
                      <span className="stat-box-sub">
                        Pruned when cleared to save storage
                      </span>
                    </div>
                  </div>

                  <div className="cyber-card">
                    <span className="card-title">
                      <Clock size={16} color="#a855f7" />
                      Learned Mistake-to-Consensus Mappings ({memoryCorrections.length})
                    </span>

                    {memoryCorrections.length === 0 ? (
                      <div
                        style={{
                          textAlign: "center",
                          color: "#64748b",
                          padding: 24,
                        }}
                      >
                        No divergences recorded in this session yet. When a sub-agent makes a
                        mistake, the Host Orchestrator maps the wrong proposal against the verified
                        consensus truth in ChromaDB so other agents never repeat it.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {memoryCorrections.map((item, idx) => (
                          <div key={idx} className="stat-box">
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontWeight: 700, color: "#fff" }}>
                                Query: "{item.query}"
                              </span>
                              <span className="q4-kv-badge" style={{ color: "#c084fc", borderColor: "#8b5cf6" }}>
                                Agent: {item.agent_name || "Worker Node"}
                              </span>
                            </div>
                            <div style={{ color: "#f43f5e", fontSize: "12.5px", marginTop: 6 }}>
                              <strong>Identified Mistake to Avoid:</strong> {item.wrong_thing || item.wrong_answer}
                            </div>
                            <div style={{ color: "#10b981", fontSize: "12.5px", marginTop: 4 }}>
                              <strong>Verified Consensus Truth:</strong> {item.right_thing || item.correct_answer}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB: API Documentation */}
              {hostTab === "docs" && (
                <div className="view-container">
                  <div className="view-header">
                    <div className="view-title-group">
                      <h1 className="view-title">
                        <FileText size={22} color="#a855f7" />
                        OpenAI-Compatible API Documentation
                      </h1>
                      <p className="view-subtitle">
                        Consume the KIRO-Connect MoA inference swarm using any
                        standard OpenAI SDK or HTTP client.
                      </p>
                    </div>
                  </div>

                  {/* Access Parameters Card */}
                  <div className="cyber-card highlight">
                    <div className="grid-3">
                      <div>
                        <span className="stat-box-label">Base URL</span>
                        <div
                          style={{
                            fontFamily: "monospace",
                            fontWeight: 700,
                            marginTop: 4,
                            color: "#c084fc",
                          }}
                        >
                          {primaryEndpoint}
                        </div>
                      </div>
                      <div>
                        <span className="stat-box-label">Swarm API Key</span>
                        <div
                          style={{
                            fontFamily: "monospace",
                            fontWeight: 700,
                            marginTop: 4,
                            color: "#fff",
                          }}
                        >
                          {swarmStatus?.host_api_key || "kc-swarm-..."}
                        </div>
                      </div>
                      <div>
                        <span className="stat-box-label">Model Identifier</span>
                        <div
                          style={{
                            fontFamily: "monospace",
                            fontWeight: 700,
                            marginTop: 4,
                            color: "#06b6d4",
                          }}
                        >
                          kiro-connect-moa
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Language Selector & Code Snippet */}
                  <div className="cyber-card">
                    <div className="card-header">
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className={`cyber-btn ${
                            docActiveLang === "python"
                              ? "cyber-btn-primary"
                              : "cyber-btn-secondary"
                          }`}
                          style={{ padding: "6px 14px", fontSize: "12px" }}
                          onClick={() => setDocActiveLang("python")}
                        >
                          Python (OpenAI SDK)
                        </button>
                        <button
                          className={`cyber-btn ${
                            docActiveLang === "curl"
                              ? "cyber-btn-primary"
                              : "cyber-btn-secondary"
                          }`}
                          style={{ padding: "6px 14px", fontSize: "12px" }}
                          onClick={() => setDocActiveLang("curl")}
                        >
                          cURL / Bash
                        </button>
                        <button
                          className={`cyber-btn ${
                            docActiveLang === "ts"
                              ? "cyber-btn-primary"
                              : "cyber-btn-secondary"
                          }`}
                          style={{ padding: "6px 14px", fontSize: "12px" }}
                          onClick={() => setDocActiveLang("ts")}
                        >
                          TypeScript / Node.js
                        </button>
                      </div>

                      <button
                        className="code-copy-btn"
                        onClick={() => {
                          let textToCopy = "";
                          if (docActiveLang === "python") {
                            textToCopy = `from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${primaryEndpoint}",\n    api_key="${swarmStatus?.host_api_key || "YOUR_KEY"}"\n)\n\nresponse = client.chat.completions.create(\n    model="kiro-connect-moa",\n    messages=[\n        {"role": "user", "content": "How does local Mixture-of-Agents consensus prevent hallucinations?"}\n    ]\n)\nprint(response.choices[0].message.content)\n# Non-breaking swarm metadata\nprint("Consensus Confidence:", getattr(response, "kiro_confidence", 1.0))`;
                          } else if (docActiveLang === "curl") {
                            textToCopy = `curl -X POST ${primaryEndpoint}/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${swarmStatus?.host_api_key || "YOUR_KEY"}" \\\n  -d '{\n    "model": "kiro-connect-moa",\n    "messages": [{"role": "user", "content": "Explain local MoA swarms."}],\n    "temperature": 0.7\n  }'`;
                          } else {
                            textToCopy = `import OpenAI from "openai";\n\nconst openai = new OpenAI({\n  baseURL: "${primaryEndpoint}",\n  apiKey: "${swarmStatus?.host_api_key || "YOUR_KEY"}",\n});\n\nconst res = await openai.chat.completions.create({\n  model: "kiro-connect-moa",\n  messages: [{ role: "user", content: "Explain local MoA swarms." }],\n});\nconsole.log(res.choices[0].message.content);`;
                          }
                          copyToClipboard(textToCopy, "Code snippet");
                        }}
                      >
                        <Copy size={12} />
                        Copy Code
                      </button>
                    </div>

                    <div className="code-snippet-box">
                      {docActiveLang === "python" && (
                        <pre>
                          {`from openai import OpenAI

client = OpenAI(
    base_url="${primaryEndpoint}",
    api_key="${swarmStatus?.host_api_key || "YOUR_KEY"}"
)

response = client.chat.completions.create(
    model="kiro-connect-moa",
    messages=[
        {"role": "system", "content": "You are a decentralized LAN MoA inference swarm."},
        {"role": "user", "content": "How does local Mixture-of-Agents consensus prevent hallucinations?"}
    ],
    temperature=0.7,
    max_tokens=512
)

# Output final synthesized consensus response
print(response.choices[0].message.content)

# Swarm-specific metadata (non-breaking standard schema fields)
print("Consensus Confidence:", getattr(response, "kiro_confidence", 1.0))
print("Contributing Nodes:", getattr(response, "contributing_nodes", []))`}
                        </pre>
                      )}

                      {docActiveLang === "curl" && (
                        <pre>
                          {`curl -X POST ${primaryEndpoint}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${swarmStatus?.host_api_key || "YOUR_KEY"}" \\
  -d '{
    "model": "kiro-connect-moa",
    "messages": [
      {"role": "user", "content": "Explain how decentralized MoA inference works."}
    ],
    "temperature": 0.7,
    "max_tokens": 512,
    "stream": false
  }'`}
                        </pre>
                      )}

                      {docActiveLang === "ts" && (
                        <pre>
                          {`import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "${primaryEndpoint}",
  apiKey: "${swarmStatus?.host_api_key || "YOUR_KEY"}",
});

async function main() {
  const completion = await openai.chat.completions.create({
    model: "kiro-connect-moa",
    messages: [{ role: "user", content: "Explain how decentralized MoA inference works." }],
  });

  console.log(completion.choices[0].message.content);
}

main();`}
                        </pre>
                      )}
                    </div>
                  </div>

                  {/* Interactive Query Tester */}
                  <div className="cyber-card">
                    <span className="card-title">
                      <Code2 size={16} color="#06b6d4" />
                      Live Swarm Test Console
                    </span>

                    <div className="input-group">
                      <label className="input-label">
                        <span>Prompt to Test Consensus</span>
                      </label>
                      <textarea
                        rows={3}
                        className="cyber-input"
                        value={docPrompt}
                        onChange={(e) => setDocPrompt(e.target.value)}
                      />
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <button
                        className="cyber-btn cyber-btn-primary"
                        onClick={handleExecuteDocQuery}
                        disabled={isDocQueryRunning}
                      >
                        <Sparkles size={14} />
                        <span>
                          {isDocQueryRunning
                            ? "Swarm Inferencing..."
                            : "Execute Swarm Query"}
                        </span>
                      </button>
                    </div>

                    {docResponse && (
                      <div
                        style={{
                          background: "#08080d",
                          padding: 16,
                          borderRadius: 8,
                          border: "1px solid #1e1e2f",
                          display: "flex",
                          flexDirection: "column",
                          gap: 12,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <CheckCircle2 size={16} color="#10b981" />
                            <span style={{ fontWeight: 700, color: "#fff" }}>
                              Consensus Confidence:{" "}
                              {Math.round(
                                (docResponse.kiro_confidence || 1.0) * 100
                              )}
                              %
                            </span>
                          </div>
                          <span style={{ fontSize: "11px", color: "#64748b" }}>
                            Roundtrip: {docResponse.client_latency_ms} ms
                          </span>
                        </div>

                        <div
                          style={{
                            color: "#e2e8f0",
                            lineHeight: 1.6,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {docResponse.choices[0]?.message?.content}
                        </div>

                        {docResponse.contributing_nodes && (
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontSize: "11px", color: "#64748b" }}>
                              Participating Nodes:
                            </span>
                            {docResponse.contributing_nodes.map(
                              (name: string, i: number) => (
                                <span key={i} className="q4-kv-badge">
                                  {name}
                                </span>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* WORKER MODE VIEW */
            <div className="view-container">
              {/* TAB: Node Telemetry */}
              {workerTab === "telemetry" && (
                <>
                  <div className="view-header">
                    <div className="view-title-group">
                      <h1 className="view-title">
                        <Activity size={22} color="#06b6d4" />
                        Worker Sub-Agent Telemetry
                      </h1>
                      <p className="view-subtitle">
                        Local sub-agent node running a lightweight model to serve
                        the Host Orchestrator.
                      </p>
                    </div>
                  </div>

                  <div className="grid-3">
                    <div className="stat-box">
                      <span className="stat-box-label">Connection State</span>
                      <span
                        className="stat-box-val"
                        style={{
                          color: workerStatus?.is_paired ? "#10b981" : "#f43f5e",
                        }}
                      >
                        {workerStatus?.is_paired ? "Paired" : "Unpaired"}
                      </span>
                      <span className="stat-box-sub">
                        Host: {workerStatus?.host_name || "None"}
                      </span>
                    </div>

                    <div className="stat-box">
                      <span className="stat-box-label">Local Compute Port</span>
                      <span className="stat-box-val">
                        {workerStatus?.port || 8082}
                      </span>
                      <span className="stat-box-sub">
                        LAN Accessible (0.0.0.0)
                      </span>
                    </div>

                    <div className="stat-box">
                      <span className="stat-box-label">Tokens Generated</span>
                      <span className="stat-box-val">
                        {workerStatus?.tokens_generated || 0}
                      </span>
                      <span className="stat-box-sub">Contributed compute</span>
                    </div>
                  </div>
                </>
              )}

              {/* TAB: Compute Engine */}
              {workerTab === "compute" && (
                <>
                  <div className="view-header">
                    <div className="view-title-group">
                      <h1 className="view-title">
                        <Cpu size={22} color="#06b6d4" />
                        Worker Compute Engine
                      </h1>
                      <p className="view-subtitle">
                        Select and launch a lightweight GGUF model for this
                        worker sub-agent.
                      </p>
                    </div>
                  </div>

                  <div className="cyber-card">
                    <span className="card-title">
                      <Cpu size={16} color="#06b6d4" />
                      Select Local Worker Model
                    </span>

                    <div className="input-group">
                      <label className="input-label">
                        <span>Discovered GGUF Models</span>
                      </label>
                      <select
                        className="cyber-select"
                        value={workerModelPath}
                        onChange={(e) => setWorkerModelPath(e.target.value)}
                      >
                        {localModels.length === 0 ? (
                          <option value="">No models found</option>
                        ) : (
                          localModels.map((m) => (
                            <option key={m.path} value={m.path}>
                              {m.name} ({m.size_gb} GB)
                            </option>
                          ))
                        )}
                      </select>
                    </div>

                    <div style={{ display: "flex", gap: 10 }}>
                      <button
                        className="cyber-btn cyber-btn-cyan"
                        onClick={handleStartWorkerEngine}
                        disabled={isWorkerStarting || !workerModelPath}
                      >
                        <Play size={14} />
                        <span>
                          {isWorkerStarting ? "Starting..." : "Start Worker Engine"}
                        </span>
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* TAB: Pairing & Discovery */}
              {workerTab === "security" && (
                <>
                  <div className="view-header">
                    <div className="view-title-group">
                      <h1 className="view-title">
                        <Radio size={22} color="#06b6d4" />
                        Network Discovery & Pairing
                      </h1>
                      <p className="view-subtitle">
                        Discover Swarm Hosts on the LAN via mDNS or connect
                        manually using the 6-digit session PIN.
                      </p>
                    </div>

                    <button
                      className="cyber-btn cyber-btn-secondary"
                      onClick={scanWorkerHosts}
                      disabled={isScanningHosts}
                    >
                      <RefreshCw size={14} />
                      <span>{isScanningHosts ? "Scanning..." : "Scan LAN"}</span>
                    </button>
                  </div>

                  {/* Discovered Hosts */}
                  <div className="cyber-card highlight">
                    <span className="card-title">
                      <Wifi size={16} color="#06b6d4" />
                      Discovered Swarm Hosts on LAN ({discoveredHosts.length})
                    </span>

                    {discoveredHosts.length === 0 ? (
                      <div
                        style={{
                          textAlign: "center",
                          color: "#64748b",
                          padding: 16,
                        }}
                      >
                        No mDNS broadcast detected yet. Make sure the Host is
                        running on the same LAN, or enter the Host IP below.
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {discoveredHosts.map((h, i) => (
                          <div
                            key={i}
                            className="stat-box"
                            style={{
                              flex: 1,
                              minWidth: 220,
                              borderColor: "rgba(6, 182, 212, 0.4)",
                            }}
                          >
                            <span className="stat-box-label">{h.display_name || h.name || "Swarm Host"}</span>
                            <span
                              style={{
                                fontFamily: "monospace",
                                color: "#fff",
                                fontWeight: 700,
                                fontSize: "12px",
                              }}
                            >
                              {h.endpoint || `http://${h.ip}:${h.port}`}
                            </span>
                            <button
                              className="cyber-btn cyber-btn-cyan"
                              style={{
                                marginTop: 8,
                                padding: "4px 10px",
                                fontSize: "11px",
                              }}
                              onClick={() => {
                                const ep = h.endpoint || `http://${h.ip}:${h.port}`;
                                setWorkerHostIp(ep);
                                showToast(`Selected host: ${h.display_name || h.name || "Swarm Host"}`);
                              }}
                            >
                              Select Host
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Manual Pairing Form */}
                  <div className="cyber-card">
                    <span className="card-title">
                      <Key size={16} color="#a855f7" />
                      Authenticate with Host 6-Digit PIN
                    </span>

                    <div className="grid-2">
                      <div className="input-group">
                        <label className="input-label">
                          <span>Host Gateway Endpoint</span>
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. http://192.168.1.50:8000"
                          className="cyber-input"
                          value={workerHostIp}
                          onChange={(e) => setWorkerHostIp(e.target.value)}
                        />
                      </div>

                      <div className="input-group">
                        <label className="input-label">
                          <span>6-Digit Pairing PIN</span>
                        </label>
                        <input
                          type="text"
                          maxLength={6}
                          placeholder="e.g. 849201"
                          className="cyber-input cyber-input-mono"
                          value={workerPin}
                          onChange={(e) => setWorkerPin(e.target.value)}
                        />
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <button
                        className="cyber-btn cyber-btn-primary"
                        onClick={handleWorkerJoinSwarm}
                        disabled={isWorkerJoining || !workerHostIp || !workerPin}
                      >
                        <ShieldCheck size={14} />
                        <span>
                          {isWorkerJoining
                            ? "Authenticating..."
                            : "Pair & Join Swarm"}
                        </span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Floating Toast Feedback Banner */}
      {toastMessage && (
        <div className="toast-banner">
          <CheckCircle2 size={16} color="#a855f7" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
