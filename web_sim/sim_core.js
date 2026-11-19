// rm_aim_sim_web — 仿真核心
// 1:1 移植自 rm_aim_sim_training/scripts/simulation.gd + presets.gd
// 坐标约定（世界 W / 内部计算）: x 前, y 左, z 上；内部 pitch 下正（ROS pitch 上正，由桥接取反）

export const PI = Math.PI;
export const TAU = Math.PI * 2;

export function clampf(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
export function maxf(a, b) { return a > b ? a : b; }
export function minf(a, b) { return a < b ? a : b; }
export function wrapf(value, min, max) {
  const range = max - min;
  if (range === 0) return min;
  return value - range * Math.floor((value - min) / range);
}
export function lerp_angle(from, to, weight) {
  // Godot 4 lerp_angle
  const diff = wrapf(wrapf(to - from, -TAU, TAU) + PI, -TAU, TAU) - PI;
  return from + diff * weight;
}
export function move_toward(from, to, delta) {
  if (Math.abs(to - from) <= delta) return to;
  return from + Math.sign(to - from) * delta;
}

export class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  clone() { return new V3(this.x, this.y, this.z); }
  add(o) { return new V3(this.x + o.x, this.y + o.y, this.z + o.z); }
  sub(o) { return new V3(this.x - o.x, this.y - o.y, this.z - o.z); }
  mul(s) { return new V3(this.x * s, this.y * s, this.z * s); }
  dot(o) { return this.x * o.x + this.y * o.y + this.z * o.z; }
  cross(o) {
    return new V3(this.y * o.z - this.z * o.y, this.z * o.x - this.x * o.z, this.x * o.y - this.y * o.x);
  }
  length() { return Math.hypot(this.x, this.y, this.z); }
  toArray() { return [this.x, this.y, this.z]; }
}

// ---------------- 预设（presets.gd） ----------------

export const PRESET_DEFAULT_EXTENT = 0.550;

export const ROBOTS = {
  infantry_3: { label: "步兵 3", number: "3", width: 0.135, height: 0.125, module_width: 0.140, module_height: 0.125, max_health: 350 },
  infantry_4: { label: "步兵 4", number: "4", width: 0.135, height: 0.125, module_width: 0.140, module_height: 0.125, max_health: 350 },
  infantry_5: { label: "步兵 5", number: "5", width: 0.135, height: 0.125, module_width: 0.140, module_height: 0.125, max_health: 350 },
  hero: { label: "英雄 1", number: "1", width: 0.23, height: 0.127, module_width: 0.235, module_height: 0.127, max_health: 350 },
  sentry: { label: "哨兵 7", number: "7", width: 0.135, height: 0.125, module_width: 0.140, module_height: 0.125, max_health: 400 },
};

export function vertical_half_height(t) {
  return t.module_height * Math.abs(Math.cos(t.armor_tilt)) * 0.5;
}

export function lower_edge(t) {
  return t.center.z - vertical_half_height(t);
}

// 模块盒轮廓点旋转到装甲局部（presets._outline 的几何）
function outlinePoints(t) {
  const sine = Math.sin(t.armor_tilt), cosine = Math.cos(t.armor_tilt);
  const width = t.module_width - 0.005, height = t.module_height;
  const parts = [
    { size: [width, height, 0.018], position: [0, 0, -0.012] },
    { size: [width - 0.004, height - 0.004, 0.004], position: [0, 0, 0.001] },
  ];
  for (const side of [-1, 1]) {
    parts.push({ size: [0.005, t.lightbar_length, 0.008], position: [side * t.lightbar_spacing * 0.5, 0, 0.007] });
  }
  const points = [];
  for (const part of parts) {
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const px = part.position[0] + part.size[0] * x * 0.5;
      const py = part.position[1] + part.size[1] * y * 0.5;
      const pz = part.position[2] + part.size[2] * z * 0.5;
      points.push([-py * sine + pz * cosine, px, py * cosine + pz * sine]);
    }
  }
  return points;
}

export function radius_for_extent(diameter, t) {
  let radius = Infinity;
  for (const p of outlinePoints(t)) {
    const squared = diameter * diameter * 0.25 - p[1] * p[1];
    if (squared < 0) return -1;
    radius = Math.min(radius, Math.sqrt(squared) - p[0]);
  }
  return radius;
}

export function apply_robot(target, robot) {
  const preset = ROBOTS[robot];
  const lower = lower_edge(target);
  target.armor_width = preset.width;
  target.armor_height = preset.height;
  target.module_width = preset.module_width;
  target.module_height = preset.module_height;
  target.max_health = preset.max_health;
  target.lightbar_spacing = preset.width;
  target.center.z = lower + vertical_half_height(target);
  target.radius = radius_for_extent(PRESET_DEFAULT_EXTENT, target);
}

// ---------------- 默认设置（configs/default.cfg） ----------------

export function defaults() {
  const target = {
    center: { x: 4, y: 0, z: 0.2603703641430668 },
    position_offset: { x: 0, y: 0, z: 0 },
    translate: false, speed: 1.0, acceleration: 3.0,
    heading: 1.5707963267948966, travel: 1.5,
    rotate: false, omega: 4.0, phase: PI,
    height_difference: -0.1, max_health: -1,
    module_width: 0.140, module_height: 0.125,
    armor_width: 0.135, armor_height: 0.125,
    armor_tilt: 0.2617993877991494,
    lightbar_spacing: 0.135, lightbar_length: 0.056,
  };
  apply_robot(target, "infantry_3");
  return {
    appearance: { robot: "infantry_3", team: "blue" },
    target,
    gimbal: {
      ideal: true, origin: { x: 0, y: 0, z: 0.65 },
      barrel_length: 0.22, max_speed: 6.0, max_acceleration: 50.0,
      response_hz: 6.0, pitch_min: -0.5235987755982988, pitch_max: 0.3490658503988659,
    },
    weapon: { speed: 23.0, rate: 10.0, delay: 0.015, gravity: 9.7833, lifetime: 3.0, damage: 20 },
    camera: { width: 1440, height: 1080, vertical_fov: 45.0, brightness_gain: 0.4, offset: { x: 0.08, y: 0, z: 0.04 } },
    ipc: { state_hz: 60.0, timeout: 0.25 },
  };
}

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

// ---------------- 仿真（simulation.gd） ----------------

const MAX_COLLISION_DT = 0.001;
const MAX_PROJECTILES = 512;
export const HIT_FLASH_DURATION = 0.05;

export class Simulation {
  constructor(initial) {
    this.settings = deepClone(initial && Object.keys(initial).length ? initial : defaults());
    this.reset();
  }

  reset(initial) {
    if (initial) this.settings = deepClone(initial);
    this.time = 0.0;
    this.tick = 0;
    this.session_id = `${Date.now() * 1000 + Math.floor(Math.random() * 1000)}-${Math.floor(Math.random() * 2 ** 31)}`;
    this.paused = false;
    this.yaw = 0.0;
    this.pitch = 0.0;
    this.yaw_velocity = 0.0;
    this.pitch_velocity = 0.0;
    this.command = { control: false, fire: false, yaw: 0.0, pitch: 0.0, yaw_vel: 0.0, pitch_vel: 0.0, yaw_acc: 0.0, pitch_acc: 0.0 };
    this.projectiles = [];
    this.pending = [];
    this.events = [];
    this.impacts = [];
    this.stats = { fired: 0, hit: 0, ground: 0, expired: 0, damage: 0, kills: 0 };
    this.next_trigger = 0.0;
    this.next_shot_id = 0;
    this.first_hit_time = -1.0;
    this.max_health = this._configuredHealth();
    this.health = this.max_health;
    this.round_score = { frozen: this.health <= 0, valid_hits: 0, fired: 0, kill_time: -1.0 };
    this.death_time = -1.0;
    this.nextHealthEventId = 0;
    this.armor_light_off_until = [0, 0, 0, 0];
    this.translation_origin = { ...this.settings.target.center };
    this.translation_epoch = 0.0;
    this.translation_start_offset = 0.0;
    this.translation_direction = 1.0;
    this.rotation_origin = this.settings.target.phase;
    this.rotation_epoch = 0.0;
    this.motion_stop_time = this.health <= 0 ? 0.0 : -1.0;
  }

  _configuredHealth() {
    const t = this.settings.target;
    return t.max_health < 0 ? ROBOTS[this.settings.appearance.robot].max_health : Math.trunc(t.max_health);
  }

  applySettings(updated, resetHealth = false) {
    const pose = this.targetPose(this.time);
    const motion = this._translationState(this.time);
    const wasStopped = this.motion_stop_time >= 0.0;
    const oldT = this.settings.target, newT = updated.target;
    let translationChanged = false;
    for (const key of ["center", "translate", "speed", "acceleration", "heading", "travel"]) {
      translationChanged = translationChanged ||
        JSON.stringify(newT[key]) !== JSON.stringify(oldT[key]);
    }
    if (translationChanged || wasStopped) {
      const desired = new V3(pose.center.x - oldT.position_offset.x + newT.center.x - oldT.center.x,
        pose.center.y - oldT.position_offset.y + newT.center.y - oldT.center.y,
        pose.center.z - oldT.position_offset.z + newT.center.z - oldT.center.z);
      if (newT.translate) {
        const axis = new V3(Math.cos(newT.heading), Math.sin(newT.heading), 0);
        this.translation_start_offset = clampf(
          (desired.sub(new V3(newT.center.x, newT.center.y, newT.center.z))).dot(axis),
          -newT.travel, newT.travel);
        this.translation_origin = { ...newT.center };
      } else {
        this.translation_origin = { x: desired.x, y: desired.y, z: desired.z };
        this.translation_start_offset = 0.0;
      }
      this.translation_direction = motion.direction >= 0 ? 1.0 : -1.0;
      this.translation_epoch = this.time;
    }
    if (newT.rotate !== oldT.rotate || newT.omega !== oldT.omega ||
      newT.phase !== oldT.phase || wasStopped) {
      this.rotation_origin = pose.angle + newT.phase - oldT.phase;
      this.rotation_epoch = this.time;
    }
    const healthChanged = resetHealth || newT.max_health !== oldT.max_health ||
      updated.appearance.robot !== this.settings.appearance.robot;
    this.settings = deepClone(updated);
    if (this.settings.gimbal.ideal) this._applyIdealGimbal();
    if (healthChanged) {
      this.max_health = this._configuredHealth();
      this.health = this.max_health;
      this.death_time = -1.0;
      this.armor_light_off_until = [0, 0, 0, 0];
      this.events.push({ type: "health_set", id: this.nextHealthEventId || 0, time: this.time, health: this.health, max_health: this.max_health });
      this.nextHealthEventId = (this.nextHealthEventId || 0) + 1;
      this._trimEvents();
    }
    this.motion_stop_time = this.health <= 0 ? this.time : -1.0;
    if (this.health <= 0) this.round_score.frozen = true;
  }

  setCommand(value) {
    const wasFiring = !!this.command.fire;
    this.command = { ...value };
    for (const key of ["yaw_vel", "pitch_vel", "yaw_acc", "pitch_acc"]) {
      if (!(key in this.command)) this.command[key] = 0.0;
    }
    this.command.yaw = wrapf(this.command.yaw, -PI, PI);
    this.command.pitch = clampf(this.command.pitch, this.settings.gimbal.pitch_min, this.settings.gimbal.pitch_max);
    if (!this.command.control) {
      this.command.fire = false;
      this.pending = [];
    }
    if (this.settings.gimbal.ideal) this._applyIdealGimbal();
    if (this.command.fire && !wasFiring) this.next_trigger = Math.max(this.next_trigger, this.time);
  }

  _applyIdealGimbal() {
    if (this.command.control) {
      this.yaw = this.command.yaw;
      this.pitch = clampf(this.command.pitch, this.settings.gimbal.pitch_min, this.settings.gimbal.pitch_max);
    }
    this.yaw_velocity = 0.0;
    this.pitch_velocity = 0.0;
  }

  stop() {
    this.setCommand({ control: false, fire: false, yaw: this.yaw, pitch: this.pitch });
  }

  static forward(y, p) {
    return new V3(Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), -Math.sin(p));
  }

  static _legDuration(distance, speed, acceleration) {
    if (distance <= 0.0 || speed <= 0.0) return 0.0;
    const peak = Math.min(speed, Math.sqrt(distance * acceleration));
    const accelerationTime = peak / acceleration;
    const accelerationDistance = 0.5 * acceleration * accelerationTime * accelerationTime;
    return 2.0 * accelerationTime + (distance - 2.0 * accelerationDistance) / peak;
  }

  static _legDistance(distance, elapsed, speed, acceleration) {
    if (distance <= 0.0 || elapsed <= 0.0 || speed <= 0.0) return 0.0;
    const peak = Math.min(speed, Math.sqrt(distance * acceleration));
    const accelerationTime = peak / acceleration;
    const accelerationDistance = 0.5 * acceleration * accelerationTime * accelerationTime;
    const cruiseTime = (distance - 2.0 * accelerationDistance) / peak;
    const duration = 2.0 * accelerationTime + cruiseTime;
    const t = Math.min(elapsed, duration);
    if (t < accelerationTime) return 0.5 * acceleration * t * t;
    if (t < accelerationTime + cruiseTime) return accelerationDistance + peak * (t - accelerationTime);
    const remaining = duration - t;
    return distance - 0.5 * acceleration * remaining * remaining;
  }

  _translationState(at) {
    const t = this.settings.target;
    const start = clampf(this.translation_start_offset, -t.travel, t.travel);
    const initialDirection = this.translation_direction >= 0.0 ? 1.0 : -1.0;
    if (!t.translate || t.speed <= 0.0) return { offset: start, direction: initialDirection };
    const motionAt = this.motion_stop_time >= 0.0 ? Math.min(at, this.motion_stop_time) : at;
    let elapsed = Math.max(0.0, motionAt - this.translation_epoch);
    const firstDistance = initialDirection > 0.0 ? t.travel - start : start + t.travel;
    const firstDuration = Simulation._legDuration(firstDistance, t.speed, t.acceleration);
    if (elapsed < firstDuration) {
      return { offset: start + initialDirection * Simulation._legDistance(firstDistance, elapsed, t.speed, t.acceleration), direction: initialDirection };
    }
    elapsed -= firstDuration;
    const fullDistance = 2.0 * t.travel;
    const fullDuration = Simulation._legDuration(fullDistance, t.speed, t.acceleration);
    const completed = Math.floor(elapsed / fullDuration);
    const localTime = elapsed - completed * fullDuration;
    const direction = completed % 2 === 0 ? -initialDirection : initialDirection;
    const legStart = completed % 2 === 0 ? initialDirection * t.travel : -initialDirection * t.travel;
    return { offset: legStart + direction * Simulation._legDistance(fullDistance, localTime, t.speed, t.acceleration), direction };
  }

  targetPose(at) {
    const motionAt = this.motion_stop_time >= 0.0 ? Math.min(at, this.motion_stop_time) : at;
    const t = this.settings.target;
    const center = new V3(
      this.translation_origin.x + t.position_offset.x,
      this.translation_origin.y + t.position_offset.y,
      this.translation_origin.z + t.position_offset.z);
    if (t.translate) {
      const motion = this._translationState(at);
      const off = motion.offset;
      center.x += Math.cos(t.heading) * off;
      center.y += Math.sin(t.heading) * off;
    }
    const angle = this.rotation_origin + (t.rotate ? t.omega * (motionAt - this.rotation_epoch) : 0.0);
    return { center, angle };
  }

  armorPose(index, at) {
    const pose = this.targetPose(at);
    const t = this.settings.target;
    const angle = pose.angle + index * TAU / 4.0;
    const radial = new V3(Math.cos(angle), Math.sin(angle), 0.0);
    const normal = radial.mul(Math.cos(t.armor_tilt)).add(new V3(0, 0, Math.sin(t.armor_tilt)));
    const tangent = new V3(-Math.sin(angle), Math.cos(angle), 0.0);
    const up = normal.cross(tangent);
    const center = pose.center.add(radial.mul(t.radius));
    if (index % 2 === 1) center.z += t.height_difference;
    return { id: index, center, normal, tangent, up, normal_yaw: wrapf(angle, -PI, PI) };
  }

  armorCorners(index, at) {
    const armor = this.armorPose(index, at);
    const t = this.settings.target;
    const uvs = [[-1, 1], [1, 1], [1, -1], [-1, -1]]; // 左上、右上、右下、左下（从正面看）
    return uvs.map(([ux, uy]) => armor.center
      .add(armor.tangent.mul(ux * t.armor_width * 0.5))
      .add(armor.up.mul(uy * t.armor_height * 0.5)));
  }

  cameraPose() {
    const f = Simulation.forward(this.yaw, this.pitch);
    const right = new V3(Math.sin(this.yaw), -Math.cos(this.yaw), 0);
    const up = right.cross(f);
    const offset = this.settings.camera.offset;
    const origin = new V3(this.settings.gimbal.origin.x, this.settings.gimbal.origin.y, this.settings.gimbal.origin.z)
      .add(f.mul(offset.x)).sub(right.mul(offset.y)).add(up.mul(offset.z));
    return { origin, forward: f, right, up };
  }

  armorLightOn(index) {
    return this.health > 0 && this.time >= this.armor_light_off_until[index];
  }

  cameraObservation() {
    const pose = this.cameraPose();
    const c = this.settings.camera;
    const fy = 0.5 * c.height / Math.tan(c.vertical_fov * PI / 180.0 * 0.5);
    const armors = [];
    for (let i = 0; i < 4; i++) {
      if (!this.armorLightOn(i)) continue;
      const armor = this.armorPose(i, this.time);
      if (pose.origin.sub(armor.center).dot(armor.normal) <= 0.0) continue;
      const points = [];
      let allInFrame = true;
      const uvs = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
      for (const [ux, uy] of uvs) {
        let point = armor.center.add(armor.tangent.mul(ux * this.settings.target.lightbar_spacing * 0.5));
        point = point.add(armor.up.mul(uy * this.settings.target.lightbar_length * 0.5));
        const rel = point.sub(pose.origin);
        const depth = rel.dot(pose.forward);
        if (depth <= 0.01) { allInFrame = false; break; }
        const px = fy * rel.dot(pose.right) / depth + c.width * 0.5;
        const py = -fy * rel.dot(pose.up) / depth + c.height * 0.5;
        if (px < 0 || px >= c.width || py < 0 || py >= c.height) allInFrame = false;
        points.push([px, py]);
      }
      if (allInFrame) armors.push({ id: i, corners: points });
    }
    return {
      timestamp: this.time, tick: this.tick, width: c.width, height: c.height,
      brightness_gain: c.brightness_gain,
      K: [fy, 0, c.width * 0.5, 0, fy, c.height * 0.5, 0, 0, 1],
      distortion: [0, 0, 0, 0, 0],
      R_camera2gimbal: [0, 0, 1, -1, 0, 0, 0, -1, 0],
      t_camera2gimbal: [c.offset.x, c.offset.y, c.offset.z],
      origin: pose.origin.toArray(), yaw: this.yaw, pitch: this.pitch, armors,
    };
  }

  step(dt) {
    if (this.paused || dt <= 0.0) return;
    const rotationDt = 0.005 / Math.max(Math.abs(this.settings.target.omega), 1.0);
    const count = Math.max(1, Math.ceil(dt / Math.min(MAX_COLLISION_DT, rotationDt)));
    const h = dt / count;
    for (let i = 0; i < count; i++) this._substep(h);
    this.tick += 1;
  }

  _axisStep(angle, velocity, goal, goalV, goalA, dt, wrapAngle) {
    const error = wrapAngle ? wrapf(goal - angle, -PI, PI) : goal - angle;
    const response = TAU * this.settings.gimbal.response_hz;
    let accel = response * response * error + 2.0 * response * (goalV - velocity) + goalA;
    accel = clampf(accel, -this.settings.gimbal.max_acceleration, this.settings.gimbal.max_acceleration);
    const newV = clampf(velocity + accel * dt, -this.settings.gimbal.max_speed, this.settings.gimbal.max_speed);
    return [angle + (velocity + newV) * 0.5 * dt, newV];
  }

  _substep(dt) {
    const end = this.time + dt;
    const oldYaw = this.yaw;
    const oldPitch = this.pitch;
    if (this.settings.gimbal.ideal) {
      this._applyIdealGimbal();
    } else if (this.command.control) {
      const y = this._axisStep(this.yaw, this.yaw_velocity, this.command.yaw, this.command.yaw_vel, this.command.yaw_acc, dt, true);
      const p = this._axisStep(this.pitch, this.pitch_velocity, this.command.pitch, this.command.pitch_vel, this.command.pitch_acc, dt, false);
      this.yaw = wrapf(y[0], -PI, PI);
      this.yaw_velocity = y[1];
      const px = clampf(p[0], this.settings.gimbal.pitch_min, this.settings.gimbal.pitch_max);
      this.pitch_velocity = px === p[0] ? p[1] : 0.0;
      this.pitch = px;
    } else {
      this.yaw_velocity = move_toward(this.yaw_velocity, 0.0, this.settings.gimbal.max_acceleration * dt);
      this.pitch_velocity = move_toward(this.pitch_velocity, 0.0, this.settings.gimbal.max_acceleration * dt);
      this.yaw = wrapf(this.yaw + this.yaw_velocity * dt, -PI, PI);
      this.pitch = clampf(this.pitch + this.pitch_velocity * dt, this.settings.gimbal.pitch_min, this.settings.gimbal.pitch_max);
    }
    if (this.command.control && this.command.fire) {
      while (this.next_trigger <= end + 1e-9) {
        this.pending.push(Math.max(this.time, this.next_trigger) + this.settings.weapon.delay);
        this.next_trigger = Math.max(this.time, this.next_trigger) + 1.0 / this.settings.weapon.rate;
      }
    }
    const releases = [];
    while (this.pending.length > 0 && this.pending[0] <= end + 1e-9) {
      const release = this.pending.shift();
      const weight = clampf((release - this.time) / dt, 0.0, 1.0);
      const firedBefore = this.stats.fired;
      this._spawn(release, lerp_angle(oldYaw, this.yaw, weight), oldPitch + (this.pitch - oldPitch) * weight);
      if (this.stats.fired > firedBefore) releases.push(release);
    }
    const collisions = [];
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const bullet = this.projectiles[i];
      const start = Math.max(this.time, bullet.born);
      const result = this._collision(bullet, start, end);
      if (result) {
        collisions.push({ bullet, result });
        this.projectiles.splice(i, 1);
      } else if (end - bullet.born >= this.settings.weapon.lifetime || this._outsideTargetRange(bullet, end)) {
        this._finish(bullet, {
          kind: "expired", time: end, point: this.bulletPosition(bullet, end),
          normal: new V3(0, 0, 1),   // 过期无碰撞面，给默认法线（原版 impact.get("normal", Vector3(0,0,1)) 等效）
          reason: end - bullet.born >= this.settings.weapon.lifetime ? "lifetime" : "range",
        });
        this.projectiles.splice(i, 1);
      }
    }
    collisions.sort((a, b) => a.result.time - b.result.time);
    for (const collision of collisions) {
      let laterReleases = 0;
      for (const release of releases) if (release > collision.result.time) laterReleases += 1;
      this._finish(collision.bullet, collision.result, laterReleases);
    }
    this.time = end;
  }

  _spawn(at, actualYaw, actualPitch) {
    if (this.projectiles.length >= MAX_PROJECTILES) return;
    const direction = Simulation.forward(actualYaw, actualPitch);
    const g = this.settings.gimbal.origin;
    const origin = new V3(g.x, g.y, g.z).add(direction.mul(this.settings.gimbal.barrel_length));
    const bullet = {
      id: this.next_shot_id, born: at, origin,
      velocity: direction.mul(this.settings.weapon.speed), damage: this.settings.weapon.damage,
    };
    this.projectiles.push(bullet);
    this.next_shot_id += 1;
    this.stats.fired += 1;
    if (!this.round_score.frozen && this.health > 0) this.round_score.fired += 1;
    this.events.push({ type: "shot", id: bullet.id, time: at, yaw: actualYaw, pitch: actualPitch });
    this._trimEvents();
  }

  bulletPosition(bullet, at) {
    const age = Math.max(0.0, at - bullet.born);
    return new V3(
      bullet.origin.x + bullet.velocity.x * age,
      bullet.origin.y + bullet.velocity.y * age,
      bullet.origin.z + bullet.velocity.z * age - 0.5 * this.settings.weapon.gravity * age * age);
  }

  _outsideTargetRange(bullet, at) {
    const t = this.settings.target;
    const center = new V3(this.translation_origin.x + t.position_offset.x,
      this.translation_origin.y + t.position_offset.y,
      this.translation_origin.z + t.position_offset.z);
    const dx = center.x - bullet.origin.x, dy = center.y - bullet.origin.y;
    const halfDiagonal = Math.hypot(t.armor_width, t.armor_height) * 0.5;
    let limit = Math.hypot(dx, dy) + t.radius + halfDiagonal + 0.1;
    if (t.translate) limit += t.travel;
    const point = this.bulletPosition(bullet, at);
    const hx = point.x - bullet.origin.x, hy = point.y - bullet.origin.y;
    return hx * hx + hy * hy > limit * limit;
  }

  _collision(bullet, start, end) {
    const p0 = this.bulletPosition(bullet, start);
    const p1 = this.bulletPosition(bullet, end);
    let best = null;
    for (let i = 0; i < 4; i++) {
      const a0 = this.armorPose(i, start);
      const a1 = this.armorPose(i, end);
      const d0 = p0.sub(a0.center).dot(a0.normal);
      const d1 = p1.sub(a1.center).dot(a1.normal);
      if (d0 < 0.0 || d1 > 0.0) continue;
      let lo = start, hi = end;
      for (let j = 0; j < 16; j++) {
        const mid = (lo + hi) * 0.5;
        const armor = this.armorPose(i, mid);
        if (this.bulletPosition(bullet, mid).sub(armor.center).dot(armor.normal) > 0.0) lo = mid;
        else hi = mid;
      }
      const at = (lo + hi) * 0.5;
      const armor = this.armorPose(i, at);
      const point = this.bulletPosition(bullet, at);
      const local = point.sub(armor.center);
      const t = this.settings.target;
      if (Math.abs(local.dot(armor.tangent)) <= t.armor_width * 0.5 &&
        Math.abs(local.dot(armor.up)) <= t.armor_height * 0.5) {
        if (!best || at < best.time) {
          best = { kind: "hit", armor_id: i, time: at, point, normal: armor.normal,
            uv: [local.dot(armor.tangent), local.dot(armor.up)] };
        }
      }
    }
    if (p1.z <= 0.0) {
      const fraction = clampf(p0.z / Math.max(p0.z - p1.z, 1e-12), 0.0, 1.0);
      const at = start + (end - start) * fraction;
      if (!best || at < best.time) {
        best = { kind: "ground", time: at, point: this.bulletPosition(bullet, at), normal: new V3(0, 0, 1) };
      }
    }
    return best;
  }

  _finish(bullet, result, laterReleases = 0) {
    this.stats[result.kind] = (this.stats[result.kind] || 0) + 1;
    if (result.kind === "hit" && this.first_hit_time < 0.0) this.first_hit_time = result.time;
    const event = {
      type: "impact", id: bullet.id, kind: result.kind, time: result.time,
      point: result.point.toArray(), armor_id: result.armor_id !== undefined ? result.armor_id : -1,
    };
    if (result.reason) event.reason = result.reason;
    let damage = 0;
    let killed = false;
    if (result.kind === "hit" && this.health > 0) {
      if (!this.round_score.frozen) this.round_score.valid_hits += 1;
      const armorId = result.armor_id;
      this.armor_light_off_until[armorId] = Math.max(this.armor_light_off_until[armorId], result.time + HIT_FLASH_DURATION);
      damage = Math.min(this.health, Math.trunc(bullet.damage !== undefined ? bullet.damage : this.settings.weapon.damage));
      this.health -= damage;
      this.stats.damage += damage;
      if (this.health === 0) {
        this.death_time = result.time;
        this.motion_stop_time = result.time;
        this.stats.kills += 1;
        killed = true;
        if (!this.round_score.frozen) {
          this.round_score.fired -= laterReleases;
          this.round_score.frozen = true;
          this.round_score.kill_time = result.time;
        }
      }
    }
    event.damage = damage;
    event.health = this.health;
    event.killed = killed;
    this.events.push(event);
    this.impacts.push({
      id: bullet.id, kind: result.kind, time: result.time, point: result.point.toArray(),
      normal: result.normal.toArray(),
      velocity: bullet.velocity.add(new V3(0, 0, -this.settings.weapon.gravity * (result.time - bullet.born))).toArray(),
    });
    if (this.impacts.length > 80) this.impacts.shift();
    this._trimEvents();
  }

  _trimEvents() {
    while (this.events.length > 128) this.events.shift();
  }

  metrics() {
    const resolved = this.stats.hit + this.stats.ground + this.stats.expired;
    const result = { ...this.stats };
    result.in_flight = this.projectiles.length;
    result.pending = this.pending.length;
    result.resolved = resolved;
    result.hit_rate = resolved > 0 ? this.stats.hit / resolved : 0.0;
    result.hits_per_second = this.time > 0.0 ? this.stats.hit / this.time : 0.0;
    result.first_hit_time = this.first_hit_time;
    result.valid_hits = this.round_score.valid_hits;
    result.score_fired = this.round_score.fired;
    result.score_hit_rate = this.round_score.fired > 0 ? this.round_score.valid_hits / this.round_score.fired : 0.0;
    result.score_frozen = this.round_score.frozen;
    result.kill_time = this.round_score.kill_time;
    return result;
  }

  // 与原版 Godot 端 snapshot() 字段一致（供 C++ 桥接消费）
  snapshot() {
    const pose = this.targetPose(this.time);
    const armors = [];
    for (let i = 0; i < 4; i++) {
      const a = this.armorPose(i, this.time);
      armors.push({
        id: i, center: a.center.toArray(), normal: a.normal.toArray(),
        normal_yaw: a.normal_yaw,
        corners: this.armorCorners(i, this.time).map(p => p.toArray()),
      });
    }
    return {
      protocol: "rm_aim_sim/2", type: "state", session_id: this.session_id,
      tick: this.tick, sim_time: this.time, paused: this.paused,
      gimbal: {
        yaw: this.yaw, pitch: this.pitch, yaw_vel: this.yaw_velocity, pitch_vel: this.pitch_velocity,
        origin: [this.settings.gimbal.origin.x, this.settings.gimbal.origin.y, this.settings.gimbal.origin.z],
        ideal: this.settings.gimbal.ideal,
      },
      weapon: {
        speed: this.settings.weapon.speed, rate: this.settings.weapon.rate,
        delay: this.settings.weapon.delay, barrel_length: this.settings.gimbal.barrel_length,
        gravity: this.settings.weapon.gravity, damage: this.settings.weapon.damage,
      },
      health: { current: this.health, maximum: this.max_health, alive: this.health > 0, death_time: this.death_time },
      appearance: deepClone(this.settings.appearance),
      truth: { center: pose.center.toArray(), angle: pose.angle, armors },
      camera: this.cameraObservation(),
      stats: this.metrics(),
      events: deepClone(this.events),
    };
  }
}
