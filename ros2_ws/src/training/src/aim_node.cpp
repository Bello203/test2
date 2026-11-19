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

               
            // 1. 记录历史
            static double last_X = 0.0;
            static double last_Y = 0.0;
            static double last_time = 0.0;
            
            double current_time = this->now().seconds();
            
            // 2. 算速度
            double vx = 0.0, vy = 0.0;
            double dt = armors_msg->header.stamp.sec + armors_msg->header.stamp.nanosec * 1e-9 - last_time;
            // stamp 取 armors_msg->header.stamp
            if (dt > 0.001 && dt < 0.5 && last_time > 0.0) {
                vx = (X - last_X) / dt;
                vy = (Y - last_Y) / dt;
            }
            
            // 3. 物理参数
            double speed = 23.0;
            double delay = 0.015;
            double g = 9.7833;
            double barrel_len = 0.22;
            
            // 4. 初始估计飞行时间
            double rough_dist = sqrt(X * X + Y * Y);
            double tf = rough_dist / speed;
            
            double pred_X, pred_Y;
            double final_pitch = 0.0;
            
            // 5. 迭代 5 次逼近真实弹道
            for (int k = 0; k < 5; ++k) {
                // (1) 预测目标落点
                double total_t = tf + delay;
                pred_X = X + vx * total_t;
                pred_Y = Y + vy * total_t;
                
                // (2) 算水平朝向 Yaw
                target_yaw = atan2(pred_Y, pred_X);
                
                // (3) 算水平飞行距离
                double true_horizontal_dist = sqrt(pred_X * pred_X + pred_Y * pred_Y) - barrel_len * cos(final_pitch);
                
                double dz = Z - barrel_len * sin(final_pitch);
                // (5) 算真实飞行时间和下坠补偿
                double new_tf = true_horizontal_dist / (speed * cos(final_pitch)); 
                double drop_comp = 0.5 * g * new_tf * new_tf;
                
                // (6) 算出最终的 Pitch
                final_pitch = atan2(dz + drop_comp, true_horizontal_dist);
                target_pitch = final_pitch;
                
                // (7) 更新飞行时间
                tf = new_tf;
            }
            
            
            
            // 6. 更新历史
            last_X = X;
            last_Y = Y;
            last_time = current_time;

            msg = armors_msg;

            
        }
    }

           

void AimNode::timer_callback()
{
    rm_aim_sim_bridge::msg::AimCommand command_msg;

    if(!msg)
    {
        return;
        
    }
    
    if (target_pitch >= pitch_min_rad && target_pitch <= pitch_max_rad && 
        !std::isnan(target_yaw) && !std::isnan(target_pitch)) {
        
        command_msg.header = msg->header;
        command_msg.session_id = msg->session_id;
        command_msg.yaw = target_yaw;
        command_msg.pitch = target_pitch;
        command_msg.enable = true;
        command_msg.fire = true;
        command_->publish(command_msg);
        
    } else {
        command_msg.header = msg->header;
        command_msg.session_id = msg->session_id;
        command_msg.yaw = target_yaw;
        command_msg.pitch = target_pitch;
        command_msg.enable = false;
        command_msg.fire = false;
        command_->publish(command_msg);
        
        
    }

    
}

        
        






    


