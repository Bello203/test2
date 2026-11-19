#pragma once

#include "rclcpp/rclcpp.hpp"
#include "rm_aim_sim_bridge/msg/aim_command.hpp"
#include "rm_aim_sim_bridge/msg/armor_corners_array.hpp"

#include "geometry_msgs/msg/point.hpp"

#include <vector>

class AimNode : public rclcpp::Node
{
public:
    AimNode();
private:
    void armors_callback(rm_aim_sim_bridge::msg::ArmorCornersArray::ConstSharedPtr armors_msg);
   
    rclcpp::Subscription<rm_aim_sim_bridge::msg::ArmorCornersArray>::SharedPtr armors_;
    rm_aim_sim_bridge::msg::ArmorCornersArray::ConstSharedPtr msg;
    rclcpp::Publisher<rm_aim_sim_bridge::msg::AimCommand>::SharedPtr command_;

    rclcpp::TimerBase::SharedPtr timer_;

    void timer_callback();

    // 用于计算目标移动速度的历史数据
    double last_X_ = 0.0;
    double last_Y_ = 0.0;
    double last_time_ = 0.0;

    double pitch_min_rad = -0.349;
    double pitch_max_rad = 0.523;

    double target_yaw;
    double target_pitch;
        
};