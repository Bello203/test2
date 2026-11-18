# 保姆级：全部刷新 / 重启 / 验收

> 场景：你改了代码、或者从别人那儿拿了新版本（比如加了 10 m 射程的 `app.js`），
> 需要把**网页 + 桥接 + 节点**全部换成新的，并且确认真的生效了。

---

## 第 0 步：先判断"这次改了什么"，决定要刷哪一层

| 你改动了 | 需要做什么 | 大概耗时 |
|---|---|---|
| `web_sim/*.js`、`web_sim/index.html`（画面、面板、物理、标记） | **只硬刷新浏览器**，不用重启任何进程 | 3 秒 |
| `ros2_ws/src/student_auto_aim/**.cpp`（你的算法） | `colcon build` 该包 → 重启节点 | 15 秒 |
| `ros2_ws/src/rm_aim_sim_bridge/**.cpp` 或 `msg/*.msg` | 重编桥接 → 重启桥接 → 网页重新勾"外部控制" | 40 秒 |
| 整包替换（新 zip / 新文件夹） | **第 1 节全量刷新** | 2 分钟 |

> 记住一个规律：**网页侧的东西 = 刷新浏览器；ROS 侧的东西 = 重新编译 + 重启进程**。
> 两者唯一的结合点是 9090 端口，只要桥接重启过，网页会自动重连（2 秒一次），但"外部控制"勾选会失效，需要重新勾。

---

## 第 1 节：全量刷新（最常用，照着敲）

### 1.1 停掉所有旧进程

在**任意 Ubuntu 终端**：

```bash
pkill -f web_bridge_node
pkill -f "http.server 8080"
pkill -f aim_node
```

确认清干净（**应该是空输出**）：

```bash
ros2 node list | grep aim_sim
pgrep -af "http.server 8080"
```

如果还有残留（比如 `ros2 launch` 的 launch 进程占着终端）：

```bash
pkill -f "ros2 launch"
```

同时把之前那三个终端窗口**按 Ctrl+C 或直接关掉**，避免混淆。

### 1.2 换成新文件

**如果只是拿到个别文件**（比如只有 `app.js` 和 `index.html`）：直接覆盖到
`~/rm_aim_lab_workspace/web_sim/` 下，两个文件都要换，别只换一个。

**如果是整个新 zip**：解压后整体覆盖，注意**保留你原有的 `ros2_ws`**（里面有你自己的算法代码），
覆盖前先备份：

```bash
cd ~ && cp -r rm_aim_lab_workspace rm_aim_lab_workspace.bak.$(date +%m%d%H%M)
```

**验证文件真的换了**（关键一步，很多人以为换了其实没换）：

```bash
cd ~/rm_aim_lab_workspace
grep -n 'id="dist"' web_sim/index.html | grep 'max="10"'   # 有输出 = 距离上限已是 10
grep -n 'i = 1; i <= 10' web_sim/app.js                    # 有输出 = 地面标记到 10 m
```

两条都有输出 = 新文件到位（`app.js` 里那行大约在第 96 行，行号不必较真，有输出就行）。

### 1.3 重新编译 ROS 侧（改了 C++ 或 msg 才需要）

```bash
source /opt/ros/jazzy/setup.bash
cd ~/rm_aim_lab_workspace/ros2_ws
colcon build --packages-select rm_aim_sim_bridge student_auto_aim
cd ..
source ros2_ws/install/setup.bash
```

**看到这行才算成功**：

```
Summary: 2 packages finished [xx.xs]
```

> 只改了 `web_sim` 里的 js/html？**这一步可以跳过**，省 20 秒。

### 1.4 开三个终端（每个都要先敲"开场白"）

**开场白（每个新终端都要）**：

```bash
source /opt/ros/jazzy/setup.bash
cd ~/rm_aim_lab_workspace && source ros2_ws/install/setup.bash
```

**终端 1 —— 桥接**

```bash
ros2 launch rm_aim_sim_bridge web_bridge.launch.xml
```
期望输出（最后一行）：
```
[bridge-1] [INFO] [...]: Waiting for web simulator on ws://0.0.0.0:9090 (ROS pitch is positive UP)
```

**终端 2 —— 网页服务**

```bash
cd web_sim && python3 -m http.server 8080
```
期望输出：
```
Serving HTTP on 0.0.0.0 port 8080 (http://0.0.0.0:8080/) ...
```

**终端 3 —— 你的节点**（先别急着开，等网页连上再开）

```bash
ros2 run student_auto_aim aim_node --ros-args -p use_sim_time:=true
```

### 1.5 Mac 浏览器（按顺序，不能跳）

1. **硬刷新**：`Cmd + Shift + R`（普通 `Cmd+R` 可能还用缓存里的旧 `.js`）
2. 打开 `http://localhost:8080`
3. 左侧 **03 ROS 桥接 → 桥接地址**：确认是 `ws://localhost:9090`，**按回车**
4. 勾选 **外部控制（ROS）**

---

## 第 2 节：只想快速刷某一层（省时间）

### A. 只改了网页（最常见）

```bash
# Ubuntu 什么都不用动，Mac 浏览器里：
Cmd + Shift + R
```
如果连硬刷新都看不到变化，说明 `python3 -m http.server` 是从别的目录起的：
确认它是在 `~/rm_aim_lab_workspace/web_sim` 下启动的。

### B. 只改了你的算法（student_auto_aim）

```bash
source /opt/ros/jazzy/setup.bash
cd ~/rm_aim_lab_workspace/ros2_ws
colcon build --packages-select student_auto_aim
cd .. && source ros2_ws/install/setup.bash
# 然后回终端 3：Ctrl+C 停掉旧节点，重新 ros2 run
```

### C. 改了桥接（端口、话题、ControlGate）

```bash
pkill -f web_bridge_node
source /opt/ros/jazzy/setup.bash
cd ~/rm_aim_lab_workspace/ros2_ws
colcon build --packages-select rm_aim_sim_bridge
cd .. && source ros2_ws/install/setup.bash
ros2 launch rm_aim_sim_bridge web_bridge.launch.xml
# 网页会自己重连，但要重新勾"外部控制"（session 已变）
```

---

## 第 3 节：验收清单（四关，全过才算真通了）

| # | 在哪看 | 合格标准 |
|---|---|---|
| 1 | 网页顶部状态栏 | **桥接已连接**（绿色），不是红色 |
| 2 | Ubuntu 终端 | `ros2 topic hz /aim_sim/armors` → `average rate: 60.x` |
| 3 | 网页底部 | 出现 `指令 ROS /aim_sim/command · seq 1234`，且 **`拒收` 数字不再增长** |
| 4 | 画面 | 云台跟随你的节点转动、打中装甲后顶部"有效命中"数字上涨 |

一条命令看第 2、3 关的底层：

```bash
# 终端 4
source /opt/ros/jazzy/setup.bash && source ~/rm_aim_lab_workspace/ros2_ws/install/setup.bash
ros2 topic hz /aim_sim/armors      # Ctrl+C 退出
ros2 topic echo /aim_sim/gimbal --once
```

### 顺便确认"新功能真的生效"

- 地面标记应能看到 **`10 m`** 那一块（旧版只到 `8 m`）
- 距离框填 `10` 回车后，**视角自动拉远**，靶车和云台同时在画面里

---

## 第 4 节：全刷时最常见的 8 个坑

| 现象 | 原因 | 解决 |
|---|---|---|
| 页面毫无变化 | 没硬刷新 / 服务启在了别的目录 | `Cmd+Shift+R`；确认 `cd web_sim` 后起的服务 |
| `Package 'rm_aim_sim_bridge' not found` | 没 `source install/setup.bash` | 每个新终端都要 source 那两个文件 |
| `colcon build` 报找不到 `rm_aim_sim_bridge` | 先编 `student_auto_aim` 时桥接还没编 | 两个包一起编：`--packages-select rm_aim_sim_bridge student_auto_aim` |
| `Address already in use` (9090/8080) | 旧进程没死 | `pkill -f web_bridge_node`、`pkill -f "http.server 8080"` |
| 顶栏一直红 | 桥接没起 / IP 错 / 端口转发没配 | 先 `pgrep -af web_bridge_node`，再 `curl -v http://localhost:9090` 看是否能连上（能连上会报 WebSocket 握手错误，这也算通） |
| 绿了但没数据 | 忘了勾 **外部控制** 或按了 `P` 暂停 | 勾选 + 看状态栏是否 `RUNNING` |
| 底部"拒收"一直涨 | 节点没加 `use_sim_time:=true` | 加上重启节点 |
| 云台跟着转但打不中 | 10 m 需要抬枪约 2.7°，纯几何瞄准必打低 | 做重力补偿（参考 `student_auto_aim/src/aim_node.cpp`） |

---

## 附：一屏速查（贴在便签上）

```bash
# 停
pkill -f web_bridge_node; pkill -f "http.server 8080"; pkill -f aim_node
# 编
source /opt/ros/jazzy/setup.bash && cd ~/rm_aim_lab_workspace/ros2_ws \
  && colcon build --packages-select rm_aim_sim_bridge student_auto_aim \
  && cd .. && source ros2_ws/install/setup.bash
# 起（三个终端）
ros2 launch rm_aim_sim_bridge web_bridge.launch.xml
cd ~/rm_aim_lab_workspace/web_sim && python3 -m http.server 8080
ros2 run student_auto_aim aim_node --ros-args -p use_sim_time:=true
# 验
ros2 topic hz /aim_sim/armors
```
