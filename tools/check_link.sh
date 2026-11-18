#!/usr/bin/env bash
# 一键自检：桥接进程 / WebSocket 端口 / ROS 话题 / 数据频率 / 下行指令
# 用法：./tools/check_link.sh          （只查链路）
#      ./tools/check_link.sh --sweep  （再主动发指令验证下行）
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
ok()   { printf "  \033[32m✅ %s\033[0m\n" "$1"; PASS=$((PASS+1)); }
bad()  { printf "  \033[31m❌ %s\033[0m\n" "$1"; FAIL=$((FAIL+1)); }
warn() { printf "  \033[33m⚠️  %s\033[0m\n" "$1"; }

echo "=============================================="
echo " RM Aim Lab 链路自检"
echo "=============================================="

# ---------- 1. ROS 环境 ----------
echo "[1] ROS 2 环境"
if [ -n "${ROS_DISTRO:-}" ]; then
  ok "ROS_DISTRO=$ROS_DISTRO"
else
  for d in jazzy humble iron; do
    [ -f "/opt/ros/$d/setup.bash" ] && set +u && . "/opt/ros/$d/setup.bash" && set -u && break
  done
  if [ -n "${ROS_DISTRO:-}" ]; then ok "自动加载 ROS_DISTRO=$ROS_DISTRO"; else bad "找不到 ROS 2，先 source /opt/ros/<distro>/setup.bash"; fi
fi

# ---------- 2. 工作空间 ----------
echo "[2] 工作空间编译产物"
if [ -f "$ROOT/ros2_ws/install/setup.bash" ]; then
  set +u && . "$ROOT/ros2_ws/install/setup.bash" && set -u
  ok "install/setup.bash 存在并已 source"
else
  bad "还没编译：先跑 colcon build --packages-select rm_aim_sim_bridge"
fi

# ---------- 3. 桥接节点 ----------
echo "[3] 桥接节点是否在跑"
if ros2 node list 2>/dev/null | grep -q "/aim_sim/bridge"; then
  ok "节点 /aim_sim/bridge 在线"
else
  bad "没有 /aim_sim/bridge：另一个终端跑 ros2 launch rm_aim_sim_bridge web_bridge.launch.xml"
fi

# ---------- 4. 端口 ----------
echo "[4] WebSocket 端口 9090"
if command -v ss >/dev/null && ss -ltn 2>/dev/null | grep -q ":9090"; then
  ok "9090 正在监听"
elif command -v netstat >/dev/null && netstat -ltn 2>/dev/null | grep -q ":9090"; then
  ok "9090 正在监听"
else
  bad "9090 未监听：桥接没起来，或被防火墙/端口占用"
fi

# ---------- 5. 话题 ----------
echo "[5] 话题名（必须全部以 /aim_sim/ 开头）"
TOPICS=$(ros2 topic list 2>/dev/null | tr '\n' ' ')
for t in /aim_sim/armors /aim_sim/gimbal /aim_sim/telemetry /aim_sim/command; do
  case "$TOPICS" in *"$t "*) ok "$t";; *) bad "$t 不存在";; esac
done

# ---------- 6. 频率 ----------
echo "[6] /aim_sim/armors 频率（网页已连上时 ≈ 60 Hz）"
RATE=$(timeout 6 stdbuf -oL ros2 topic hz /aim_sim/armors 2>/dev/null | grep -m1 --line-buffered "average rate" | awk '{print $3}')
if [ -n "${RATE:-}" ]; then
  ok "average rate = ${RATE} Hz"
else
  bad "收不到消息：网页没连上桥接，或没勾选『外部控制』"
fi

# ---------- 7. 数据内容 ----------
echo "[7] 一条 gimbal 样本"
GIMBAL=$(timeout 5 ros2 topic echo /aim_sim/gimbal --once 2>/dev/null | grep -E "^\s+(yaw|pitch):" | head -2 | tr -d ' ' | tr '\n' ' ')
if [ -n "${GIMBAL:-}" ]; then ok "$GIMBAL"; else warn "没取到（若第 6 项通过可忽略）"; fi

# ---------- 8. 下行 ----------
echo "[8] 下行指令测试"
if [ "${1:-}" = "--sweep" ]; then
  if python3 "$ROOT/tools/probe_bridge.py" --sweep; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
else
  warn "跳过（加 --sweep 参数可主动发指令验证云台跟随）"
fi

echo "=============================================="
printf " 通过 %d 项，失败 %d 项\n" "$PASS" "$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo " ✅ 链路正常，可以开始跑自瞄节点"
else
  echo " ❌ 按上面标红的项逐条排查（详见 docs/how_to_connect.md）"
fi
echo "=============================================="
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
