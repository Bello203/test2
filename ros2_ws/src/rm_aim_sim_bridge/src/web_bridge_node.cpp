// rm_aim_sim_web — C++ ROS 2 WebSocket 桥接节点
// 与原版 Godot 共享内存桥接行为一致，仅把传输层换成 WebSocket：
//   浏览器仿真 ⇄ (WebSocket JSON) ⇄ 本节点 ⇄ (ROS 话题) ⇄ 学员自瞄节点
// 话题与消息类型与原版完全一致：/aim_sim/armors | /aim_sim/gimbal | /aim_sim/telemetry | /aim_sim/command | /clock

#include "rm_aim_sim_bridge/control_gate.hpp"

#include "rm_aim_sim_bridge/msg/aim_command.hpp"
#include "rm_aim_sim_bridge/msg/armor_corners_array.hpp"
#include "rm_aim_sim_bridge/msg/gimbal_state.hpp"
#include "rm_aim_sim_bridge/msg/telemetry.hpp"

#include <boost/asio.hpp>
#include <boost/beast.hpp>

#include <chrono>
#include <cmath>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>

#include <rclcpp/rclcpp.hpp>
#include <rosgraph_msgs/msg/clock.hpp>

namespace beast = boost::beast;
namespace net = boost::asio;
namespace websocket = beast::websocket;
using tcp = net::ip::tcp;
using Json = nlohmann::json;

namespace rm_aim_sim_bridge
{
using Steady = std::chrono::steady_clock;
using AimCommand = rm_aim_sim_bridge::msg::AimCommand;
using ArmorCornersArray = rm_aim_sim_bridge::msg::ArmorCornersArray;
using GimbalState = rm_aim_sim_bridge::msg::GimbalState;
using Telemetry = rm_aim_sim_bridge::msg::Telemetry;

double wall_seconds()
{
  return std::chrono::duration<double>(Steady::now().time_since_epoch()).count();
}

builtin_interfaces::msg::Time stamp_from_seconds(double seconds)
{
  const auto ns = static_cast<int64_t>(std::llround(seconds * 1e9));
  builtin_interfaces::msg::Time result;
  result.sec = static_cast<int32_t>(ns / 1000000000LL);
  result.nanosec = static_cast<uint32_t>(ns % 1000000000LL);
  return result;
}

// ---------------- 线程间共享状态 ----------------
struct SharedState
{
  std::mutex mutex;
  Json latest_state;            // 最近一次仿真状态
  bool has_state{false};
  uint64_t state_serial{0};     // 每收到一条新状态自增
  std::string command;          // 发给仿真的最新指令 JSON
  uint64_t command_serial{0};
};

// ---------------- WebSocket 会话（仿真端） ----------------
class WsSession : public std::enable_shared_from_this<WsSession>
{
public:
  WsSession(tcp::socket socket, std::shared_ptr<SharedState> shared)
  : ws_(std::move(socket)), shared_(std::move(shared)) {}

  void start()
  {
    auto self = shared_from_this();
    ws_.async_accept(beast::bind_front_handler(&WsSession::onAccept, self));
  }

  void close()
  {
    net::post(ws_.get_executor(), [self = shared_from_this()]() {
      beast::error_code ec;
      beast::get_lowest_layer(self->ws_).socket().close(ec);
    });
  }

private:
  void onAccept(beast::error_code ec)
  {
    if (ec) {return;}
    doRead();
    doSendPeriodic();
  }

  void doRead()
  {
    auto self = shared_from_this();
    beast::get_lowest_layer(ws_).expires_after(std::chrono::seconds(5));
    ws_.async_read(buffer_, [self](beast::error_code ec, std::size_t) {
      self->onRead(ec);
    });
  }

  void onRead(beast::error_code ec)
  {
    if (ec == websocket::error::closed || ec == net::error::operation_aborted ||
      ec == beast::error::timeout) {return;}
    if (ec) {return;}
    try {
      auto state = Json::parse(beast::buffers_to_string(buffer_.data()));
      if (state.is_object() && state.value("type", std::string()) == "state") {
        std::lock_guard<std::mutex> lock(shared_->mutex);
        shared_->latest_state = std::move(state);
        shared_->has_state = true;
        shared_->state_serial += 1;
      }
    } catch (const std::exception &) {
      // 非 JSON 帧直接忽略
    }
    buffer_.consume(buffer_.size());
    doRead();
  }

  void doSendPeriodic()
  {
    auto self = shared_from_this();
    timer_ = std::make_shared<net::steady_timer>(ws_.get_executor());
    timer_->expires_after(std::chrono::milliseconds(10));
    timer_->async_wait([self](beast::error_code ec) {
      if (ec) {return;}
      self->sendLatest();
    });
  }

  void sendLatest()
  {
    if (writing_) {doSendPeriodic(); return;}
    std::string payload;
    uint64_t serial = 0;
    {
      std::lock_guard<std::mutex> lock(shared_->mutex);
      payload = shared_->command;
      serial = shared_->command_serial;
    }
    if (payload.empty() || serial == last_sent_serial_) {
      doSendPeriodic();
      return;
    }
    writing_ = true;
    last_sent_serial_ = serial;
    auto self = shared_from_this();
    ws_.async_write(net::buffer(payload), [self](beast::error_code ec, std::size_t) {
      self->writing_ = false;
      if (ec) {return;}
      self->doSendPeriodic();
    });
  }

  websocket::stream<beast::tcp_stream> ws_;
  beast::flat_buffer buffer_;
  std::shared_ptr<net::steady_timer> timer_;
  std::shared_ptr<SharedState> shared_;
  bool writing_{false};
  uint64_t last_sent_serial_{0};
};

// ---------------- WebSocket 服务器 ----------------
class WsServer
{
public:
  WsServer(uint16_t port, std::shared_ptr<SharedState> shared)
  : shared_(std::move(shared)), acceptor_(ioc_, tcp::endpoint(tcp::v4(), port))
  {
    thread_ = std::thread([this]() {
      doAccept();
      ioc_.run();
    });
  }

  ~WsServer()
  {
    ioc_.stop();
    if (thread_.joinable()) {thread_.join();}
  }

private:
  void doAccept()
  {
    acceptor_.async_accept([this](beast::error_code ec, tcp::socket socket) {
      if (!ec) {
        if (auto old = session_.lock()) {old->close();}
        auto session = std::make_shared<WsSession>(std::move(socket), shared_);
        session_ = session;
        session->start();
      }
      doAccept();
    });
  }

  std::shared_ptr<SharedState> shared_;
  net::io_context ioc_;
  tcp::acceptor acceptor_;
  std::thread thread_;
  std::weak_ptr<WsSession> session_;
};

// ---------------- ROS 2 节点 ----------------
class BridgeNode : public rclcpp::Node
{
public:
  BridgeNode()
  : Node("bridge", "/aim_sim"),
    shared_(std::make_shared<SharedState>()),
    gate_(declare_parameter<double>("timeout_sec", .25, startup_only()))
  {
    const int port = static_cast<int>(declare_parameter<int64_t>("port", 9090, startup_only()));
    const auto rate = declare_parameter<double>("poll_hz", 100.0, startup_only());
    const auto timeout = get_parameter("timeout_sec").as_double();
    const auto clock_enabled = declare_parameter<bool>("publish_clock", true, startup_only());
    if (port < 1 || port > 65535 ||
      !std::isfinite(rate) || rate < 1 || rate > 1000 ||
      !std::isfinite(timeout) || timeout < .02 || timeout > .25)
    {
      throw std::invalid_argument(
        "port must be [1,65535], poll_hz must be [1,1000], timeout_sec must be [0.02,0.25]");
    }
    server_ = std::make_unique<WsServer>(static_cast<uint16_t>(port), shared_);

    const auto latest = rclcpp::QoS(1).reliable().durability_volatile();
    armors_pub_ = create_publisher<ArmorCornersArray>("armors", latest);
    gimbal_pub_ = create_publisher<GimbalState>("gimbal", latest);
    telemetry_pub_ = create_publisher<Telemetry>("telemetry", latest);
    if (clock_enabled) {clock_pub_ = create_publisher<rosgraph_msgs::msg::Clock>("/clock", latest);}
    command_sub_ = create_subscription<AimCommand>("command", latest,
      [this](AimCommand::ConstSharedPtr msg) {
        const double stamp = msg->header.stamp.sec + msg->header.stamp.nanosec * 1e-9;
        if (!gate_.accept(msg->session_id, stamp, msg->header.frame_id,
          msg->yaw, msg->pitch, msg->enable, msg->fire, wall_seconds()))
        {
          RCLCPP_WARN_THROTTLE(get_logger(), *get_clock(), 2000,
            "Rejected stale, out-of-order or invalid command/session");
        }
      });
    timer_ = create_wall_timer(std::chrono::duration<double>(1.0 / rate), [this]() {poll();});
    RCLCPP_INFO(get_logger(),
      "Waiting for web simulator on ws://0.0.0.0:%d (ROS pitch is positive UP)", port);
  }

private:
  static rcl_interfaces::msg::ParameterDescriptor startup_only()
  {
    rcl_interfaces::msg::ParameterDescriptor descriptor;
    descriptor.read_only = true;
    return descriptor;
  }

  void publish_unavailable()
  {
    ArmorCornersArray empty;
    empty.header.frame_id = "odom";
    empty.header.stamp = last_stamp_;
    empty.session_id = last_session_;
    armors_pub_->publish(empty);
  }

  void poll()
  {
    const double now = wall_seconds();
    try {
      Json state;
      {
        std::lock_guard<std::mutex> lock(shared_->mutex);
        if (shared_->has_state && shared_->state_serial != last_seen_serial_) {
          state = shared_->latest_state;
          last_seen_serial_ = shared_->state_serial;
        }
      }
      if (!state.is_null()) {
        gate_.update(state, now);
        publish_state(state);
      }
      const bool ready = gate_.fresh(now);
      if (!ready && was_ready_) {publish_unavailable();}
      was_ready_ = ready;

      // 组装指令发给仿真（原版 mailbox_.send 的等价物）
      const auto command = gate_.command(now);
      Json out = {
        {"protocol", "rm_aim_sim/2"},
        {"type", "command"},
        {"publisher_id", last_publisher_id_},
        {"session_id", last_session_id_},
        {"seq", next_seq_++},
        {"control", command.control},
        {"fire", command.fire},
        {"yaw", command.yaw},
        {"pitch", command.pitch},
      };
      {
        std::lock_guard<std::mutex> lock(shared_->mutex);
        shared_->command = out.dump();
        shared_->command_serial += 1;
      }
    } catch (const std::exception & error) {
      gate_.clear();
      RCLCPP_WARN_THROTTLE(get_logger(), *get_clock(), 2000, "%s", error.what());
      if (was_ready_) {publish_unavailable(); was_ready_ = false;}
    }
  }

  void publish_state(const Json & state)
  {
    last_stamp_ = stamp_from_seconds(state.at("sim_time").get<double>());
    last_publisher_id_ = state.at("publisher_id").get<std::string>();
    last_session_id_ = state.at("session_id").get<std::string>();
    last_session_ = last_publisher_id_ + "/" + last_session_id_;
    if (clock_pub_) {
      rosgraph_msgs::msg::Clock clock;
      clock.clock = last_stamp_;
      clock_pub_->publish(clock);
    }
    ArmorCornersArray armors;
    armors.header.frame_id = "odom";
    armors.header.stamp = last_stamp_;
    armors.session_id = last_session_;
    const bool paused = state.at("paused").get<bool>();
    const bool enabled = state.at("ipc").at("enabled").get<bool>();
    const auto & actual = state.at("gimbal");
    if (!paused && enabled) {
      for (const auto & armor : state.at("truth").at("armors")) {
        bool visible = false;
        for (const auto & observation : state.at("camera").at("armors")) {
          visible = visible || armor.at("id") == observation.at("id");
        }
        if (!visible) {continue;}
        rm_aim_sim_bridge::msg::ArmorCorners plate;
        const auto & corners = armor.at("corners");
        // 只平移原点：仿真世界和考核 odom 的轴向一致。
        for (size_t i = 0; i < plate.corners.size(); ++i) {
          plate.corners[i].x = corners.at(i).at(0).get<double>() - actual.at("origin")[0].get<double>();
          plate.corners[i].y = corners.at(i).at(1).get<double>() - actual.at("origin")[1].get<double>();
          plate.corners[i].z = corners.at(i).at(2).get<double>() - actual.at("origin")[2].get<double>();
        }
        armors.armors.push_back(plate);
      }
    }
    armors_pub_->publish(armors);
    GimbalState gimbal;
    gimbal.header = armors.header;
    gimbal.yaw = actual.at("yaw").get<double>();
    gimbal.pitch = -actual.at("pitch").get<double>();
    gimbal.yaw_velocity = actual.at("yaw_vel").get<double>();
    gimbal.pitch_velocity = -actual.at("pitch_vel").get<double>();
    gimbal_pub_->publish(gimbal);
    Telemetry telemetry;
    telemetry.header = armors.header;
    const auto & weapon = state.at("weapon");
    telemetry.speed = weapon.at("speed").get<double>();
    telemetry.gravity = weapon.at("gravity").get<double>();
    telemetry.barrel_length = weapon.at("barrel_length").get<double>();
    telemetry.rate = weapon.at("rate").get<double>();
    telemetry.delay = weapon.at("delay").get<double>();
    telemetry_pub_->publish(telemetry);
  }

  std::shared_ptr<SharedState> shared_;
  std::unique_ptr<WsServer> server_;
  ControlGate gate_;
  rclcpp::TimerBase::SharedPtr timer_;
  rclcpp::Publisher<ArmorCornersArray>::SharedPtr armors_pub_;
  rclcpp::Publisher<GimbalState>::SharedPtr gimbal_pub_;
  rclcpp::Publisher<Telemetry>::SharedPtr telemetry_pub_;
  rclcpp::Publisher<rosgraph_msgs::msg::Clock>::SharedPtr clock_pub_;
  rclcpp::Subscription<AimCommand>::SharedPtr command_sub_;
  builtin_interfaces::msg::Time last_stamp_;
  std::string last_session_;
  std::string last_publisher_id_;
  std::string last_session_id_;
  uint64_t last_seen_serial_{0};
  uint64_t next_seq_{1};
  bool was_ready_{false};
};
}  // namespace rm_aim_sim_bridge

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  try {
    rclcpp::spin(std::make_shared<rm_aim_sim_bridge::BridgeNode>());
  } catch (const std::exception & error) {
    RCLCPP_ERROR(rclcpp::get_logger("aim_sim_bridge"), "%s", error.what());
    rclcpp::shutdown();
    return 1;
  }
  rclcpp::shutdown();
  return 0;
}
