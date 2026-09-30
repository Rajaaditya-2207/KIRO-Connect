import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";

export interface SwarmNode3D {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  hardware: string;
  status: "idle" | "busy" | "flagged";
  divergence_count: number;
  last_latency_ms: number;
  tokens_per_sec: number;
  is_host_local?: boolean;
}

interface NetworkGraph3DProps {
  hostName: string;
  hostIp: string;
  hostPort: number;
  nodes: SwarmNode3D[];
  onSelectNode?: (node: SwarmNode3D | null) => void;
}

export const NetworkGraph3D: React.FC<NetworkGraph3DProps> = ({
  hostName,
  hostIp,
  hostPort,
  nodes,
  onSelectNode,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredNode, setHoveredNode] = useState<{
    name: string;
    type: "host" | "worker";
    model?: string;
    status?: string;
    latency?: number;
    tps?: number;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 450;

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x08080c, 0.015);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.position.set(0, 22, 48);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // 2. Lighting - Purple & Ambient
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambientLight);

    const hostPointLight = new THREE.PointLight(0xa855f7, 4.5, 90);
    hostPointLight.position.set(0, 0, 0);
    scene.add(hostPointLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(20, 40, 20);
    scene.add(dirLight);

    // Grid Floor with subtle purple glow
    const grid = new THREE.GridHelper(80, 40, 0x8b5cf6, 0x1e1e2f);
    grid.position.y = -12;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.28;
    scene.add(grid);

    // 3. Central Host Orchestrator Object
    const hostGroup = new THREE.Group();
    scene.add(hostGroup);

    // Host Core Sphere (Neon Royal Purple)
    const hostGeo = new THREE.SphereGeometry(3.4, 32, 32);
    const hostMat = new THREE.MeshStandardMaterial({
      color: 0x8b5cf6,
      emissive: 0x6d28d9,
      emissiveIntensity: 0.7,
      roughness: 0.2,
      metalness: 0.85,
    });
    const hostMesh = new THREE.Mesh(hostGeo, hostMat);
    hostMesh.userData = { isHost: true, name: hostName || "Host Orchestrator" };
    hostGroup.add(hostMesh);

    // Host Wireframe Atmosphere Shield (Violet)
    const shieldGeo = new THREE.IcosahedronGeometry(4.4, 2);
    const shieldMat = new THREE.MeshBasicMaterial({
      color: 0xc084fc,
      wireframe: true,
      transparent: true,
      opacity: 0.3,
    });
    const shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
    hostGroup.add(shieldMesh);

    // Host Pulsing Orbit Rings
    const ringGeo = new THREE.RingGeometry(5.4, 5.7, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xa855f7,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.45,
    });
    const ringMesh1 = new THREE.Mesh(ringGeo, ringMat);
    ringMesh1.rotation.x = Math.PI / 2;
    hostGroup.add(ringMesh1);

    const ringMesh2 = new THREE.Mesh(ringGeo, ringMat.clone());
    ringMesh2.rotation.x = Math.PI / 4;
    ringMesh2.rotation.y = Math.PI / 6;
    hostGroup.add(ringMesh2);

    // 4. Worker Nodes & Connections
    const workerObjects: THREE.Mesh[] = [];
    const beamLines: {
      line: THREE.Line;
      particles: THREE.Points;
      particlePositions: Float32Array;
      curve: THREE.CatmullRomCurve3;
      progress: number[];
      speed: number;
    }[] = [];

    // Filter remote workers (exclude host local if already represented)
    const remoteWorkers = nodes.filter((n) => !n.is_host_local);
    const numWorkers = remoteWorkers.length;
    const orbitRadius = 24;

    remoteWorkers.forEach((worker, idx) => {
      const angle = (idx / Math.max(1, numWorkers)) * Math.PI * 2;
      const x = Math.cos(angle) * orbitRadius;
      const z = Math.sin(angle) * orbitRadius;
      const y = (Math.sin(angle * 2) * 4); // gentle 3D elevation variation

      // Worker color: Cyan/Emerald default, or Crimson if flagged
      const isFlagged = worker.status === "flagged";
      const isBusy = worker.status === "busy";
      const workerColor = isFlagged ? 0xf43f5e : 0x06b6d4;
      const emissiveColor = isFlagged ? 0x9f1239 : 0x0369a1;

      const workerGeo = new THREE.SphereGeometry(1.9, 24, 24);
      const workerMat = new THREE.MeshStandardMaterial({
        color: workerColor,
        emissive: emissiveColor,
        emissiveIntensity: isBusy ? 1.0 : 0.45,
        roughness: 0.25,
        metalness: 0.75,
      });
      const workerMesh = new THREE.Mesh(workerGeo, workerMat);
      workerMesh.position.set(x, y, z);
      workerMesh.userData = { isWorker: true, data: worker };
      scene.add(workerMesh);
      workerObjects.push(workerMesh);

      // Worker Orbital Ring
      const wRingGeo = new THREE.RingGeometry(2.5, 2.7, 32);
      const wRingMat = new THREE.MeshBasicMaterial({
        color: workerColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.35,
      });
      const wRing = new THREE.Mesh(wRingGeo, wRingMat);
      wRing.rotation.x = Math.PI / 2;
      workerMesh.add(wRing);

      // Curved Connection Line (CatmullRom)
      const midPoint = new THREE.Vector3(x * 0.5, (y + 0) * 0.5 + 4, z * 0.5);
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        midPoint,
        new THREE.Vector3(x, y, z),
      ]);

      const points = curve.getPoints(50);
      const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
      const lineMat = new THREE.LineBasicMaterial({
        color: isFlagged ? 0xf43f5e : 0xa855f7,
        transparent: true,
        opacity: isBusy ? 0.85 : 0.4,
        linewidth: 1.5,
      });
      const line = new THREE.Line(lineGeo, lineMat);
      scene.add(line);

      // Active Inference Particles along the Beam
      const particleCount = isBusy ? 6 : 3;
      const particleGeo = new THREE.BufferGeometry();
      const pPositions = new Float32Array(particleCount * 3);
      const progressArray: number[] = [];

      for (let p = 0; p < particleCount; p++) {
        progressArray.push(p / particleCount);
        const pt = curve.getPoint(progressArray[p]);
        pPositions[p * 3] = pt.x;
        pPositions[p * 3 + 1] = pt.y;
        pPositions[p * 3 + 2] = pt.z;
      }

      particleGeo.setAttribute("position", new THREE.BufferAttribute(pPositions, 3));
      const pMat = new THREE.PointsMaterial({
        color: isBusy ? 0xffffff : 0x06b6d4,
        size: isBusy ? 1.8 : 1.2,
        transparent: true,
        opacity: 0.95,
      });
      const particles = new THREE.Points(particleGeo, pMat);
      scene.add(particles);

      beamLines.push({
        line,
        particles,
        particlePositions: pPositions,
        curve,
        progress: progressArray,
        speed: isBusy ? 0.015 : 0.005,
      });
    });

    // 5. Interaction (Mouse Drag to Orbit, Raycaster Hover)
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2(-999, -999);
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };
    let cameraAngle = 0;

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (isDragging) {
        const deltaX = e.clientX - previousMousePosition.x;
        const deltaY = e.clientY - previousMousePosition.y;

        cameraAngle -= deltaX * 0.008;
        const distance = 48;
        camera.position.x = Math.sin(cameraAngle) * distance;
        camera.position.z = Math.cos(cameraAngle) * distance;
        camera.position.y = Math.max(5, Math.min(45, camera.position.y - deltaY * 0.15));
        camera.lookAt(0, 0, 0);

        previousMousePosition = { x: e.clientX, y: e.clientY };
      }
    };

    const onMouseUp = () => {
      isDragging = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = e.deltaY * 0.04;
      const currentDist = camera.position.length();
      const newDist = Math.max(20, Math.min(85, currentDist + zoomFactor));
      camera.position.setLength(newDist);
    };

    const onClick = () => {
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects([...workerObjects, hostMesh]);
      if (intersects.length > 0) {
        const obj = intersects[0].object;
        if (obj.userData.isWorker && onSelectNode) {
          onSelectNode(obj.userData.data);
        } else if (obj.userData.isHost && onSelectNode) {
          onSelectNode(null);
        }
      }
    };

    const domElement = renderer.domElement;
    domElement.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    domElement.addEventListener("wheel", onWheel, { passive: false });
    domElement.addEventListener("click", onClick);

    // 6. Animation Loop
    let animId: number;
    let clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      clock.getDelta();
      const elapsed = clock.getElapsedTime();

      // Slow orbital rotation for host rings
      ringMesh1.rotation.z += 0.006;
      ringMesh2.rotation.z -= 0.004;
      shieldMesh.rotation.y += 0.003;
      shieldMesh.rotation.x += 0.002;

      // Pulse Host Core
      const pulse = 1 + Math.sin(elapsed * 2.5) * 0.04;
      hostMesh.scale.set(pulse, pulse, pulse);

      // Animate Beam Particle Photons
      beamLines.forEach((beam) => {
        const positions = beam.particlePositions;
        for (let i = 0; i < beam.progress.length; i++) {
          beam.progress[i] = (beam.progress[i] + beam.speed) % 1.0;
          const pt = beam.curve.getPoint(beam.progress[i]);
          positions[i * 3] = pt.x;
          positions[i * 3 + 1] = pt.y;
          positions[i * 3 + 2] = pt.z;
        }
        beam.particles.geometry.attributes.position.needsUpdate = true;
      });

      // Raycaster for Hover HUD Tooltip
      if (!isDragging) {
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects([...workerObjects, hostMesh]);

        if (intersects.length > 0) {
          const topHit = intersects[0];
          const obj = topHit.object;
          const rect = domElement.getBoundingClientRect();
          const screenX = ((mouse.x + 1) / 2) * rect.width;
          const screenY = ((-mouse.y + 1) / 2) * rect.height;

          if (obj.userData.isHost) {
            setHoveredNode({
              name: obj.userData.name,
              type: "host",
              model: "Mixture-of-Agents Gateway",
              status: "Orchestrating",
              x: screenX,
              y: screenY,
            });
          } else if (obj.userData.isWorker) {
            const data: SwarmNode3D = obj.userData.data;
            setHoveredNode({
              name: data.name,
              type: "worker",
              model: data.model,
              status: data.status,
              latency: data.last_latency_ms,
              tps: data.tokens_per_sec,
              x: screenX,
              y: screenY,
            });
          }
        } else {
          setHoveredNode(null);
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    // 7. Resize Observer
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener("resize", handleResize);

    // 8. Cleanup
    return () => {
      cancelAnimationFrame(animId);
      domElement.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      domElement.removeEventListener("wheel", onWheel);
      domElement.removeEventListener("click", onClick);
      window.removeEventListener("resize", handleResize);

      if (container.contains(domElement)) {
        container.removeChild(domElement);
      }
      renderer.dispose();
    };
  }, [hostName, hostIp, hostPort, nodes]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* 3D Canvas Raycast Hover HUD Tooltip */}
      {hoveredNode && (
        <div
          style={{
            position: "absolute",
            left: `${hoveredNode.x + 14}px`,
            top: `${hoveredNode.y - 30}px`,
            pointerEvents: "none",
            zIndex: 40,
            background: "rgba(19, 19, 30, 0.94)",
            border: `1px solid ${
              hoveredNode.type === "host" ? "#8b5cf6" : "#06b6d4"
            }`,
            borderRadius: "8px",
            padding: "8px 12px",
            backdropFilter: "blur(12px)",
            boxShadow: `0 0 16px ${
              hoveredNode.type === "host"
                ? "rgba(139, 92, 246, 0.4)"
                : "rgba(6, 182, 212, 0.4)"
            }`,
            minWidth: "170px",
          }}
        >
          <div
            style={{
              fontWeight: 700,
              fontSize: "12.5px",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
            }}
          >
            <span>{hoveredNode.name}</span>
            <span
              style={{
                fontSize: "10px",
                padding: "1px 5px",
                borderRadius: "4px",
                background:
                  hoveredNode.type === "host"
                    ? "rgba(139, 92, 246, 0.2)"
                    : "rgba(6, 182, 212, 0.2)",
                color:
                  hoveredNode.type === "host" ? "#a855f7" : "#06b6d4",
              }}
            >
              {hoveredNode.type === "host" ? "ORCHESTRATOR" : "SUB-AGENT"}
            </span>
          </div>

          {hoveredNode.model && (
            <div
              style={{
                fontSize: "11px",
                color: "#94a3b8",
                marginTop: "3px",
                fontFamily: "monospace",
              }}
            >
              {hoveredNode.model}
            </div>
          )}

          {hoveredNode.type === "worker" && (
            <div
              style={{
                display: "flex",
                gap: "12px",
                marginTop: "6px",
                paddingTop: "6px",
                borderTop: "1px solid rgba(255,255,255,0.08)",
                fontSize: "11px",
              }}
            >
              <div>
                <span style={{ color: "#64748b" }}>Speed: </span>
                <span style={{ color: "#00e676", fontWeight: 600 }}>
                  {hoveredNode.tps || 0} t/s
                </span>
              </div>
              <div>
                <span style={{ color: "#64748b" }}>Latency: </span>
                <span style={{ color: "#f8fafc", fontWeight: 600 }}>
                  {hoveredNode.latency || 0} ms
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NetworkGraph3D;
