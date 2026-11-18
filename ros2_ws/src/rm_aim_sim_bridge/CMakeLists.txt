cmake_minimum_required(VERSION 3.16)
project(rm_aim_sim_bridge)

if(NOT CMAKE_CXX_STANDARD)
  set(CMAKE_CXX_STANDARD 17)
endif()

find_package(ament_cmake REQUIRED)
find_package(rosidl_default_generators REQUIRED)
find_package(rclcpp REQUIRED)
find_package(std_msgs REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(builtin_interfaces REQUIRED)
find_package(rosgraph_msgs REQUIRED)
find_package(Boost REQUIRED)      # Beast 为纯头文件库，x86_64 / ARM64 均可编译
find_package(Threads REQUIRED)
# nlohmann-json-dev 安装在系统路径 /usr/include/nlohmann/json.hpp，无需 find_package

rosidl_generate_interfaces(${PROJECT_NAME}
  "msg/AimCommand.msg"
  "msg/ArmorCorners.msg"
  "msg/ArmorCornersArray.msg"
  "msg/GimbalState.msg"
  "msg/Telemetry.msg"
  DEPENDENCIES builtin_interfaces geometry_msgs std_msgs
)

add_executable(web_bridge_node src/web_bridge_node.cpp)
target_include_directories(web_bridge_node PRIVATE include)
ament_target_dependencies(web_bridge_node
  rclcpp std_msgs geometry_msgs builtin_interfaces rosgraph_msgs)
target_link_libraries(web_bridge_node
  Boost::headers Threads::Threads)

rosidl_get_typesupport_target(cpp_typesupport_target ${PROJECT_NAME} rosidl_typesupport_cpp)
target_link_libraries(web_bridge_node "${cpp_typesupport_target}")

install(TARGETS web_bridge_node
  DESTINATION lib/${PROJECT_NAME})
install(DIRECTORY launch
  DESTINATION share/${PROJECT_NAME})

ament_package()
