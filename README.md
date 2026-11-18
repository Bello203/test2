# RoboMaster Aim Lab Web（ROS 2 桥接版）

功能与 [rm_aim_sim_training](https://github.com/Supzj9998/rm_aim_sim_training) 完全等效的 3D 自瞄训练仿真，
把 Godot 桌面端替换为 **Three.js 网页端**，把共享内存桥接替换为 **C++ ROS 2 WebSocket 桥接**。

```
浏览器 3D 仿真（Mac / 任意设备）  ⇄  WebSocket  ⇄  C++ ROS 2 桥接（Ubuntu，ARM64/x86_64 均可）  ⇄  ROS 话题  ⇄  学员自瞄节点
```

## 与原版的兼容性

| 项目 | 状态 |
|---|---|
| ROS 话题（`/aim_sim/armors`、`/aim_sim/gimbal`、`/aim_sim/telemetry`、`/aim_sim/command`、`/clock`） | ✅ 完全一致 |
| 消息包名与消息类型（`rm_aim_sim_bridge/msg/*`） | ✅ 定义逐字一致，学员包零修改 |
| session_id / 会话失效 / 观测时效（250 ms）/ 指令顺序水印 | ✅ ControlGate 源码原样复用 |
| pitch 符号约定（ROS 上正、yaw 左正）、odom 坐标（云台旋转中心为原点） | ✅ 一致 |
| 弹道 / 命中 / 血量 / 装甲几何 / 云台伺服参数 | ✅ 从 `simulation.gd` / `default.cfg` 1:1 移植，含闭环测试 |

差异只有一点：桥接与仿真之间不再走 `/dev/shm` 共享内存，改为 WebSocket（默认 `ws://0.0.0.0:9090`）。

## 快速开始

> 详细分场景教程：
> - **连接模拟器 / 验证连通 / 写代码的日常流程** → [`docs/how_to_connect.md`](docs/how_to_connect.md) ← 先看这个
> - 从零装 ROS 2 + 虚拟机网络配置 → [`docs/ubuntu_vm_guide.md`](docs/ubuntu_vm_guide.md)
> - **已装好 ROS 2、已有 `~/aim_lab_ws` 工作空间** → [`docs/aim_lab_ws_quickstart.md`](docs/aim_lab_ws_quickstart.md)


### 0. VS Code 直接打开

把整个文件夹拖进 VS Code，或双击 `rm_aim_lab.code-workspace`。`Terminal → Run Task` 里已内置全部任务：

| 任务 | 作用 |
|---|---|
| ① 启动网页仿真 | 在 8080 端口起静态服务（Mac/Linux） |
| ② 物理核心自测 | 跑 28 项闭环测试 |
| ③ ROS2：编译桥接 / 启动桥接 | colcon 编译 + `ros2 launch` |
| ④ ROS2：编译 / 运行示例自瞄节点 | 一条龙看闭环 |
| ⑤ 起全套 | 网页 + 桥接 + 自瞄 并行启动 |

### 1. 渲染端（Mac，浏览器）

```bash
./run_web.sh            # 默认 8080 端口
# 打开 http://localhost:8080
```

### 2. 桥接端（Ubuntu，首次自动 colcon 编译）

```bash
sudo apt install libboost-dev nlohmann-json3-dev   # 如未安装
./run_bridge.sh        # 识别 Jazzy / Humble，编译并启动 ws://0.0.0.0:9090
```

ARM64 注意：依赖只有 Boost.Beast（纯头文件）与 nlohmann-json，无任何 x86 专属代码，
树莓派 / 香橙派 / Jetson 等 ARM64 设备直接编译即可。

### 3. 接入学员节点

```bash
source /opt/ros/<distro>/setup.bash
source <本仓库>/ros2_ws/install/setup.bash      # 提供 rm_aim_sim_bridge 消息
cd ros2_ws && colcon build --packages-select training
source install/setup.bash
ros2 run training aim_node --ros-args -p use_sim_time:=true
```

网页端左下角“桥接地址”填 `ws://<Ubuntu 的 IP>:9090`（同机则 `ws://localhost:9090`），
勾选 **外部控制（ROS 桥接）**。话题即可用 `ros2 topic echo /aim_sim/armors` 验证。

### 4. 没有 ROS 环境时

勾选 **本地演示自瞄**，内置的简单瞄准节点会自动跟踪、重力补偿并开火，用于验证仿真本身。

## 网页端操作（界面复刻原版 AIM LAB）

| 操作 | 方式 |
|---|---|
| 暂停 / 重置 | `P` / `R`，左侧栏按钮 |
| 切换视角（第三人称 ↔ 第一人称） | `V` |
| **手动云台** | 云台控制面板 Yaw/Pitch 步进（°，上正） |
| **按住瞄准 / F** | 云台自动瞄准最优可见装甲（不开火） |
| **按住发射 / Space** | 手动持续开火 |
| **本机自瞄控制** | 内置自瞄：自动跟踪 + 重力补偿 + 到位开火 |
| 平移（梯形加减速）/ 自转 | 左侧 “开启平移/自转” + 参数展开 |
| 弹速、单发伤害 | 左侧 “02 发射与响应” |
| 相机画中画（1440×1080，FOV 45°，带十字线） | 右上 “云台相机 / CAMERA” |
| 地面距离标记 1m~8m | 左侧 “04 场景” 可开关 |
| 装甲四角 odom 数值 | 左侧 “04 场景” 开关 |

## 网页端 ↔ 桥接的 WebSocket 协议

仿真 → 桥接（60 Hz，与原版 `snapshot()` 字段一致，另加 `publisher_id`、`publication`、`ipc`）：

```json
{"protocol":"rm_aim_sim/2","type":"state","publisher_id":"web-123","session_id":"...-...",
 "sim_time":1.23,"paused":false,"ipc":{"enabled":true},
 "gimbal":{"yaw":0,"pitch":0,"yaw_vel":0,"pitch_vel":0,"origin":[0,0,0.65]},
 "weapon":{"speed":23,"rate":10,"delay":0.015,"barrel_length":0.22,"gravity":9.7833,"damage":20},
 "truth":{"armors":[{"id":0,"corners":[[x,y,z],...]}]},
 "camera":{"armors":[{"id":0}]} }
```

桥接 → 仿真（100 Hz）：

```json
{"protocol":"rm_aim_sim/2","type":"command","publisher_id":"web-123","session_id":"...-...",
 "seq":42,"control":true,"fire":false,"yaw":0.31,"pitch":-0.05}
```

`pitch` 为仿真内部约定（下正），桥接已在 ControlGate 中做 ROS ↔ 仿真取反，学员无感。

## 目录结构

```
rm_aim_lab_workspace/
├── rm_aim_lab.code-workspace      # 双击即用：VS Code 多根工作区
├── .vscode/tasks.json             # 全部一键任务（起仿真 / 编译 / 起桥接 / 跑自瞄）
├── run_web.sh                     # Mac：起网页服务
├── run_bridge.sh                  # Ubuntu：编译并启动桥接
├── web_sim/
│   ├── index.html                 # 页面与控制面板
│   ├── app.js                     # Three.js 渲染 + WS 客户端 + 演示自瞄
│   ├── sim_core.js                # 仿真核心（simulation.gd 1:1 移植）
│   └── test_core.mjs              # 核心闭环测试（node test_core.mjs）
├── ros2_ws/src/
│    ├── rm_aim_sim_bridge/
│    │    ├── msg/                   # 与原版逐字一致
│    │    ├── include/.../control_gate.hpp  # 与原版逐字一致
│    │    ├── src/web_bridge_node.cpp       # WebSocket 服务器 + ROS 发布/订阅（原 bridge_node 逻辑移植）
│    │    └── launch/web_bridge.launch.xml
│    └── training
│         ├── include/aim_node.hpp
│         ├── aim_node.main
│         └── aim_node.cpp     
├── tools/
│   ├── check_link.sh              # 一键自检：节点/端口/话题/频率 + 下行指令测试
│   └── probe_bridge.py            # 探针：打印 session、装甲数、云台角，可选 --sweep
└── docs/                          # 连接教程 / 虚拟机接入 / 已有工作空间接入
```

## 验证状态

- ✅ 核心物理闭环测试 28/28 通过（`node web_sim/test_core.mjs`）：装甲几何、静止/动靶命中、
  伺服收敛、相机可见性、session 重置、snapshot 协议结构
- ✅ C++ 桥接依赖均为 ARM64 兼容（Boost.Beast 头文件库 + nlohmann-json）
- ⚠️ 桥接节点未在实机 ROS 2 上编译运行过，首次编译如遇小问题（头文件路径等）按报错微调即可

## 与原版一致的前提说明

本仿真不包含空气阻力、散布、完整遮挡；命中率用于算法与接口验证，不等同于实车命中率。
原始项目 MIT License（装甲贴图来自 LabelMaster）。
