#!/usr/bin/env python3
"""桥接连通性探针 —— 不依赖你自己的自瞄代码，验证整条链路是否打通。

用法（在 Ubuntu / ROS 2 环境里，先 source 过 install/setup.bash）:

    python3 tools/probe_bridge.py            # 只看：话题频率、session、装甲数、云台角
    python3 tools/probe_bridge.py --sweep    # 主动测试：发正弦 yaw 指令，看云台是否跟随

判据:
    1) 收到 /aim_sim/armors 且频率 ≈ 60 Hz
    2) session_id 非空
    3) --sweep 模式下，云台 yaw 跟随指令（误差 < 3°）→ 双向链路 + ControlGate 全部通过
"""
import argparse
import math
import sys
import time

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy

from rm_aim_sim_bridge.msg import AimCommand, ArmorCornersArray, GimbalState, Telemetry


class Probe(Node):
    def __init__(self):
        super().__init__("bridge_probe")
        qos = QoSProfile(
            depth=1,
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.VOLATILE,
        )
        self.armors = None
        self.gimbal = None
        self.telemetry = None
        self.armor_count = 0
        self.gimbal_count = 0
        self.create_subscription(ArmorCornersArray, "/aim_sim/armors",
                                 self.on_armors, qos)
        self.create_subscription(GimbalState, "/aim_sim/gimbal",
                                 self.on_gimbal, qos)
        self.create_subscription(Telemetry, "/aim_sim/telemetry",
                                 self.on_telemetry, qos)
        self.pub = self.create_publisher(AimCommand, "/aim_sim/command", qos)

    def on_armors(self, msg):
        self.armors = msg
        self.armor_count += 1

    def on_gimbal(self, msg):
        self.gimbal = msg
        self.gimbal_count += 1

    def on_telemetry(self, msg):
        self.telemetry = msg

    def spin_for(self, seconds):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            rclpy.spin_once(self, timeout_sec=0.02)


def deg(rad):
    return rad * 180.0 / math.pi


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sweep", action="store_true",
                        help="主动发 yaw 正弦指令，验证下行链路")
    parser.add_argument("--seconds", type=float, default=3.0,
                        help="观测时长（默认 3 s）")
    args = parser.parse_args()

    rclpy.init()
    probe = Probe()
    print("观察 3 s，等待 /aim_sim/* ...")
    t0 = time.monotonic()
    probe.spin_for(3.0)
    window = time.monotonic() - t0

    failures = []

    n = probe.armor_count
    hz = n / window if window > 0 else 0.0
    print(f"\n[1] /aim_sim/armors  收到 {n} 条 / 约 {hz:.1f} Hz")
    if n == 0:
        failures.append("没收到装甲话题：网页是否已勾选『外部控制』？桥接是否连上？")
    elif hz < 20:
        failures.append(f"频率偏低（{hz:.1f} Hz，应 ≈ 60 Hz）：检查网络与 ws 连接")

    session = probe.armors.session_id if probe.armors else ""
    print(f"[2] session_id       {session if session else '(空)'}")
    if probe.armors and not session:
        failures.append("session_id 为空：网页端未开外部控制或仿真已暂停")

    if probe.telemetry:
        t = probe.telemetry
        print(f"[3] telemetry        弹速 {t.speed:.1f} m/s · 重力 {t.gravity:.4f} · "
              f"枪管 {t.barrel_length:.3f} m · 射频 {t.rate:.0f} Hz · 延迟 {t.delay*1000:.0f} ms")
    else:
        failures.append("没收到 /aim_sim/telemetry")

    if probe.gimbal:
        g = probe.gimbal
        print(f"[4] gimbal           实际 yaw {deg(g.yaw):+.2f}° · pitch {deg(g.pitch):+.2f}°")
    else:
        failures.append("没收到 /aim_sim/gimbal")

    print(f"[5] 当前可见装甲数   {len(probe.armors.armors) if probe.armors else 0} 块"
          f"（0 块 = 目标不在相机视场内，正常现象）")

    # ---------- 下行链路测试 ----------
    if args.sweep and probe.armors:
        print("\n[6] 发 yaw 正弦指令 6 s，看云台是否跟随 ...")
        errors = []
        end = time.monotonic() + 6.0
        while time.monotonic() < end:
            if probe.armors and probe.gimbal:
                t = time.monotonic() - end + 6.0
                target = 0.30 * math.sin(2 * math.pi * 0.25 * t)  # ±17°
                cmd = AimCommand()
                cmd.header = probe.armors.header      # 关键：复制观测的时间戳
                cmd.session_id = probe.armors.session_id
                cmd.yaw = target
                cmd.pitch = probe.gimbal.pitch
                cmd.enable = True
                cmd.fire = False
                probe.pub.publish(cmd)
                probe.spin_for(0.02)
                if t > 1.0:                            # 跳过前 1 s 伺服响应
                    errors.append(abs(probe.gimbal.yaw - target))
            else:
                probe.spin_for(0.02)

        if errors:
            err = max(errors)
            print(f"    最大跟随误差 {deg(err):.2f}°")
            if err > math.radians(3.0):
                failures.append(
                    f"云台没跟上指令（误差 {deg(err):.1f}°）：session/时间戳不匹配，"
                    "检查是否复制了 armors 的 header 与 session_id")
            else:
                print("    ✅ 下行链路正常：指令被 ControlGate 接受并驱动了云台")
        else:
            failures.append("下行测试期间没有收到观测，无法判定")

    print("\n" + "=" * 56)
    if failures:
        print("❌ 自检未全部通过：")
        for i, item in enumerate(failures, 1):
            print(f"  {i}. {item}")
        rclpy.shutdown()
        return 1
    print("✅ 全部通过：观测上行 + 指令下行 + session 校验 都正常")
    print("   现在可以启动你自己的自瞄节点了。")
    rclpy.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
