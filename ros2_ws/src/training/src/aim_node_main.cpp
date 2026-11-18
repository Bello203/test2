#include "rclcpp/rclcpp.hpp"
#include "aim_node.hpp"

int main(int argc, char *argv[])
{
    rclcpp::init(argc, argv);

    auto node = std::make_shared<AimNode>();

    rclcpp::spin(node);

    rclcpp::shutdown();

    return 0;
}