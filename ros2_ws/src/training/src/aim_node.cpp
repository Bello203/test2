#include "aim_node.hpp" 

#include <functional>
#include <cmath>

using namespace std::chrono_literals;

AimNode::AimNode()
    :Node("aim_node")
{
    armors_ = 
        this -> create_subscription<rm_aim_sim_bridge::msg::ArmorCornersArray>
        (
            "/aim_sim/armors",
            1,
            std::bind(
                &AimNode::armors_callback,
                this,
                std::placeholders::_1
            )

        );

    command_=
        this -> create_publisher<rm_aim_sim_bridge::msg::AimCommand>
        (
            "/aim_sim/command",
            1
        );

    timer_=
        this -> create_wall_timer(
           0.02s,
           std::bind(&AimNode::timer_callback,this) 
        );        
}

void AimNode::armors_callback(rm_aim_sim_bridge::msg::ArmorCornersArray::ConstSharedPtr armors_msg)
    {
        if (armors_msg->armors.empty())
        {
            RCLCPP_INFO(this->get_logger(),
        "empty");

        }
        else
        {
                double sum_x = 0.0,sum_y = 0.0,sum_z = 0.0;
                for (int j = 0;j <= 3;j++)
                {
                    sum_x += armors_msg->armors[0].corners[j].x;
                    sum_y += armors_msg->armors[0].corners[j].y;
                    sum_z += armors_msg->armors[0].corners[j].z;
                }
            
                double X = sum_x / 4.0;
                double Y= sum_y / 4.0;
                double Z = sum_z / 4.0;
        
        
            /* const double x0 = armors_msg->armors[0].corners[0].x;
            const double y0 = armors_msg->armors[0].corners[0].y;
            const double z0 = armors_msg->armors[0].corners[0].z;

            const double x1 = armors_msg->armors[0].corners[1].x;
            const double y1 = armors_msg->armors[0].corners[1].y;
            const double z1 = armors_msg->armors[0].corners[1].z;

            const double x2 = armors_msg->armors[0].corners[2].x;
            const double y2 = armors_msg->armors[0].corners[2].y;
            const double z2 = armors_msg->armors[0].corners[2].z;

            const double x3 = armors_msg->armors[0].corners[3].x;
            const double y3 = armors_msg->armors[0].corners[3].y;
            const double z3 = armors_msg->armors[0].corners[3].z;

            double sum_x = x0 + x1 + x2 +x3;
            double sum_y = y0 + y1 + y2 + y3;
            double sum_z = z0 + z1 + z2 + z3;

            double X = sum_x / 4.0;
            double Y = sum_y / 4.0;
            double Z = sum_z / 4.0;
 */
            // 已知：目标中心点 X, Y, Z
// 物理参数：弹速 23.0，重力 9.7833，枪管长 0.22，开火延迟 0.015

            // 1. 先用云台中心算一个粗略的水平角
            double rough_yaw = atan2(Y, X);

            // 2. 算枪口位置 (枪管在云台前方，随水平角转动)
            double muzzle_x = 0.22 * cos(rough_yaw);
            double muzzle_y = 0.22 * sin(rough_yaw);
            // 枪口高度假设为 0 (如果文档有要求加上高度，请自行加上)

            // 3. 算从枪口到目标的真实向量
            double dx = X - muzzle_x;
            double dy = Y - muzzle_y;
            double dz = Z; 

            // 4. 算真实水平距离
            double horizontal_distance = sqrt(dx * dx + dy * dy);

            // 5. 算飞行时间和重力补偿
            double bullet_speed = 23.0;
            double gravity = 9.7833;
            double flight_time = horizontal_distance / bullet_speed;
            double drop_compensation = 0.5 * gravity * flight_time * flight_time;

            // 6. 算最终的 Yaw (E) 和 Pitch (P)
            target_yaw = atan2(dy, dx);
            target_pitch = atan2(dz + drop_compensation, horizontal_distance);
            msg = armors_msg;

            
        }
    }

        /* size_t number = armors_msg->armors.size();

        if (armors_msg->armors.empty())
        {
            RCLCPP_INFO(this->get_logger(),
        "empty");

        }
        else
        {
            for (size_t i = 0; i < number; i++)
            {
                for (int j = 0; j <= 3;j++)
                {
                    const double x = armors_msg->armors[i].corners[j].x;
                    const double y = armors_msg->armors[i].corners[j].y;
                }
            }

        } */
    

void AimNode::timer_callback()
{
    if(!msg)
    {
        return;
    }
    
    rm_aim_sim_bridge::msg::AimCommand command_msg;

    command_msg.header = msg->header;
    command_msg.session_id = msg->session_id;
    command_msg.yaw = target_yaw;
    command_msg.pitch = target_pitch;
    command_msg.enable = true;
    command_msg.fire = true;
    command_->publish(command_msg);
}

        
        






    


