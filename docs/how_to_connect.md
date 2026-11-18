# 怎么连接模拟器、怎么验证、以后写代码的流程

> 适用：代码已放进 VS Code（工作空间 `rm_aim_lab_workspace`）。
> 本文只讲"跑起来 + 连上 + 验证"，原理在最后一节。

---

## 0. 先认清三个角色（必须三个都在跑）

| 角色 | 跑在哪 | 干什么 | 启动方式 |
|---|---|---|---|
| **网页仿真**（3D 渲染 + 物理） | Mac 浏览器 | 出画面、算弹道/命中、产生 `/aim_sim/armors` 数据 | `./run_web.sh` → 打开 `http://localhost:8080` |
| **桥接节点**（C++） | Ubuntu（VM 或真机） | WebSocket ⇄ ROS 2 翻译官，**唯一**和网页通信的进程 | `ros2 launch rm_aim_sim_bridge web_bridge.launch.xml` |
| **你的自瞄节点**（C++） | Ubuntu，同一个 ROS 2 域 | 读观测 → 算 yaw/pitch → 发 `/aim_sim/command` | `ros2 run student_auto_aim aim_node --ros-args -p use_sim_time:=true` |

**只启动前两个 = 只能看画面；三个都跑 + 勾选"外部控制" = 闭环成立。**

---

## 1. 连接模拟器（终端 A / B / C）

### 终端 A — Ubuntu：编译一次，之后长期开着桥接

```bash
cd ~/rm_aim_lab_workspace          # 你放代码的目录
source /opt/ros/jazzy/setup.bash   # 版本按你的实际安装改
cd ros2_ws && colcon build --packages-select rm_aim_sim_bridge --symlink-install && cd ..
source ros2_ws/install/setup.bash
ros2 launch rm_aim_sim_bridge web_bridge.launch.xml
```

看到这行就对了：

```
[bridge]: Waiting for web simulator on ws://0.0.0.0:9090 (ROS pitch is positive UP)
```

**这个终端不要关**，桥接一断网页就停控制。

### 终端 B — Mac：起网页

```bash
cd rm_aim_lab_workspace
./run_web.sh            # 或者 cd web_sim && python3 -m http.server 8080
```

浏览器打开 `http://localhost:8080`。

### 页面里做两件事（顺序不能反）

1. 左侧 **03 ROS 桥接 → 桥接地址** 填 `ws://<Ubuntu的IP>:9090`
   - 同一个 Ubuntu 桌面里开浏览器 → 填 `ws://localhost:9090`
   - Mac 浏览器 + VM 桥接 → 填 VM 的 IP，例如 `ws://192.168.64.5:9090`
   - 填完按 **回车**（或点别的输入框）触发重连；页面每 2 s 自动重连一次，不用手动刷
2. 勾选 **外部控制（ROS）** ← 这一步会**换一个新 session**，所有旧指令作废（安全设计）

> 查 IP：Ubuntu 里 `hostname -I | awk '{print $1}'`。VM 用 NAT 就必须做 9090 端口转发，见 `docs/ubuntu_vm_guide.md`。

### 终端 C — Ubuntu：跑你的节点

```bash
source /opt/ros/jazzy/setup.bash
source ~/rm_aim_lab_workspace/ros2_ws/install/setup.bash
ros2 run student_auto_aim aim_node --ros-args -p use_sim_time:=true
```

---

## 2. 怎么验证"连上了"——三层，从弱到强

### 第 1 层：看网页（2 秒就能判断）

看顶部状态栏：

| 显示 | 含义 |
|---|---|
| **桥接已连接**（绿色） | WebSocket 通，S→ROS 方向 OK |
| **桥接未连接**（红色） | 地址错 / 桥接没起 / 端口被挡 |
| 底部 `指令 ROS /aim_sim/command · seq 1234` | 指令正在被接受（**最强信号**） |
| 底部 `拒收 8` 且数字一直涨 | 指令格式/session/时间戳不对，被 ControlGate 丢了 |

### 第 2 层：命令行看数据流

```bash
# ① 节点在不在
ros2 node list | grep aim_sim
#   /aim_sim/bridge

# ② 话题在不在（必须是 /aim_sim/xxx，不是 /xxx）
ros2 topic list | grep aim_sim
#   /aim_sim/armors  /aim_sim/command  /aim_sim/gimbal  /aim_sim/telemetry

# ③ 频率对不对（网页连上且勾了外部控制 → ≈ 60 Hz）
ros2 topic hz /aim_sim/armors

# ④ 看一眼真实数据
ros2 topic echo /aim_sim/gimbal --once
```

### 第 3 层：一键自检（推荐，跑这一条就够）

```bash
cd ~/rm_aim_lab_workspace
source ros2_ws/install/setup.bash
./tools/check_link.sh --sweep
```

它会依次检查：ROS 环境 → 编译产物 → 桥接节点 → 9090 端口 → 四个话题 → 实际频率 → 数据样本，
最后 **主动发 6 s 正弦 yaw 指令，看云台有没有跟着转**（这一步同时验证了 session、时间戳、ControlGate、双向链路）。

全绿输出：

```
通过 11 项，失败 0 项
 ✅ 链路正常，可以开始跑自瞄节点
```

> 只查链路不主动发指令：`./tools/check_link.sh`
> 只想看数据不发指令：`python3 tools/probe_bridge.py`

---

## 3. 以后每次"写代码 → 看成果"的标准流程

```
① 改代码（VS Code 里编辑 src/*.cpp）
        ↓
② 编译     colcon build --packages-select <你的包> --symlink-install
        ↓
③ 重启节点 Ctrl+C 旧的 → ros2 run <你的包> <可执行文件> --ros-args -p use_sim_time:=true
        ↓
④ 跑一轮   网页里按 R 重置（恢复血量、清空统计、换 session）
        ↓
⑤ 看结果   顶部"有效命中 xx/xx xx%" + 底部"落地/命中每秒/首发命中" + 底部"拒收"
        ↓
⑥ 不满意 → 回到 ①
```

**两个提速技巧：**

- **加 `--symlink-install`**（只在第一次加）：之后编译更快，改 launch/参数不用重装。
  C++ 源码改了仍然要重新 `colcon build`（是增量编译，几秒钟）。
- **不用重启网页**：桥接断开后页面自动重连（2 s 一次）。改节点不用刷新浏览器；只有改 `web_sim/*.js` 才需要 `Cmd+Shift+R` 硬刷新。

**每次看结果的三个关键数字：**

| 位置 | 数字 | 说明 |
|---|---|---|
| 顶部 | `有效命中 18/19 94.7%` | 你的算法真正的成绩 |
| 底部 | `命中/秒`、`首发命中` | 命中速度快不快、第一发准不准 |
| 底部 | `拒收 N` | 只要一直涨，说明你的指令根本没生效（先查 session/时间戳） |

---

## 4. 代码和模拟器到底怎么配合

### 4.1 数据流

```
┌───────────── Mac 浏览器 ─────────────┐        ┌──────── Ubuntu ────────┐
│  Three.js 3D + 物理仿真              │        │                        │
│  · 弹道/命中/血量/云台伺服            │        │  bridge 节点            │
│  · 60 Hz 把"真值"打包成 JSON ────────┼─WS────►│  JSON → ROS 消息        │
│  · 收到指令包 → 驱动云台/开火 ◄──────┼────────┤  ROS → JSON            │
└──────────────────────────────────────┘        │        ↕ DDS           │
                                                │  你的自瞄节点            │
                                                │  订阅观测 / 发布指令     │
                                                └────────────────────────┘
```

**一句话：仿真只负责"世界真相 + 执行动作"，你的代码只负责"看数据 → 做决策"。**

### 4.2 三个话题（你只需要碰这三个）

| 话题 | 方向 | 内容 | 频率 |
|---|---|---|---|
| `/aim_sim/armors` | 仿真 → 你 | 每个**可见**装甲的 4 个角点（odom 坐标）、`session_id`、`header.stamp`（仿真时间） | 60 Hz |
| `/aim_sim/gimbal` | 仿真 → 你 | 云台**实际** yaw/pitch（弧度，ROS 约定 **pitch 上正**）与角速度 | 60 Hz |
| `/aim_sim/telemetry` | 仿真 → 你 | 弹速 23 m/s、重力 9.7833、枪管长 0.22 m、射频 10 Hz、出膛延迟 15 ms | 60 Hz |
| `/aim_sim/command` | 你 → 仿真 | `yaw`、`pitch`、`enable`、`fire` + **必须回抄** `header` 与 `session_id` | 建议 50 Hz |

### 4.3 命令为什么会被丢——三条铁律

桥接的 `ControlGate` 会检查每一条指令，任何一条不满足就**静默丢弃**（网页底部"拒收"会 +1）：

1. **session 必须等于当前观测的 session**
   → 做法：`cmd.session_id = armors_->session_id;`（不要自己造）
2. **`header.stamp` 必须是当前仿真时间，且不能比上一次旧**
   → 做法：`cmd.header = armors_->header;`（直接回抄）
   → 这也是运行节点必须加 `--ros-args -p use_sim_time:=true` 的原因：不加的话你的节点用自己的墙钟，时间戳和 `sim_time` 差几秒，全被当成过期
3. **`header.frame_id` 必须是 `"odom"`**（回抄 header 自动满足）

另外：**超过 250 ms 没有新指令 → 自动停控制、停开火**（防失控）。所以要用定时器持续发，不能只发一次。

### 4.4 一轮仿真的时序

```
网页 60Hz ──armors──► 你的节点（50Hz 定时器）
                          │  算 yaw/pitch
                          ▼
                     command(带 session+stamp) ──► ControlGate 校验 ──► 仿真
                                                                      │ 云台按伺服模型转
                                                                      │ 到位 + fire=true → 每 10Hz 发弹
                                                                      │ 弹丸按 23m/s + 重力飞行
                                                                      ▼
                                                            命中判定 → 顶部命中数 +1
```

`fire=true` 不代表一定开火：仿真还要看"射频 10 Hz"和"弹丸存活/血量"，命中也受目标运动与装甲倾角影响。

---

## 5. 断链排查表

| 现象 | 优先检查 |
|---|---|
| `ros2 topic list` 里是 `/armors` 而不是 `/aim_sim/armors` | 节点命名空间被改了；用自带 launch 启动，别手工 `ros2 run` 桥接 |
| 网页"桥接未连接" | ① 桥接进程在吗 ② `ws://IP:9090` 的 IP 对不对 ③ VM 是否做了 9090 端口转发 ④ Ubuntu 防火墙 `sudo ufw allow 9090` |
| 连上了但 `/aim_sim/armors` 没有频率 | 网页没勾 **外部控制**，或仿真被 `P` 暂停（暂停时只发空数组） |
| 频率只有几 Hz | Wi-Fi 抖动 / VM 资源不足；把 `poll_hz` 调低到 50 也会降频，属正常 |
| "拒收"一直涨 | session 没回抄 / 没加 `use_sim_time` / 发了 `NaN` / `frame_id` 不是 odom |
| 云台不动、但拒收不涨 | 你发的是 `enable=false`；或算出来的角度超 ±1000 被拒 |
| 云台转了但打不中 | 弹道补偿没做（重力和 0.22 m 枪管偏移）、或用了**指令角**而不是**实际角**判断到位 |
| 打中了但顶部数字不动 | 目标不在相机视口内（is_visible 规则），或血量已被打空 |

---

## 6. 最快的验证顺序（照抄）

```bash
# 终端 A（Ubuntu）——桥接
cd ~/rm_aim_lab_workspace && source /opt/ros/jazzy/setup.bash
cd ros2_ws && colcon build --packages-select rm_aim_sim_bridge student_auto_aim --symlink-install && cd ..
source ros2_ws/install/setup.bash
ros2 launch rm_aim_sim_bridge web_bridge.launch.xml

# 终端 B（Mac）——网页
cd rm_aim_lab_workspace && ./run_web.sh
#   浏览器 → 填 ws://<IP>:9090 → 勾"外部控制" → 顶栏变绿

# 终端 C（Ubuntu）——先自检，再跑节点
source /opt/ros/jazzy/setup.bash && source ~/rm_aim_lab_workspace/ros2_ws/install/setup.bash
~/rm_aim_lab_workspace/tools/check_link.sh --sweep     # 先确认链路
ros2 run student_auto_aim aim_node --ros-args -p use_sim_time:=true   # 再看闭环
```

VS Code 里也能直接点：`Terminal → Run Task` → **⑥ 链路自检**。
