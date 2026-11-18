# 已装好 ROS 2 + 已有 ~/aim_lab_ws 时的接入步骤

前提：Ubuntu 24.04 虚拟机已装 ROS 2 Jazzy，已有工作空间 `~/aim_lab_ws`（内含 `src/`）。
下面所有 `ros2` / `colcon` 命令都在**虚拟机终端**执行；网页在 **Mac** 打开。

---

## 1. 安装桥接依赖（只需一次）

```bash
sudo apt install -y libboost-dev nlohmann-json3-dev build-essential cmake
```

## 2. 把桥接包放进你的 aim_lab_ws

假设工程已拷到虚拟机 `~/rm_aim_lab_workspace`：

```bash
cd ~/aim_lab_ws
cp -r ~/rm_aim_lab_workspace/ros2_ws/src/rm_aim_sim_bridge src/
ls src/          # 应看到 rm_aim_sim_bridge
```

> 软链接也行：`ln -s ~/rm_aim_lab_workspace/ros2_ws/src/rm_aim_sim_bridge src/rm_aim_sim_bridge`

## 3. 编译

```bash
source /opt/ros/jazzy/setup.bash
cd ~/aim_lab_ws
colcon build --packages-select rm_aim_sim_bridge
source install/setup.bash
```

看到 `Summary: 1 package finished` 即成功。以后**每开新终端**都要 source 这两条。

## 4. 启动桥接

```bash
source /opt/ros/jazzy/setup.bash
source ~/aim_lab_ws/install/setup.bash
ros2 launch rm_aim_sim_bridge web_bridge.launch.xml
# 或（等价，可指定端口）
ros2 run rm_aim_sim_bridge web_bridge_node --ros-args -p port:=9090
```

期望输出：`Waiting for web simulator on ws://0.0.0.0:9090`。
**这个终端保持不关**（Ctrl+C 停止）。

## 5. Mac 侧连接网页

1. 打开网页仿真（`./run_web.sh` → `http://localhost:8080`）
2. 左侧 **03 ROS 桥接 → 桥接地址**：`ws://<虚拟机IP>:9090`（VM 桥接网络）；若 VM 用 NAT 端口转发则填 `ws://localhost:9090`
3. 勾选 **外部控制（ROS）**
4. 顶部状态应变为绿色 **“桥接已连接”**

## 6. 验证话题（第三个终端）

```bash
source /opt/ros/jazzy/setup.bash
source ~/aim_lab_ws/install/setup.bash

ros2 topic hz /aim_sim/armors        # ≈ 60 Hz
ros2 topic echo /aim_sim/gimbal --once
ros2 topic echo /aim_sim/telemetry --once
ros2 topic echo /clock --once
```

`armors` 有数据但 `armors:` 为空列表 → 目标背对/出画/被击毁/暂停，检查场景。

## 7. 跑通最小示例节点（可选但推荐）

```bash
cp -r ~/rm_aim_lab_workspace/ros2_ws/src/student_auto_aim ~/aim_lab_ws/src/
cd ~/aim_lab_ws
colcon build --packages-select student_auto_aim
source install/setup.bash
ros2 run student_auto_aim aim_node --ros-args -p use_sim_time:=true
```

它会：选第一块可见装甲 → 四角求中心 → yaw 直接解算 → pitch 迭代重力补偿 → 到位开火。
看到云台自动转动并打出命中，就说明整条链路通了。

## 8. 你自己的学员包

1. `package.xml` 加依赖：

```xml
<depend>rclcpp</depend>
<depend>rm_aim_sim_bridge</depend>
```

2. 编译前先 source `~/aim_lab_ws/install/setup.bash`（提供自定义消息）
3. 运行加 `-p use_sim_time:=true`，让节点用仿真时间

```bash
cd ~/aim_lab_ws
colcon build --packages-select <你的包名>
source install/setup.bash
ros2 run <你的包名> <可执行名> --ros-args -p use_sim_time:=true
```

---

## 常见坑速查

| 现象 | 原因 / 处理 |
|---|---|
| `ros2 launch` 找不到包 | 忘了 `source ~/aim_lab_ws/install/setup.bash` |
| 网页“桥接未连接” | VM 防火墙 `sudo ufw allow 9090`；网络模式；Mac 上 `nc -vz <VM_IP> 9090` |
| 连上但云台不动 | 未勾“外部控制”；学员节点没发指令；`session_id`/header 未复制；pitch 符号写反 |
| 转到位但打低 | 没做重力补偿；忽略了 0.22 m 枪管偏移；弹速用了别的值（应为 telemetry 的 23） |
| 开火就掉命中率 | 用指令角判断到位，应改用 `/aim_sim/gimbal` 的实际角 |
| 改完包没生效 | 只 build 没 source，或另一个终端 source 的是旧 install |
| 报 `Boost` 找不到 | `sudo apt install libboost-dev`（ARM64 同样适用） |
