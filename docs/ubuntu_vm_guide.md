# Ubuntu 24.04 虚拟机接入教程（ROS 2 Jazzy）

目标：Mac 上跑网页仿真渲染，Ubuntu 24.04 虚拟机里跑 C++ 桥接与学员自瞄节点。

```
Mac 浏览器（3D 渲染）
      │  WebSocket ws://<虚拟机IP>:9090
      ▼
Ubuntu 24.04 VM：web_bridge_node ──ROS 话题── 学员自瞄节点
```

> 虚拟机**不需要 3D 加速**，桥接是纯无界面节点，2 核 / 4 GB 内存足够。
> Apple Silicon 请用 **ARM64** 版 Ubuntu 24.04 镜像；ROS 2 Jazzy 官方提供 arm64 包。

---

## 0. 网络模式怎么选（最容易踩坑的一步）

| 虚拟机软件 | 推荐设置 | 说明 |
|---|---|---|
| UTM / VMware Fusion / Parallels | **桥接（Bridged）** | VM 直接拿局域网 IP，Mac 用 `ws://<VM IP>:9090` 直连，最省事 |
| 只能用 NAT | **端口转发** 主机 9090 → 虚拟机 9090 | 主机侧用 `ws://localhost:9090` |

查虚拟机 IP：

```bash
ip -4 addr show | grep inet
```

在 Mac 上验证连通性（先启动桥接再做）：

```bash
nc -vz <VM_IP> 9090
```

---

## 1. 安装 ROS 2 Jazzy（Ubuntu 24.04 默认发行版）

```bash
sudo apt update && sudo apt install -y curl software-properties-common

# 官方源（Ubuntu 24.04 = noble）
sudo add-apt-repository universe -y
sudo curl -sSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.key \
  -o /usr/share/keyrings/ros-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/ros-archive-keyring.gpg] \
http://packages.ros.org/ros2/ubuntu $(. /etc/os-release && echo $UBUNTU_CODENAME) main" \
  | sudo tee /etc/apt/sources.list.d/ros2.list > /dev/null

sudo apt update
sudo apt install -y ros-jazzy-ros-base        # 桥接够用；要 GUI 工具再装 ros-jazzy-desktop
```

环境变量（写进 `~/.bashrc` 一劳永逸）：

```bash
echo "source /opt/ros/jazzy/setup.bash" >> ~/.bashrc
source ~/.bashrc
```

## 2. 安装编译依赖

```bash
sudo apt install -y build-essential cmake git \
  python3-colcon-common-extensions python3-rosdep \
  libboost-dev nlohmann-json3-dev

sudo rosdep init 2>/dev/null || true    # 已初始化会报错，忽略
rosdep update
```

## 3. 把工程拷进虚拟机

在 **Mac 终端**执行（工程目录按你本地实际路径替换）：

```bash
scp -r ~/WorkBuddy/2026-11-02-13-39-04/rm_aim_lab_workspace <用户名>@<VM_IP>:~/
```

或在 VM 里 `git clone`（若你已推到远端）。

## 4. 编译桥接

```bash
cd ~/rm_aim_lab_workspace
source /opt/ros/jazzy/setup.bash
cd ros2_ws
rosdep install --from-paths src --ignore-src --rosdistro jazzy -r -y
colcon build --packages-select rm_aim_sim_bridge
source install/setup.bash
```

编译成功后应看到 `Summary: 1 package finished`。
也可以直接用仓库脚本（自动识别发行版并编译）：

```bash
cd ~/rm_aim_lab_workspace && ./run_bridge.sh
```

## 5. 启动桥接

```bash
cd ~/rm_aim_lab_workspace
source /opt/ros/jazzy/setup.bash
source ros2_ws/install/setup.bash
ros2 launch rm_aim_sim_bridge web_bridge.launch.xml
```

正常输出：

```
[bridge]: Waiting for web simulator on ws://0.0.0.0:9090 (ROS pitch is positive UP)
```

## 6. Mac 侧连接

1. 打开网页仿真（`./run_web.sh` → `http://localhost:8080`）
2. 左侧 **03 ROS 桥接 → 桥接地址** 填 `ws://<VM_IP>:9090`（NAT 转发则 `ws://localhost:9090`）
3. 勾选 **外部控制（ROS）**，顶部应显示绿色 **“桥接已连接”**

## 7. 验证话题（VM 终端）

```bash
# 装甲四角（需要网页勾选外部控制、目标在视场内）
ros2 topic hz   /aim_sim/armors
ros2 topic echo /aim_sim/armors --once

ros2 topic echo /aim_sim/gimbal --once
ros2 topic echo /aim_sim/telemetry --once
ros2 topic echo /clock --once
```

期望：`armors` 约 60 Hz，`frame_id: odom`，`session_id` 形如 `web-123456789/1751...-1234`。

## 8. 接入学员节点

学员包 `package.xml` 里必须有：

```xml
<depend>rclcpp</depend>
<depend>rm_aim_sim_bridge</depend>
```

编译运行：

```bash
source /opt/ros/jazzy/setup.bash
source ~/rm_aim_lab_workspace/ros2_ws/install/setup.bash     # 提供 rm_aim_sim_bridge 消息
cd ~/student_ws
colcon build --packages-select student_auto_aim
source install/setup.bash
ros2 run student_auto_aim aim_node --ros-args -p use_sim_time:=true
```

联调建议：先固定 yaw/pitch 且 `fire=false`，确认转向方向正确，再逐步加解算与开火。

## 9. 常见问题

| 现象 | 排查 |
|---|---|
| 网页一直“桥接未连接” | VM 防火墙 `sudo ufw status`；网络模式是否桥接；`nc -vz VM_IP 9090` |
| 连接成功但云台不动 | 是否勾选“外部控制”；学员节点是否持续发布（>4 Hz）；`session_id`/header 是否复制正确 |
| 话题有但 `armors` 为空 | 目标背对相机 / 出画 / 已击毁 / 暂停 / 未开外部控制（与原版规则一致） |
| 转到位但打低 / 动靶打偏 | 检查重力补偿、枪口 0.22 m 偏移、弹速 23 m/s、运动提前量 |
| `ros2 topic hz` 无输出 | `ROS_DOMAIN_ID` 不一致；rosdep 依赖未装导致节点未真正启动 |
| 编译报找不到 boost | `sudo apt install libboost-dev`；ARM64 同样适用 |
