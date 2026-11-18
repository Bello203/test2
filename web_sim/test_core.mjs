// 核心物理闭环测试（node 也可直接运行）
// 用例：静止目标 + 理想云台 + 重力补偿弹道 → 应命中并累计伤害
import { Simulation, defaults, PI } from "./sim_core.js";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

// ---- 用例 1：装甲几何 ----
{
  const sim = new Simulation();
  const corners = sim.armorCorners(0, 0);
  const c = sim.armorPose(0, 0).center;
  check("装甲中心半径 ≈ 0.275 m", Math.abs(Math.hypot(c.x - 4, c.y) - sim.settings.target.radius) < 1e-9);
  const w = Math.hypot(corners[0].x - corners[1].x, corners[0].y - corners[1].y, corners[0].z - corners[1].z);
  const h = Math.hypot(corners[0].x - corners[3].x, corners[0].y - corners[3].y, corners[0].z - corners[3].z);
  check(`装甲宽 ≈ 0.135（实际 ${w.toFixed(4)}）`, Math.abs(w - 0.135) < 1e-9);
  check(`装甲高 ≈ 0.125（实际 ${h.toFixed(4)}）`, Math.abs(h - 0.125) < 1e-9);
  check("默认血量 350", sim.health === 350);
  check("4 块装甲奇偶高度差", Math.abs(sim.armorPose(1, 0).center.z - sim.armorPose(0, 0).center.z + 0.1) < 1e-9);
}

// ---- 用例 2：静止目标瞄准命中 ----
{
  const sim = new Simulation();
  sim.settings.gimbal.ideal = true;
  sim.settings.weapon.delay = 0; // 简化：无延迟
  const armor = sim.armorPose(0, 0);
  const cx = armor.center.x, cy = armor.center.y, cz = armor.center.z;
  const muzzleZ = 0.65, muzzleX = 0.22;
  // 迭代解算含重力的 pitch（ROS 上正）
  let d = Math.hypot(cx - muzzleX, cy), tFly = d / 23, pitchUp = 0;
  for (let i = 0; i < 20; i++) {
    const dz = cz - muzzleZ;
    pitchUp = Math.atan2(dz + 0.5 * 9.7833 * tFly * tFly, d);
    tFly = d / (23 * Math.cos(pitchUp));
  }
  const yaw = Math.atan2(cy, cx);
  sim.setCommand({ control: true, fire: true, yaw, pitch: -pitchUp });
  const dt = 1 / 240;
  for (let i = 0; i < 240 * 3 && sim.health === 350; i++) sim.step(dt);
  check(`命中并掉血（health=${sim.health}, fired=${sim.stats.fired}, hit=${sim.stats.hit}）`,
    sim.stats.hit >= 1 && sim.health < 350, JSON.stringify(sim.stats));
  check("有效命中计入 round_score", sim.round_score.valid_hits >= 1);
}

// ---- 用例 3：平移 + 自转目标仍可被预测命中（简单提前量） ----
{
  const sim = new Simulation();
  sim.settings.weapon.delay = 0;
  sim.settings.target.rotate = true;
  sim.settings.target.omega = 2.0;
  sim.settings.target.translate = true;
  sim.settings.target.speed = 1.0;
  // 用前一帧装甲中心 + 一阶速度估计做提前量
  let prev = null, prevT = null;
  let aimYaw = 0, aimPitch = 0;
  const dt = 1 / 240;
  let hits0 = 0;
  for (let i = 0; i < 240 * 6; i++) {
    sim.step(dt);
    const armor = sim.armorPose(0, sim.time);
    if (prev && sim.time > prevT && sim.health === 350) {
      const vx = (armor.center.x - prev.x) / (sim.time - prevT);
      const vy = (armor.center.y - prev.y) / (sim.time - prevT);
      const d = Math.hypot(armor.center.x - 0.22, armor.center.y);
      const tFly = d / 23;
      const tx = armor.center.x + vx * tFly, ty = armor.center.y + vy * tFly;
      const dd = Math.hypot(tx - 0.22, ty);
      let tf = dd / 23, pitchUp = 0;
      for (let k = 0; k < 10; k++) {
        pitchUp = Math.atan2(armor.center.z - 0.65 + 0.5 * 9.7833 * tf * tf, dd);
        tf = dd / (23 * Math.cos(pitchUp));
      }
      aimYaw = Math.atan2(ty, tx);
      aimPitch = -pitchUp;
      sim.setCommand({ control: true, fire: true, yaw: aimYaw, pitch: aimPitch });
    }
    prev = { ...armor.center }; prevT = sim.time;
  }
  console.log(`  · 动靶统计: fired=${sim.stats.fired} hit=${sim.stats.hit} health=${sim.health}`);
  check("动靶能命中至少一次", sim.stats.hit >= 1, JSON.stringify(sim.stats));
}

// ---- 用例 4：伺服云台收敛 ----
{
  const sim = new Simulation();
  sim.settings.gimbal.ideal = false;
  sim.setCommand({ control: true, fire: false, yaw: 0.5, pitch: -0.1 });
  for (let i = 0; i < 240 * 3; i++) sim.step(1 / 240);
  check(`伺服收敛 yaw=${sim.yaw.toFixed(4)} (期望 0.5)`, Math.abs(sim.yaw - 0.5) < 0.01);
  check(`伺服收敛 pitch=${sim.pitch.toFixed(4)} (期望 -0.1)`, Math.abs(sim.pitch + 0.1) < 0.01);
  check("ROS 反馈 pitch 上正", Math.abs(sim.pitch - (-0.1)) < 0.01);
}

// ---- 用例 5：camera 可见性 ----
{
  const sim = new Simulation();
  const obs = sim.cameraObservation();
  check("静止目标 1 号装甲在视场内", obs.armors.length >= 1 && obs.armors[0].id === 0,
    JSON.stringify(obs.armors.map(a => a.id)));
  // 背对：把云台转 180°
  sim.setCommand({ control: true, fire: false, yaw: PI, pitch: 0 });
  const obs2 = sim.cameraObservation();
  check("云台转 180° 后看不到装甲", obs2.armors.length === 0);
}

// ---- 用例 6：session 与重置 ----
{
  const sim = new Simulation();
  const s1 = sim.session_id;
  sim.step(1 / 60);
  sim.reset();
  check("重置后 session 变化", sim.session_id !== s1);
  check("重置后时间归零", sim.time === 0 && sim.tick === 0);
  check("重置后统计清零", sim.stats.fired === 0);
}

// ---- 用例 7：snapshot 结构（桥接协议兼容） ----
{
  const sim = new Simulation();
  const snap = sim.snapshot();
  for (const key of ["protocol", "type", "session_id", "sim_time", "paused", "gimbal", "weapon", "truth", "camera", "stats"]) {
    check(`snapshot 含字段 ${key}`, key in snap);
  }
  check("truth.armors 有 4 块", snap.truth.armors.length === 4);
  check("装甲角点为 4×3", snap.truth.armors[0].corners.length === 4 && snap.truth.armors[0].corners[0].length === 3);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
