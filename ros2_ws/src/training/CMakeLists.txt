cmake_minimum_required(VERSION 3.8)
project(training)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# find dependencies
find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(rm_aim_sim_bridge REQUIRED)

if(BUILD_TESTING)
  find_package(ament_lint_auto REQUIRED)
  # the following line skips the linter which checks for copyrights
  set(ament_cmake_copyright_FOUND TRUE)
  # the following line skips cpplint
  set(ament_cmake_cpplint_FOUND TRUE)
  ament_lint_auto_find_test_dependencies()
endif()

# =========================================================
# 下面是我为你补充的可执行文件生成与安装部分
# =========================================================

# 告诉编译器去哪里找你的头文件 (aim_node.hpp)


# 生成可执行文件（假设你要编译一个名为 aim_node 的节点）
# 这里把 src 下的两个 cpp 文件都加进去了，如果它们是分开的两个独立程序，需要改一下
add_executable(aim_node 
  src/aim_node.cpp 
  src/aim_node_main.cpp
)

target_include_directories(aim_node PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

# 链接依赖库
ament_target_dependencies(aim_node
  rclcpp
  rm_aim_sim_bridge
)

# 安装可执行文件，这样你才能在终端使用 ros2 run training aim_node 运行
install(TARGETS
  aim_node
  DESTINATION lib/${PROJECT_NAME}
)

# =========================================================
# =========================================================

ament_package()