// rm_aim_sim_web — 页面逻辑：Three.js 渲染 + WebSocket 桥接客户端 + 手动/自瞄控制
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  Simulation, defaults, apply_robot, ROBOTS, PI, wrapf, clampf,
} from "./sim_core.js";

// RM 坐标 (x前 y左 z上) → three.js (x右 y上 z向观察者)：three = (rm.y, rm.z, -rm.x)
const rm2three = (p) => new THREE.Vector3(-p.y, p.z, -p.x); // 与原版 to_engine 逐字一致
const D2R = PI / 180;

const $ = (id) => document.getElementById(id);
const sim = new Simulation();
const publisher_id = `web-${Math.floor(Math.random() * 1e9)}`;
let publication = 0;

// ---------------- 控制状态 ----------------
const ipc = {
  bound: false, enabled: false, lastCommandSeq: -1, lastReceiveMs: 0,
  received: 0, rejected: 0, status: "本地手动控制", timeout: 0.25,
};
let demoEnabled = false;       // 本机自瞄控制
let aimHeld = false;           // 按住瞄准 (F)
let fireHeld = false;          // 按住发射 (Space)

// ---------------- 场景 ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.autoClear = false;
$("app").appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111e30); // 原版 world_view.gd 背景色

const cameraOrbit = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 200);
cameraOrbit.position.copy(rm2three({ x: -3.2, y: -3.6, z: 2.4 }));
const controls = new OrbitControls(cameraOrbit, renderer.domElement);
controls.target.set(0, 0.7, 0);

// 按靶车距离自动取景：让云台（原点）和远处靶车同时落在画面里。
// 距离变了才会重新取景，保留你手动转好的观察角度。
let framedDistance = -1;
function frameCamera(force = false) {
  const d = sim.settings.target.center.x;
  if (!force && Math.abs(d - framedDistance) < 1e-6) return;
  framedDistance = d;
  const mid = new THREE.Vector3(0, 0.7, -d / 2);            // RM (d/2, 0, 0.7) → three
  const dir = new THREE.Vector3().subVectors(cameraOrbit.position, controls.target);
  if (dir.lengthSq() < 1e-6) dir.set(0.7, 0.45, 0.62);
  dir.normalize();
  const dist = Math.max(d * 1.3, 3.8);
  controls.target.copy(mid);
  cameraOrbit.position.copy(mid).addScaledVector(dir, dist);
  controls.update();
}
const cameraFP = new THREE.PerspectiveCamera(45, 4 / 3, 0.02, 200);

scene.add(new THREE.HemisphereLight(0x8899bb, 0x223322, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(-4, 8, -6);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(32, 32),
  new THREE.MeshStandardMaterial({ color: 0x303030, roughness: 0.95 }));
ground.rotation.x = -PI / 2;
ground.position.set(0, -0.01, -5); // 原版: box(32,0.04,32) @ engine (0,-0.03,-5)
scene.add(ground);
const grid = new THREE.GridHelper(30, 30, 0x294455, 0x294455); // 1 m 间距，x ±15 / z -20~10，同原版
grid.position.z = -5;
scene.add(grid);

// ---------------- RM 坐标系可视化（与原版 coordinate_overlay.gd 一致） ----------------
// 颜色约定同原版：X 红(前) / Y 绿(左) / Z 蓝(上)，单位 m
const FRAME_COLORS = [0xff665c, 0x67e67e, 0x6daaff];
const FRAME_SPECS = [["O", 0.8], ["G", 0.4], ["C", 0.22], ["M", 0.16]];
const frameVisibility = { O: true, G: false, C: false, M: false };
function frameLabel(text, colorHex) {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 64;
  const g = c.getContext("2d");
  g.font = "bold 44px 'PingFang SC', sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillStyle = "#" + colorHex.toString(16).padStart(6, "0");
  g.fillText(text, 64, 34);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  sp.renderOrder = 999;
  sp.scale.set(0.14, 0.07, 1);
  return sp;
}
const frameObjs = {};
for (const [key, len] of FRAME_SPECS) {
  const grp = new THREE.Group();
  const lines = [], labels = [];
  for (let a = 0; a < 3; a++) {
    const geo = new THREE.BufferGeometry().setFromPoints(
      [new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: FRAME_COLORS[a], depthTest: false, transparent: true }));
    line.renderOrder = 998;
    grp.add(line); lines.push(line);
    const lab = frameLabel(`${key}.${"XYZ"[a]}`, FRAME_COLORS[a]);
    grp.add(lab); labels.push(lab);
  }
  grp.visible = false;
  scene.add(grp);
  frameObjs[key] = { grp, lines, labels, len };
}
// 原版 _frame()：origin + 三根 RM 方向轴（x/y/z 均为 RM 系单位向量）
function setRmFrame(key, origin, x, y, z) {
  const o = frameObjs[key];
  o.grp.position.copy(rm2three(origin));
  const dirs = [x, y, z];
  for (let a = 0; a < 3; a++) {
    const end = rm2three({
      x: dirs[a].x * o.len, y: dirs[a].y * o.len, z: dirs[a].z * o.len });
    o.lines[a].geometry.setFromPoints([new THREE.Vector3(), end]);
    o.labels[a].position.copy(end);
  }
  o.grp.visible = $("showcoords").checked && frameVisibility[key];
}
const V0 = { x: 1, y: 0, z: 0 }, V1 = { x: 0, y: 1, z: 0 }, V2 = { x: 0, y: 0, z: 1 };
const NEG = (v) => ({ x: -v.x, y: -v.y, z: -v.z });
function updateRmFrames() {
  const origin = sim.settings.gimbal.origin;
  const cp = sim.cameraPose();          // forward/right/up（RM 系）
  const left = NEG(cp.right);
  setRmFrame("O", origin, V0, V1, V2);                            // 固定轴
  setRmFrame("G", origin, cp.forward, left, cp.up);               // 随云台
  setRmFrame("C", cp.origin, cp.right, NEG(cp.up), cp.forward);   // 相机光学系：x右/y下/z前
  const bl = sim.settings.gimbal.barrel_length;
  setRmFrame("M",
    { x: origin.x + cp.forward.x * bl, y: origin.y + cp.forward.y * bl, z: origin.z + cp.forward.z * bl },
    cp.forward, left, cp.up);                                     // 枪口
}

// ---------------- 地面距离标记（1 m ~ 10 m） ----------------
const markerGroup = new THREE.Group();
scene.add(markerGroup);
function makeGroundLabel(text) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 128;
  const g = c.getContext("2d");
  g.font = "bold 64px 'PingFang SC', sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillStyle = "#709299"; // 原版 _build_grid 的标记颜色
  g.fillText(text, 128, 64);
  const tex = new THREE.CanvasTexture(c);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.45),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  mesh.rotation.x = -PI / 2; // 平铺于地面，字顶朝向 -z（前方），同原版 rotation_degrees.x=-90
  return mesh;
}
for (const d of [2, 4, 6, 8, 10]) {
  const m = makeGroundLabel(`${d} m`);
  m.position.set(1.0, 0.01, -d); // 原版 world_view.gd: Vector3(1.0, 0.01, -distance)
  markerGroup.add(m);
}

// ---------------- 我方云台机器人 ----------------
const robotRoot = new THREE.Group();
robotRoot.position.copy(rm2three(sim.settings.gimbal.origin));
scene.add(robotRoot);
const chassis = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.18, 0.6),
  new THREE.MeshStandardMaterial({ color: 0x2b3140, roughness: 0.6, metalness: 0.3 }));
chassis.position.y = -0.56;
robotRoot.add(chassis);
const yawGroup = new THREE.Group();
robotRoot.add(yawGroup);
const turret = new THREE.Mesh(
  new THREE.BoxGeometry(0.24, 0.16, 0.26),
  new THREE.MeshStandardMaterial({ color: 0x39414f, roughness: 0.5, metalness: 0.4 }));
turret.position.y = 0.04;
yawGroup.add(turret);
const pitchGroup = new THREE.Group();
pitchGroup.position.y = 0.04;
yawGroup.add(pitchGroup);
const barrel = new THREE.Mesh(
  new THREE.CylinderGeometry(0.022, 0.022, sim.settings.gimbal.barrel_length, 16),
  new THREE.MeshStandardMaterial({ color: 0x11141a, roughness: 0.4, metalness: 0.6 }));
barrel.rotation.x = PI / 2;
barrel.position.z = -sim.settings.gimbal.barrel_length / 2;
pitchGroup.add(barrel);
const camBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.06, 0.05, 0.05),
  new THREE.MeshStandardMaterial({ color: 0x0c0e12, emissive: 0x222244 }));
camBox.position.set(0, 0.04, -0.08);
pitchGroup.add(camBox);

// ---------------- 目标装甲模块 ----------------
const targetGroup = new THREE.Group();
scene.add(targetGroup);
const armorMeshes = [];
let armorTeamColor = 0x0028ff;

function makeNumberTexture(number, team) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = team === "red" ? "#7a0c05" : "#04207a";
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = team === "red" ? "#ff1000" : "#0028ff";
  g.lineWidth = 8;
  g.strokeRect(6, 6, 116, 116);
  g.fillStyle = "#fff";
  g.font = "bold 84px sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(number, 64, 70);
  return new THREE.CanvasTexture(c);
}

function buildTarget() {
  for (const m of armorMeshes) {
    targetGroup.remove(m.root);
    m.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
  armorMeshes.length = 0;
  const t = sim.settings.target;
  const sticker = makeNumberTexture(ROBOTS[sim.settings.appearance.robot].number, sim.settings.appearance.team);
  for (let i = 0; i < 4; i++) {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(
      new THREE.BoxGeometry(t.module_width, t.module_height, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.7 })));
    const img = new THREE.Mesh(
      new THREE.PlaneGeometry(t.armor_width * 0.92, t.armor_height * 0.92),
      new THREE.MeshBasicMaterial({ map: sticker }));
    img.position.z = 0.011;
    root.add(img);
    const barGeo = new THREE.BoxGeometry(0.012, t.lightbar_length, 0.012);
    const mats = [];
    for (const side of [-1, 1]) {
      const mat = new THREE.MeshStandardMaterial({
        color: armorTeamColor, emissive: armorTeamColor, emissiveIntensity: 2.0 });
      const bar = new THREE.Mesh(barGeo, mat);
      bar.position.set(side * t.lightbar_spacing * 0.5, 0, 0.014);
      root.add(bar);
      mats.push(mat);
    }
    targetGroup.add(root);
    armorMeshes.push({ root, mats });
  }
}
buildTarget();

// ---------------- 弹丸与命中特效 ----------------
const bulletGeo = new THREE.SphereGeometry(0.0085, 8, 8);
const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffd54a });
const bulletPool = [];
for (let i = 0; i < 256; i++) {
  const m = new THREE.Mesh(bulletGeo, bulletMat);
  m.visible = false;
  scene.add(m);
  bulletPool.push(m);
}
const flashPool = [];
let lastImpactId = -1;
function spawnFlash(point, color) {
  const mat = new THREE.SpriteMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false });
  const s = new THREE.Sprite(mat);
  s.position.copy(rm2three({ x: point[0], y: point[1], z: point[2] }));
  s.scale.setScalar(0.05);
  scene.add(s);
  flashPool.push({ sprite: s, born: performance.now() });
}

// ---------------- 设置应用 ----------------
function currentSettingsFromUI() {
  const s = JSON.parse(JSON.stringify(sim.settings));
  s.appearance.team = "blue";
  s.appearance.robot = $("robot").value;
  const hp = parseInt($("hp").value, 10);
  s.target.max_health = hp > 0 ? hp : -1; // 0 = 使用车型预设血量
  s.target.center.x = parseFloat($("dist").value) || 4;
  s.target.position_offset.y = parseFloat($("offy").value) || 0;
  s.target.position_offset.z = parseFloat($("offz").value) || 0;
  s.target.translate = $("translate").checked;
  s.target.speed = parseFloat($("tspeed").value) || 1;
  s.target.acceleration = parseFloat($("taccel").value) || 3;
  s.target.travel = parseFloat($("ttravel").value) || 1.5;
  s.target.heading = (parseFloat($("theading").value) || 90) * D2R;
  s.target.rotate = $("rotate").checked;
  s.target.omega = parseFloat($("romega").value) || 4;
  s.target.phase = (parseFloat($("rphase").value) || 180) * D2R;
  s.gimbal.ideal = sim.settings.gimbal.ideal; // 理想云台不在 UI 暴露，保持当前
  s.weapon.speed = clampf(parseFloat($("wspeed").value) || 23, 5, 40);
  s.weapon.damage = Math.round(clampf(parseFloat($("wdamage").value) || 20, 1, 200));
  return s;
}
function onSettingChange() {
  const s = currentSettingsFromUI();
  const robotChanged = s.appearance.robot !== sim.settings.appearance.robot;
  const teamChanged = s.appearance.team !== sim.settings.appearance.team;
  if (robotChanged) apply_robot(s.target, s.appearance.robot);
  sim.applySettings(s, robotChanged || teamChanged);
  if (robotChanged || teamChanged) {
    armorTeamColor = s.appearance.team === "red" ? 0xff1000 : 0x0028ff;
    buildTarget();
  }
  frameCamera();
}
for (const id of ["robot", "hp", "dist", "offy", "offz", "translate", "rotate",
  "tspeed", "taccel", "ttravel", "theading", "romega", "rphase", "wspeed", "wdamage"]) {
  $(id).addEventListener("change", onSettingChange);
}
$("btn-zero").addEventListener("click", () => {
  $("offy").value = 0; $("offz").value = 0; onSettingChange(); toast("装甲位置偏移已归零");
});
$("btn-trans-params").addEventListener("click", () => {
  const box = $("translate-box");
  box.classList.toggle("hidden");
  $("btn-trans-params").textContent = box.classList.contains("hidden") ? "▶ 平移参数（展开）" : "▼ 平移参数（收起）";
});
$("btn-rot-params").addEventListener("click", () => {
  const box = $("rotate-box");
  box.classList.toggle("hidden");
  $("btn-rot-params").textContent = box.classList.contains("hidden") ? "▶ 自转参数（展开）" : "▼ 自转参数（收起）";
});
$("showcoords").addEventListener("change", () => {
  $("frame-toggles").style.display = $("showcoords").checked ? "flex" : "none";
});
for (const [id, key] of [["frame-o", "O"], ["frame-g", "G"], ["frame-c", "C"], ["frame-m", "M"]]) {
  $(id).addEventListener("change", () => { frameVisibility[key] = $(id).checked; });
}
$("showmarkers").addEventListener("change", () => { markerGroup.visible = $("showmarkers").checked; });
$("showcorners").addEventListener("change", () => { $("corners").style.display = $("showcorners").checked ? "block" : "none"; });
$("showpip").addEventListener("change", () => { $("pip").style.display = $("showpip").checked ? "block" : "none"; });

// ---------------- 手动 / 自瞄控制 ----------------
function localControlStep() {
  // 外部控制时完全交给 ROS 指令
  if (ipc.enabled) return;
  if (demoEnabled) { demoAimStep(); return; }
  if (aimHeld) {
    // 按住瞄准：云台自动瞄准最优可见装甲（不开火，开火用 Space）
    const ok = aimAssistStep(false);
    if (ok) return;
  }
  const yaw = (parseFloat($("man-yaw").value) || 0) * D2R;
  const pitch = (parseFloat($("man-pitch").value) || 0) * D2R; // 上负（下正），与原版 main.gd 一致
  sim.setCommand({ control: true, fire: fireHeld, yaw, pitch });
}

function aimAssistStep(allowFire) {
  const obs = sim.cameraObservation();
  if (!obs.armors.length) { sim.setCommand({ control: false, fire: false, yaw: sim.yaw, pitch: sim.pitch }); return false; }
  const id = obs.armors[0].id;
  const armor = sim.armorPose(id, sim.time);
  const w = sim.settings.weapon;
  const g = sim.settings.gimbal.origin;
  let tf = Math.hypot(armor.center.x - g.x, armor.center.y - g.y) / w.speed, pitchUp = 0;
  for (let k = 0; k < 12; k++) {
    pitchUp = Math.atan2(armor.center.z - g.z + 0.5 * w.gravity * tf * tf, Math.hypot(armor.center.x - g.x, armor.center.y - g.y));
    tf = Math.hypot(armor.center.x - g.x, armor.center.y - g.y) / (w.speed * Math.cos(pitchUp));
  }
  const yawErr = Math.abs(wrapf(Math.atan2(armor.center.y, armor.center.x) - sim.yaw, -PI, PI));
  sim.setCommand({ control: true, fire: allowFire && yawErr < 0.012, yaw: Math.atan2(armor.center.y, armor.center.x), pitch: -pitchUp });
  return true;
}

const demo = { prev: null, prevT: -1 };
function demoAimStep() {
  if (sim.paused) { demo.prev = null; return; }
  const obs = sim.cameraObservation();
  if (!obs.armors.length) {
    sim.setCommand({ control: false, fire: false, yaw: sim.yaw, pitch: sim.pitch });
    demo.prev = null;
    return;
  }
  const id = obs.armors[0].id;
  const armor = sim.armorPose(id, sim.time);
  const w = sim.settings.weapon;
  const g = sim.settings.gimbal.origin;
  const vx = demo.prev ? (armor.center.x - demo.prev.x) / (sim.time - demo.prevT) : 0;
  const vy = demo.prev ? (armor.center.y - demo.prev.y) / (sim.time - demo.prevT) : 0;
  const tFly0 = Math.hypot(armor.center.x - g.x, armor.center.y - g.y) / w.speed;
  const tx = armor.center.x + vx * tFly0, ty = armor.center.y + vy * tFly0;
  const dxy = Math.hypot(tx - g.x, ty - g.y);
  let tf = dxy / w.speed, pitchUp = 0;
  for (let k = 0; k < 12; k++) {
    pitchUp = Math.atan2(armor.center.z - g.z + 0.5 * w.gravity * tf * tf, dxy);
    tf = dxy / (w.speed * Math.cos(pitchUp));
  }
  const yawTarget = Math.atan2(ty, tx);
  const pitchTarget = -pitchUp;
  const yawErr = Math.abs(wrapf(yawTarget - sim.yaw, -PI, PI));
  const pitchErr = Math.abs(pitchTarget - sim.pitch);
  const fire = yawErr < 0.012 && pitchErr < 0.012;
  sim.setCommand({ control: true, fire, yaw: yawTarget, pitch: pitchTarget });
  demo.prev = { x: armor.center.x, y: armor.center.y };
  demo.prevT = sim.time;
}

$("demo").addEventListener("change", () => {
  demoEnabled = $("demo").checked;
  if (demoEnabled && ipc.enabled) { $("extctl").checked = false; ipc.enabled = false; }
  if (!demoEnabled) sim.stop();
});
const bindHold = (btn, set) => {
  btn.addEventListener("mousedown", () => set(true));
  addEventListener("mouseup", () => set(false));
  btn.addEventListener("mouseleave", () => set(false));
};
bindHold($("btn-aim"), (v) => { aimHeld = v; $("btn-aim").classList.toggle("holding", v); });
bindHold($("btn-fire"), (v) => { fireHeld = v; $("btn-fire").classList.toggle("holding", v); });

$("extctl").addEventListener("change", () => {
  ipc.enabled = $("extctl").checked;
  if (ipc.enabled) {
    sim.session_id = `${Date.now() * 1000}-${Math.floor(Math.random() * 2 ** 31)}`;
    $("demo").checked = false; demoEnabled = false;
  }
  ipc.lastCommandSeq = -1;
  ipc.lastReceiveMs = 0;
  sim.stop();
  ipc.status = ipc.enabled ? "等待外部指令" : "本地手动控制";
});

// ---------------- 暂停 / 重置 / 视角 / 按键 ----------------
function doReset() {
  sim.reset();
  lastImpactId = -1;
  toast("已重置：恢复血量、清空统计、更新 session");
}
function togglePause() {
  sim.paused = !sim.paused;
  $("btn-pause").textContent = sim.paused ? "P 继续" : "P 暂停";
}
$("btn-reset").addEventListener("click", doReset);
$("btn-pause").addEventListener("click", togglePause);
let viewMode = "orbit";
function toggleView() {
  viewMode = viewMode === "orbit" ? "fp" : "orbit";
}
addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.key === "p" || e.key === "P") togglePause();
  if (e.key === "r" || e.key === "R") doReset();
  if (e.key === "v" || e.key === "V") toggleView();
  if (e.key === "f" || e.key === "F") { aimHeld = true; $("btn-aim").classList.add("holding"); }
  if (e.code === "Space") { e.preventDefault(); fireHeld = true; $("btn-fire").classList.add("holding"); }
});
addEventListener("keyup", (e) => {
  if (e.key === "f" || e.key === "F") { aimHeld = false; $("btn-aim").classList.remove("holding"); }
  if (e.code === "Space") { fireHeld = false; $("btn-fire").classList.remove("holding"); }
});
addEventListener("resize", () => {
  cameraOrbit.aspect = innerWidth / innerHeight;
  cameraOrbit.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = 0; }, 2200);
}

// ---------------- WebSocket 桥接客户端 ----------------
let ws = null;
function wsConnect() {
  const url = $("wsurl").value.trim();
  try { ws = new WebSocket(url); } catch { scheduleReconnect(); return; }
  ws.onopen = () => { ipc.bound = true; toast("已连接 ROS 2 桥接"); };
  ws.onclose = () => { ipc.bound = false; ws = null; scheduleReconnect(); };
  ws.onerror = () => { try { ws && ws.close(); } catch {} };
  ws.onmessage = (ev) => {
    let packet;
    try { packet = JSON.parse(ev.data); } catch { return; }
    if (packet.type === "command") acceptCommand(packet);
  };
}
function scheduleReconnect() {
  setTimeout(() => { if (!ws) wsConnect(); }, 2000);
}
$("wsurl").addEventListener("change", () => {
  if (ws) { try { ws.close(); } catch {} ws = null; }
  wsConnect();
});
wsConnect();
frameCamera(true);   // 首帧就按当前距离取景

function acceptCommand(v) {
  let valid = ipc.enabled && !sim.paused &&
    v.protocol === "rm_aim_sim/2" && v.type === "command" &&
    v.session_id === sim.session_id;
  const seq = v.seq;
  if (typeof seq !== "number" || !Number.isFinite(seq) || seq !== Math.floor(seq) ||
    seq < 0 || seq > 9007199254740991 || seq <= ipc.lastCommandSeq) valid = false;
  for (const name of ["control", "fire"]) if (typeof v[name] !== "boolean") valid = false;
  for (const name of ["yaw", "pitch", "yaw_vel", "pitch_vel", "yaw_acc", "pitch_acc"]) {
    const num = v[name] === undefined ? 0.0 : v[name];
    if (typeof num !== "number" || !Number.isFinite(num) || Math.abs(num) > 1000.0) valid = false;
  }
  if (!("yaw" in v) || !("pitch" in v)) valid = false;
  if (!valid) { ipc.rejected += 1; return false; }
  sim.setCommand({
    control: v.control, fire: v.fire, yaw: v.yaw, pitch: v.pitch,
    yaw_vel: v.yaw_vel || 0, pitch_vel: v.pitch_vel || 0, yaw_acc: v.yaw_acc || 0, pitch_acc: v.pitch_acc || 0,
  });
  ipc.lastCommandSeq = seq;
  ipc.lastReceiveMs = performance.now();
  ipc.received += 1;
  ipc.status = `外部控制 · seq ${seq}`;
  return true;
}
function checkCommandTimeout() {
  if (ipc.enabled && ipc.lastReceiveMs > 0 &&
    (performance.now() - ipc.lastReceiveMs) / 1000 > ipc.timeout) {
    sim.stop();
    ipc.lastReceiveMs = 0;
    ipc.status = "指令超时 · 已停止控制和发射";
  }
}
function publishState() {
  publication += 1;
  const state = sim.snapshot();
  state.wall_unix_sec = Date.now() / 1000;
  state.publication = publication;
  state.publisher_id = publisher_id;
  state.ipc = {
    enabled: ipc.enabled, status: ipc.status,
    last_seq: ipc.lastCommandSeq, received: ipc.received, rejected: ipc.rejected,
  };
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(state));
}

// ---------------- HUD ----------------
const fmt = (v, d = 2) => Number(v).toFixed(d);
let frames = 0, fpsLast = performance.now(), fpsValue = 0;

function updateHUD() {
  frames++;
  const now = performance.now();
  if (now - fpsLast >= 500) {
    fpsValue = Math.round(frames * 1000 / (now - fpsLast));
    frames = 0; fpsLast = now;
  }
  $("st-run").textContent = sim.paused ? "PAUSED" : "RUNNING";
  $("st-run").style.color = sim.paused ? "var(--warn)" : "var(--ok)";
  $("st-time").textContent = `T ${fmt(sim.time)}s`;
  $("st-fps").textContent = `${fpsValue} FPS`;
  $("st-bridge").textContent = ipc.bound ? "桥接已连接" : "桥接未连接";
  $("st-bridge").style.color = ipc.bound ? "var(--ok)" : "var(--err)";

  let mode;
  if (ipc.enabled) mode = ipc.bound ? `外部控制 · ${ipc.status}` : "外部控制 · 桥接断开";
  else if (demoEnabled) mode = "本机自瞄控制";
  else if (aimHeld) mode = "按住瞄准";
  else mode = "本地手动控制";
  $("st-mode").textContent = mode;

  const m = sim.metrics();
  const pct = m.score_fired > 0 ? (m.valid_hits / m.score_fired * 100).toFixed(1) : "0.0";
  $("stat-hit").textContent = `有效命中 ${m.valid_hits}/${m.score_fired} ${pct}%`;
  $("stat-frozen").classList.toggle("hidden", !m.score_frozen);
  $("stat-fly").textContent = `飞行中 ${m.in_flight}`;
  $("stathp").classList.toggle("alive", sim.health > 0);
  $("hp-line").textContent = sim.health > 0
    ? `血量 ${sim.health}/${sim.max_health} HP`
    : `配车血量 0/${sim.max_health} HP · 已击毁`;
  $("dmg-line").textContent = `累计伤害 ${sim.stats.damage} · 击毁 ${sim.stats.kills}`;

  $("tl-ground").textContent = sim.stats.ground;
  $("tl-hps").textContent = fmt(m.hits_per_second);
  $("tl-hr").textContent = m.resolved ? (m.hit_rate * 100).toFixed(1) + "%" : "--";
  $("tl-first").textContent = m.first_hit_time >= 0 ? `${fmt(m.first_hit_time)}s` : "--";
  $("tl-yaw").textContent = `${fmt(sim.yaw / D2R)}°`;
  $("tl-pitch").textContent = `${fmt(sim.pitch / D2R)}°`; // 下正，与原版 rad_to_deg(model.pitch) 一致
  $("tl-cmd").textContent = ipc.enabled ? "ROS /aim_sim/command" : (demoEnabled ? "本机自瞄" : "本地面板");
  $("tl-rej").textContent = ipc.rejected;
  $("tl-status").textContent = ipc.enabled ? `· ${ipc.status}` : "";
  $("tl-session").textContent = `会话 ${sim.session_id.slice(-8)} · 仿真 60 Hz · 协议 rm_aim_sim/2`;
}

const cornerHeader = "<tr><th>装甲</th><th>x</th><th>y</th><th>z</th></tr>";
const CORNER_NAMES = ["TL", "TR", "BR", "BL"]; // 原版命名：左上/右上/右下/左下（正面看）
function fmtPt(v) { return `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`; }
function updateCornersTable() {
  if (!$("showcorners").checked) return;
  const origin = sim.settings.gimbal.origin;
  const cp = sim.cameraPose();
  const bl = sim.settings.gimbal.barrel_length;
  const muzzle = { x: origin.x + cp.forward.x * bl, y: origin.y + cp.forward.y * bl, z: origin.z + cp.forward.z * bl };
  const shown = FRAME_SPECS.filter(([k]) => frameVisibility[k]).map(([k]) => k).join(" / ") || "无（仅显示角点）";
  $("corner-readout").textContent =
    `参考系 ${shown}\n相机 O ${fmtPt({ x: cp.origin.x - origin.x, y: cp.origin.y - origin.y, z: cp.origin.z - origin.z })}\n` +
    `枪口 O ${fmtPt({ x: muzzle.x - origin.x, y: muzzle.y - origin.y, z: muzzle.z - origin.z })}\n四角数值始终使用 odom：`;
  const obs = sim.cameraObservation();
  const html = [cornerHeader];
  for (const a of obs.armors) {
    html.push(`<tr><td colspan=4 style="color:#67e67e">可见装甲 ${a.id}</td></tr>`);
    sim.armorCorners(a.id, sim.time).forEach((p, i) => {
      // 与原版 / ROS armors 消息一致：odom 坐标 = 世界坐标 − 云台旋转中心
      const o = { x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z };
      html.push(`<tr><td>${i} ${CORNER_NAMES[i]}</td>` +
        `<td>${o.x.toFixed(3)}</td><td>${o.y.toFixed(3)}</td><td>${o.z.toFixed(3)}</td></tr>`);
    });
  }
  $("corner-table").innerHTML = html.join("") || "<tr><td colspan=4 style='color:#8b94ab'>当前没有可见装甲</td></tr>";
}

// ---------------- 渲染循环 ----------------
const clock = new THREE.Clock();
let lastPublish = 0;
const publishInterval = 1 / sim.settings.ipc.state_hz;

function updateVisuals() {
  updateRmFrames();
  yawGroup.rotation.y = sim.yaw;   // 原版 gun.look_at 等效：rotation.y = +yaw
  pitchGroup.rotation.x = -sim.pitch;
  for (let i = 0; i < 4; i++) {
    const a = sim.armorPose(i, sim.time);
    const mat4 = new THREE.Matrix4().makeBasis(
      rm2three(a.tangent), rm2three(a.up), rm2three(a.normal));
    mat4.setPosition(rm2three(a.center));
    armorMeshes[i].root.matrix.copy(mat4);
    armorMeshes[i].root.matrixAutoUpdate = false;
    const on = sim.armorLightOn(i);
    for (const mat of armorMeshes[i].mats) {
      mat.emissiveIntensity = on ? 2.0 : 0.05;
      mat.color.setHex(on ? armorTeamColor : 0x222222);
    }
  }
  for (let i = 0; i < bulletPool.length; i++) {
    const b = sim.projectiles[i];
    const mesh = bulletPool[i];
    if (b) {
      mesh.position.copy(rm2three(sim.bulletPosition(b, sim.time)));
      mesh.visible = true;
    } else mesh.visible = false;
  }
  for (const ev of sim.events) {
    if (ev.type === "impact" && ev.id > lastImpactId) {
      lastImpactId = ev.id;
      spawnFlash(ev.point, ev.kind === "hit" ? 0xffe066 : 0x888888);
    }
  }
  const now = performance.now();
  for (let i = flashPool.length - 1; i >= 0; i--) {
    const f = flashPool[i];
    const age = (now - f.born) / 300;
    if (age >= 1) {
      scene.remove(f.sprite);
      f.sprite.material.dispose();
      flashPool.splice(i, 1);
    } else {
      f.sprite.scale.setScalar(0.05 + age * 0.12);
      f.sprite.material.opacity = 0.95 * (1 - age);
    }
  }
  const cp = sim.cameraPose();
  cameraFP.position.copy(rm2three(cp.origin));
  const basis = new THREE.Matrix4().makeBasis(
    rm2three(cp.right), rm2three(cp.up), rm2three(cp.forward).negate());
  cameraFP.quaternion.setFromRotationMatrix(basis);
}

function renderPip() {
  if (!$("showpip").checked) return;
  const W = renderer.domElement.width / renderer.getPixelRatio();
  const H = renderer.domElement.height / renderer.getPixelRatio();
  const w = 320, h = 240;
  const x = W - w - 16, y = H - 64 - 26 - h; // 与 #pip DOM 位置对齐
  renderer.clearDepth();
  renderer.setScissorTest(true);
  renderer.setViewport(x, y, w, h);
  renderer.setScissor(x, y, w, h);
  renderer.render(scene, cameraFP);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, W, H);
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  sim.step(dt);
  localControlStep();
  checkCommandTimeout();
  const now = performance.now();
  if (now - lastPublish >= publishInterval * 1000) {
    lastPublish = now;
    publishState();
  }
  updateVisuals();
  updateHUD();
  updateCornersTable();
  renderer.clear();
  if (viewMode === "orbit") {
    controls.update();
    renderer.render(scene, cameraOrbit);
  } else {
    renderer.render(scene, cameraFP);
  }
  renderPip();
}
frame();
