#!/usr/bin/env bash
# 在 Ubuntu（ARM64/x86_64 均可，需 ROS 2 Jazzy 或 Humble）上编译并启动桥接：./run_bridge.sh
set -e
cd "$(dirname "$0")"

# 识别 ROS 环境：优先当前环境，再尝试 Jazzy / Humble
if [ -z "$ROS_DISTRO" ]; then
  for d in jazzy humble; do
    if [ -f "/opt/ros/$d/setup.bash" ]; then
      set +u; source "/opt/ros/$d/setup.bash"; set -u
      break
    fi
  done
fi
if [ -z "$ROS_DISTRO" ]; then
  echo "错误：未找到 ROS 2 环境，请先 source /opt/ros/<distro>/setup.bash" >&2
  exit 1
fi
echo "使用 ROS 2 $ROS_DISTRO"

# 首次自动编译
if [ ! -f "ros2_ws/install/setup.bash" ]; then
  echo "首次运行：编译桥接..."
  cd ros2_ws
  rosdep install --from-paths src --ignore-src --rosdistro "$ROS_DISTRO" -r -y || true
  colcon build --packages-select rm_aim_sim_bridge
  cd ..
fi

set +u
source ros2_ws/install/setup.bash
set -u
echo "桥接启动：ws://0.0.0.0:9090  （在网页仿真左下角填 ws://<本机IP>:9090 并勾选“外部控制”）"
echo "按 Ctrl+C 停止"
ros2 launch rm_aim_sim_bridge web_bridge.launch.xml
