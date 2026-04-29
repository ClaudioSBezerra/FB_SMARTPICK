import { useState, useRef, useEffect } from "react";
import * as THREE from "three";

// ── Types ──────────────────────────────────────────────────────────────────
interface Zone {
  label: string;
  color: string;
  ruas: number[];
  desc: string;
}

interface RuaData {
  rua: number;
  zone: string;
  color: string;
  picks: number;
  skus: number;
  ofensores: number;
  ocupacao: number;
  modulos: number;
  niveis: number;
}

interface WarehouseData {
  totalSKUs: number;
  totalPicks90d: number;
  ofensoresDistancia: number;
  pctClasseAemZonaA: number;
  ganhoEstimadoMetros: number;
  ruas: RuaData[];
}

type ViewMode = "zone" | "heatmap";

// ── Constants ──────────────────────────────────────────────────────────────
const ZONES: Zone[] = [
  { label: "A", color: "#22c55e", ruas: Array.from({ length: 10 }, (_, i) => i + 1),  desc: "Golden Zone — Próximo das docas" },
  { label: "B", color: "#eab308", ruas: Array.from({ length: 15 }, (_, i) => i + 11), desc: "Zona intermediária" },
  { label: "C", color: "#f97316", ruas: Array.from({ length: 15 }, (_, i) => i + 26), desc: "Zona distante" },
  { label: "D", color: "#ef4444", ruas: Array.from({ length: 10 }, (_, i) => i + 41), desc: "Zona crítica — Mais distante" },
];

// TODO: substituir por chamada real a /api/sp/abc/ruas e /api/sp/abc/dashboard
const MOCK_DATA: WarehouseData = {
  totalSKUs: 20694,
  totalPicks90d: 487320,
  ofensoresDistancia: 1847,
  pctClasseAemZonaA: 42,
  ganhoEstimadoMetros: 18.7,
  ruas: Array.from({ length: 50 }, (_, i) => {
    const rua = i + 1;
    const zone = ZONES.find(z => z.ruas.includes(rua))!;
    const basePicks =
      zone.label === "A" ? 3000 + Math.random() * 5000 :
      zone.label === "B" ? 1500 + Math.random() * 2500 :
      zone.label === "C" ? 500  + Math.random() * 1500 :
                           100  + Math.random() * 500;
    return {
      rua,
      zone: zone.label,
      color: zone.color,
      picks: Math.round(basePicks),
      skus: Math.round(30 + Math.random() * 120),
      ofensores: zone.label === "C" || zone.label === "D"
        ? Math.round(Math.random() * 25)
        : Math.round(Math.random() * 5),
      ocupacao: Math.round(40 + Math.random() * 55),
      modulos: 20,
      niveis: 5,
    };
  }),
};

// ── 3D Warehouse Scene ─────────────────────────────────────────────────────
interface Warehouse3DProps {
  selectedRua: number | null;
  onSelectRua: (rua: number) => void;
  viewMode: ViewMode;
}

interface RuaMesh {
  rua: number;
  meshL: THREE.Mesh;
  meshR: THREE.Mesh;
  data: RuaData;
}

interface SceneRefs {
  scene?: THREE.Scene;
  camera?: THREE.PerspectiveCamera;
  renderer?: THREE.WebGLRenderer;
  ruaMeshes?: RuaMesh[];
  highlightMesh?: THREE.Mesh | null;
}

function Warehouse3D({ selectedRua, onSelectRua, viewMode }: Warehouse3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneRefs>({});
  const animFrameRef = useRef<number>(0);

  // Init scene once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0a0f1a");
    scene.fog = new THREE.FogExp2("#0a0f1a", 0.003);

    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1000);
    camera.position.set(80, 60, 100);
    camera.lookAt(0, 0, -40);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Lights
    scene.add(new THREE.AmbientLight("#4466aa", 0.4));
    const dir = new THREE.DirectionalLight("#ffffff", 0.8);
    dir.position.set(50, 80, 30);
    dir.castShadow = true;
    scene.add(dir);
    const p1 = new THREE.PointLight("#22c55e", 0.3, 200);
    p1.position.set(-30, 30, -10);
    scene.add(p1);
    const p2 = new THREE.PointLight("#3b82f6", 0.3, 200);
    p2.position.set(60, 30, -80);
    scene.add(p2);

    // Floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 250),
      new THREE.MeshStandardMaterial({ color: "#111827", roughness: 0.9, metalness: 0.1 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(30, -0.5, -50);
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(200, 40, "#1e293b", "#1e293b");
    grid.position.set(30, -0.4, -50);
    scene.add(grid);

    // Dock
    const dock = new THREE.Mesh(
      new THREE.BoxGeometry(180, 0.3, 15),
      new THREE.MeshStandardMaterial({ color: "#1e40af", roughness: 0.5, metalness: 0.3 })
    );
    dock.position.set(30, 0.15, 30);
    scene.add(dock);

    for (let i = 0; i < 6; i++) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 3, 8),
        new THREE.MeshStandardMaterial({ color: "#3b82f6", emissive: "#1e40af", emissiveIntensity: 0.5 })
      );
      post.position.set(-50 + i * 32, 1.5, 37);
      scene.add(post);
    }

    for (let i = 0; i < 3; i++) {
      const truckBody = new THREE.Mesh(
        new THREE.BoxGeometry(8, 5, 4),
        new THREE.MeshStandardMaterial({ color: "#374151", roughness: 0.6 })
      );
      truckBody.position.set(-20 + i * 30, 2.5, 40);
      truckBody.castShadow = true;
      scene.add(truckBody);
      const cab = new THREE.Mesh(
        new THREE.BoxGeometry(3, 3.5, 4),
        new THREE.MeshStandardMaterial({ color: "#1f2937" })
      );
      cab.position.set(-20 + i * 30 + 5.5, 1.75, 40);
      scene.add(cab);
    }

    // Aisles
    const ruaMeshes: RuaMesh[] = [];
    const ruaSpacing = 3.2;
    const ruaWidth = 1.2;
    const normalHeight = 6;

    MOCK_DATA.ruas.forEach((ruaData) => {
      const idx = ruaData.rua - 1;
      const baseColor = new THREE.Color(ruaData.color);

      const matL = new THREE.MeshStandardMaterial({
        color: baseColor.clone(),
        roughness: 0.6,
        metalness: 0.2,
        transparent: true,
        opacity: 0.75,
      });
      const rackL = new THREE.Mesh(new THREE.BoxGeometry(ruaWidth, normalHeight, 80), matL);
      rackL.position.set(idx * ruaSpacing - 15, normalHeight / 2, -20);
      rackL.castShadow = true;
      rackL.receiveShadow = true;
      scene.add(rackL);

      const matR = matL.clone();
      const rackR = new THREE.Mesh(new THREE.BoxGeometry(ruaWidth, normalHeight, 80), matR);
      rackR.position.set(idx * ruaSpacing - 15 + ruaWidth + 0.5, normalHeight / 2, -20);
      rackR.castShadow = true;
      scene.add(rackR);

      for (let level = 1; level < 5; level++) {
        const shelf = new THREE.Mesh(
          new THREE.BoxGeometry(ruaWidth * 2 + 0.5, 0.05, 80),
          new THREE.MeshStandardMaterial({ color: "#475569", metalness: 0.5 })
        );
        shelf.position.set(idx * ruaSpacing - 15 + (ruaWidth + 0.5) / 2, (normalHeight / 5) * level, -20);
        scene.add(shelf);
      }

      if (ruaData.ofensores > 5) {
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(0.6, 12, 12),
          new THREE.MeshStandardMaterial({ color: "#ef4444", emissive: "#ef4444", emissiveIntensity: 0.8 })
        );
        marker.position.set(idx * ruaSpacing - 15 + ruaWidth / 2 + 0.25, normalHeight + 1.5, -20);
        scene.add(marker);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.8, 1.2, 16),
          new THREE.MeshBasicMaterial({ color: "#ef4444", transparent: true, opacity: 0.4, side: THREE.DoubleSide })
        );
        ring.position.copy(marker.position);
        ring.rotation.x = -Math.PI / 2;
        ring.userData = { pulse: true, baseScale: 1 };
        scene.add(ring);
      }

      ruaMeshes.push({ rua: ruaData.rua, meshL: rackL, meshR: rackR, data: ruaData });
    });

    // Zone boundary lines
    let prevZone: string | null = null;
    MOCK_DATA.ruas.forEach((ruaData, i) => {
      if (prevZone && prevZone !== ruaData.zone) {
        const line = new THREE.Mesh(
          new THREE.PlaneGeometry(0.1, 85),
          new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.2 })
        );
        line.rotation.x = -Math.PI / 2;
        line.position.set(i * ruaSpacing - 15 - ruaSpacing / 2, 0.05, -20);
        scene.add(line);
      }
      prevZone = ruaData.zone;
    });

    // Highlight placeholder (updated reactively)
    const hlMesh = new THREE.Mesh(
      new THREE.BoxGeometry(ruaWidth * 2 + 1.5, 0.2, 82),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.3 })
    );
    hlMesh.visible = false;
    scene.add(hlMesh);

    sceneRef.current = { scene, camera, renderer, ruaMeshes, highlightMesh: hlMesh };

    // Orbit controls
    let isDragging = false;
    let prevMouse = { x: 0, y: 0 };
    const orbitAngle = { theta: 0.6, phi: 0.7 };
    let orbitDist = 140;
    const orbitCenter = new THREE.Vector3(55, 0, -20);

    const updateCamera = () => {
      camera.position.x = orbitCenter.x + orbitDist * Math.sin(orbitAngle.theta) * Math.cos(orbitAngle.phi);
      camera.position.y = orbitCenter.y + orbitDist * Math.sin(orbitAngle.phi);
      camera.position.z = orbitCenter.z + orbitDist * Math.cos(orbitAngle.theta) * Math.cos(orbitAngle.phi);
      camera.lookAt(orbitCenter);
    };
    updateCamera();

    const onDown = (e: MouseEvent | TouchEvent) => {
      isDragging = true;
      const src = "touches" in e ? e.touches[0] : e;
      prevMouse = { x: src.clientX, y: src.clientY };
    };
    const onUp = () => { isDragging = false; };
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!isDragging) return;
      const src = "touches" in e ? e.touches[0] : e;
      orbitAngle.theta += (src.clientX - prevMouse.x) * 0.005;
      orbitAngle.phi = Math.max(0.15, Math.min(1.4, orbitAngle.phi + (src.clientY - prevMouse.y) * 0.005));
      prevMouse = { x: src.clientX, y: src.clientY };
      updateCamera();
    };
    const onWheel = (e: WheelEvent) => {
      orbitDist = Math.max(40, Math.min(300, orbitDist + e.deltaY * 0.1));
      updateCamera();
    };

    const raycaster = new THREE.Raycaster();
    const mouse2D = new THREE.Vector2();
    const onClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse2D.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse2D.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse2D, camera);
      const allMeshes = ruaMeshes.flatMap(r => [r.meshL, r.meshR]);
      const hits = raycaster.intersectObjects(allMeshes);
      if (hits.length > 0) {
        const found = ruaMeshes.find(r => r.meshL === hits[0].object || r.meshR === hits[0].object);
        if (found) onSelectRua(found.rua);
      }
    };

    const el = renderer.domElement;
    el.addEventListener("mousedown", onDown as EventListener);
    el.addEventListener("touchstart", onDown as EventListener);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
    window.addEventListener("mousemove", onMove as EventListener);
    window.addEventListener("touchmove", onMove as EventListener);
    el.addEventListener("wheel", onWheel);
    el.addEventListener("click", onClick);

    // Resize
    const onResize = () => {
      const nw = container.clientWidth;
      const nh = container.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener("resize", onResize);

    // Animate
    let time = 0;
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      time += 0.02;
      scene.traverse(obj => {
        if (obj.userData?.pulse) {
          const s = 1 + Math.sin(time * 3) * 0.3;
          obj.scale.set(s, s, 1);
          (obj as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.opacity = 0.2 + Math.sin(time * 3) * 0.2;
        }
      });
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      el.removeEventListener("mousedown", onDown as EventListener);
      el.removeEventListener("touchstart", onDown as EventListener);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
      window.removeEventListener("mousemove", onMove as EventListener);
      window.removeEventListener("touchmove", onMove as EventListener);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("click", onClick);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (container.contains(el)) container.removeChild(el);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update highlight when selectedRua changes (no scene rebuild)
  useEffect(() => {
    const { ruaMeshes, highlightMesh } = sceneRef.current;
    if (!ruaMeshes || !highlightMesh) return;
    if (selectedRua === null) {
      highlightMesh.visible = false;
      return;
    }
    const sel = ruaMeshes.find(r => r.rua === selectedRua);
    if (sel) {
      highlightMesh.position.set(sel.meshL.position.x + 1.2 / 2 + 0.25, 0.1, -20);
      highlightMesh.visible = true;
    }
  }, [selectedRua]);

  // Update materials when viewMode changes (no scene rebuild)
  useEffect(() => {
    const { ruaMeshes } = sceneRef.current;
    if (!ruaMeshes) return;
    const maxPicks = Math.max(...MOCK_DATA.ruas.map(r => r.picks));
    ruaMeshes.forEach(({ meshL, meshR, data }) => {
      const baseColor = new THREE.Color(data.color);
      const normalHeight = 6;
      const heatHeight = 2 + (data.picks / 8000) * 10;

      if (viewMode === "heatmap") {
        const matL = meshL.material as THREE.MeshStandardMaterial;
        const matR = meshR.material as THREE.MeshStandardMaterial;
        matL.opacity = matR.opacity = 0.85;
        matL.emissive = matR.emissive = baseColor.clone().multiplyScalar(0.3);
        matL.emissiveIntensity = matR.emissiveIntensity = data.picks / maxPicks;
        const scaleY = heatHeight / normalHeight;
        meshL.scale.y = meshR.scale.y = scaleY;
        meshL.position.y = meshR.position.y = heatHeight / 2;
      } else {
        const matL = meshL.material as THREE.MeshStandardMaterial;
        const matR = meshR.material as THREE.MeshStandardMaterial;
        matL.opacity = matR.opacity = 0.75;
        matL.emissiveIntensity = matR.emissiveIntensity = 0;
        meshL.scale.y = meshR.scale.y = 1;
        meshL.position.y = meshR.position.y = normalHeight / 2;
      }
    });
  }, [viewMode]);

  return (
    <div
      ref={mountRef}
      style={{ width: "100%", height: "100%", borderRadius: "12px", overflow: "hidden" }}
    />
  );
}

// ── KPI Card ───────────────────────────────────────────────────────────────
function KPICard({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent?: string }) {
  return (
    <div style={{
      background: "rgba(15,23,42,0.8)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "10px",
      padding: "14px 16px",
      minWidth: "150px",
      backdropFilter: "blur(10px)",
    }}>
      <div style={{ fontSize: "11px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "6px", fontFamily: "'JetBrains Mono', monospace" }}>
        {label}
      </div>
      <div style={{ fontSize: "24px", fontWeight: 700, color: accent ?? "#f8fafc", fontFamily: "'Space Grotesk', sans-serif" }}>
        {value}
        {unit && <span style={{ fontSize: "13px", color: "#64748b", marginLeft: "4px" }}>{unit}</span>}
      </div>
    </div>
  );
}

// ── Rua Detail Panel ───────────────────────────────────────────────────────
function RuaDetail({ rua, onClose }: { rua: number | null; onClose: () => void }) {
  if (!rua) return null;
  const data = MOCK_DATA.ruas.find(r => r.rua === rua);
  if (!data) return null;
  const zone = ZONES.find(z => z.ruas.includes(rua))!;

  return (
    <div style={{
      position: "absolute", top: "16px", right: "16px", width: "280px",
      background: "rgba(10,15,30,0.95)", border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "12px", padding: "20px", backdropFilter: "blur(20px)",
      zIndex: 10, fontFamily: "'Space Grotesk', sans-serif",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <div style={{ fontSize: "18px", fontWeight: 700, color: "#f8fafc" }}>
            Rua {String(rua).padStart(2, "0")}
          </div>
          <div style={{ fontSize: "12px", color: zone.color, fontWeight: 600 }}>
            Zona {zone.label} — {zone.desc.split("—")[0].trim()}
          </div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", fontSize: "20px", cursor: "pointer" }}>
          ✕
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {[
          { l: "Picks (90d)",              v: data.picks.toLocaleString("pt-BR"), c: zone.color },
          { l: "SKUs alocados",            v: String(data.skus),                  c: "#f8fafc" },
          { l: "Ofensores de distância",   v: String(data.ofensores),             c: data.ofensores > 5 ? "#ef4444" : "#22c55e" },
          { l: "Ocupação",                 v: `${data.ocupacao}%`,                c: data.ocupacao > 85 ? "#f97316" : "#22c55e" },
          { l: "Módulos",                  v: String(data.modulos),               c: "#f8fafc" },
          { l: "Níveis",                   v: String(data.niveis),                c: "#f8fafc" },
        ].map((item, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <span style={{ fontSize: "12px", color: "#94a3b8" }}>{item.l}</span>
            <span style={{ fontSize: "14px", fontWeight: 600, color: item.c, fontFamily: "'JetBrains Mono', monospace" }}>{item.v}</span>
          </div>
        ))}
      </div>

      {data.ofensores > 5 && (
        <div style={{
          marginTop: "16px", padding: "10px 12px",
          background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "8px",
        }}>
          <div style={{ fontSize: "11px", color: "#ef4444", fontWeight: 600 }}>⚠ ATENÇÃO</div>
          <div style={{ fontSize: "11px", color: "#fca5a5", marginTop: "4px" }}>
            {data.ofensores} SKUs de alta frequência nesta rua deveriam estar em zona mais próxima das docas.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function SpCurvaABC() {
  const [selectedRua, setSelectedRua] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("zone");

  const totalOfensores = MOCK_DATA.ruas.reduce((s, r) => s + r.ofensores, 0);
  const maxPicks = Math.max(...MOCK_DATA.ruas.map(r => r.picks));

  return (
    <div style={{
      width: "100%", height: "100vh", background: "#070b14",
      fontFamily: "'Space Grotesk', sans-serif", color: "#f8fafc",
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center",
        borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(10,15,30,0.9)",
        backdropFilter: "blur(10px)", flexShrink: 0, flexWrap: "wrap", gap: "12px",
      }}>
        <div>
          <div style={{ fontSize: "10px", color: "#3b82f6", fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>
            SmartPick
          </div>
          <div style={{ fontSize: "18px", fontWeight: 700, color: "#f8fafc" }}>
            Curva ABC de Endereços — Visão 3D do CD
          </div>
          <div style={{ fontSize: "11px", color: "#64748b" }}>
            Grupo Jorge Costa • Dados simulados (90 dias)
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          {(["zone", "heatmap"] as ViewMode[]).map(m => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              style={{
                padding: "6px 16px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer",
                border: viewMode === m ? "1px solid #3b82f6" : "1px solid rgba(255,255,255,0.1)",
                background: viewMode === m ? "rgba(59,130,246,0.15)" : "transparent",
                color: viewMode === m ? "#3b82f6" : "#94a3b8",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {m === "zone" ? "ZONAS ABC" : "HEATMAP"}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Strip */}
      <div style={{
        display: "flex", gap: "12px", padding: "12px 24px", overflowX: "auto",
        borderBottom: "1px solid rgba(255,255,255,0.04)", flexShrink: 0,
      }}>
        <KPICard label="Total SKUs"          value={MOCK_DATA.totalSKUs.toLocaleString("pt-BR")} />
        <KPICard label="Picks (90d)"         value={`${(MOCK_DATA.totalPicks90d / 1000).toFixed(0)}k`} accent="#3b82f6" />
        <KPICard label="Ofensores Distância" value={String(totalOfensores)} accent="#ef4444" />
        <KPICard label="Classe A em Zona A"  value={`${MOCK_DATA.pctClasseAemZonaA}%`} accent="#f97316" />
        <KPICard label="Ganho Estimado"      value={`−${MOCK_DATA.ganhoEstimadoMetros}%`} unit="dist." accent="#22c55e" />
      </div>

      {/* Main Area */}
      <div style={{ flex: 1, display: "flex", position: "relative", minHeight: 0 }}>
        {/* 3D Viewport */}
        <div style={{ flex: 1, position: "relative" }}>
          <Warehouse3D selectedRua={selectedRua} onSelectRua={setSelectedRua} viewMode={viewMode} />

          {/* Legend */}
          <div style={{
            position: "absolute", bottom: "16px", left: "16px",
            background: "rgba(10,15,30,0.9)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "10px", padding: "14px 18px", backdropFilter: "blur(10px)",
          }}>
            <div style={{ fontSize: "10px", color: "#64748b", fontWeight: 700, letterSpacing: "1.5px", marginBottom: "10px", fontFamily: "'JetBrains Mono', monospace" }}>
              ZONAS DO CD
            </div>
            {ZONES.map(z => (
              <div key={z.label} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                <div style={{ width: "12px", height: "12px", borderRadius: "3px", background: z.color, flexShrink: 0 }} />
                <span style={{ fontSize: "11px", color: "#cbd5e1" }}>
                  <strong style={{ color: z.color }}>Zona {z.label}</strong> — Ruas {z.ruas[0]}-{z.ruas[z.ruas.length - 1]} · {z.desc}
                </span>
              </div>
            ))}
            <div style={{ marginTop: "10px", display: "flex", alignItems: "center", gap: "6px" }}>
              <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#ef4444" }} />
              <span style={{ fontSize: "10px", color: "#fca5a5" }}>Ruas com ofensores de distância (&gt;5 SKUs)</span>
            </div>
          </div>

          {/* Dock label */}
          <div style={{
            position: "absolute", bottom: "16px", right: "16px",
            background: "rgba(30,64,175,0.3)", border: "1px solid rgba(59,130,246,0.3)",
            borderRadius: "8px", padding: "8px 14px",
          }}>
            <span style={{ fontSize: "11px", color: "#93c5fd", fontFamily: "'JetBrains Mono', monospace" }}>
              DOCAS DE CARREGAMENTO
            </span>
          </div>

          <div style={{
            position: "absolute", top: "16px", left: "16px",
            fontSize: "10px", color: "#475569", fontFamily: "'JetBrains Mono', monospace",
          }}>
            Arrastar = Orbitar · Scroll = Zoom · Click = Selecionar rua
          </div>

          <RuaDetail rua={selectedRua} onClose={() => setSelectedRua(null)} />
        </div>

        {/* Sidebar — picks por rua */}
        <div style={{
          width: "220px", borderLeft: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(10,15,30,0.6)", overflowY: "auto", padding: "12px 10px", flexShrink: 0,
        }}>
          <div style={{ fontSize: "10px", color: "#64748b", fontWeight: 700, letterSpacing: "1.5px", marginBottom: "10px", fontFamily: "'JetBrains Mono', monospace", padding: "0 4px" }}>
            PICKS POR RUA
          </div>
          {MOCK_DATA.ruas.map(r => {
            const pct = (r.picks / maxPicks) * 100;
            const isSelected = r.rua === selectedRua;
            return (
              <div
                key={r.rua}
                onClick={() => setSelectedRua(r.rua)}
                style={{
                  display: "flex", alignItems: "center", gap: "6px", padding: "3px 4px",
                  cursor: "pointer", borderRadius: "4px",
                  background: isSelected ? "rgba(59,130,246,0.1)" : "transparent",
                }}
              >
                <span style={{ fontSize: "9px", color: "#64748b", width: "22px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
                  {String(r.rua).padStart(2, "0")}
                </span>
                <div style={{ flex: 1, height: "8px", background: "rgba(255,255,255,0.04)", borderRadius: "4px", overflow: "hidden" }}>
                  <div style={{
                    width: `${pct}%`, height: "100%", borderRadius: "4px",
                    background: `linear-gradient(90deg, ${r.color}99, ${r.color})`,
                    transition: "width 0.3s ease",
                  }} />
                </div>
                {r.ofensores > 5 && <span style={{ fontSize: "8px", color: "#ef4444" }}>●</span>}
              </div>
            );
          })}
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 4px; }
      `}</style>
    </div>
  );
}
