#!/usr/bin/env bash
# 在 Mac（渲染端）上启动网页仿真：./run_web.sh [端口]
set -e
cd "$(dirname "$0")/web_sim"
PORT="${1:-8080}"
IP=$(ipconfig getifaddr en0 2>/dev/null || echo "localhost")
echo "RoboMaster Aim Lab Web 正在启动..."
echo "  本机访问:   http://localhost:${PORT}"
echo "  局域网访问: http://${IP}:${PORT}  （如需在其它设备打开）"
echo "  按 Ctrl+C 停止"
python3 -m http.server "${PORT}"
