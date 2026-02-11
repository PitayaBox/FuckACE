# 🐉 PitayaBox (火龙果箱)

[![Tauri v2](https://img.shields.io/badge/Tauri-v2-blue?logo=tauri)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-1.75+-orange?logo=rust)](https://www.rust-lang.org/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

**PitayaBox** 是一款专为 Windows 玩家设计的轻量级腾讯ace系统优化工具。它利用 Rust 编写的后端内核，能够精准地对某些“维护游戏公平正义的进程”（如游戏反作弊程序 ACE/SGuard）进行系统级的降权和限制，从而释放 CPU 核心性能，提升游戏流畅度。

## ✨ 核心功能

- **🚀 进程压制**：实时监控 `SGuard64.exe` 等进程，强制将其绑定到最后一个 CPU 核心，并设置优先级为“空闲（Idle）”。
- **🔥 注册表降权**：一键通过 IFEO 注册表持久化降低 ACE 运行优先级，彻底解决其在后台抢占资源的问题。
- **🎮 游戏专项优化**：
    - **三角洲行动**：提升游戏进程优先级。
    - **瓦罗兰特 (VALORANT)**：优化系统响应性能。
- **⚡ 效率模式 (EcoQoS)**：在 Win11 系统上强制开启进程效率模式，最大程度降低能耗。
- **🛠️ 系统工具**：支持开机自启动管理、内存自动清理及实时性能监控雷达。

## 📸 软件截图

<img width="1251" height="1281" alt="image" src="https://github.com/user-attachments/assets/7604a007-e57f-444f-82eb-40b5cb2c5905" />


## 📥 安装运行

### 开发环境准备
1. 安装 [Node.js](https://nodejs.org/)。
2. 安装 [Rust 编译环境](https://www.rust-lang.org/tools/install)。
3. 安装 [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (Win10/11 通常已内置)。

### 运行步骤
```bash
# 安装前端依赖
npm install

# 启动开发环境
npm run tauri dev

# 打包发布 构建正式版 .exe
npm run tauri build

注意：<br>
1.软件不会彻底关闭ACE，只是对其占用进行限制，别开桂嗷。<br>
2.主包测试了是没事的，但是不排除会误封的可能，请充分了解潜在风险，使用即代表已经了解并接受这些风险/(ㄒoㄒ)/~~

## 核心机制
### 1.被动限制：
通过注册表修改，一键降低ACE的CPU优先级和I/O优先级，同时提高对应游戏优先级。

### 2.主动限制：
在主动限制下，可以额外对ACE进行限制：<br>
1.绑定到最后一个核心(一般是小核)<br>
2.将ACE设置为效率模式(减低占用)<br>
3.降低ACE的内存优先性<br>

将被执行限制的进程：<br>
1.SGuard64.exe <br>
2.SGuardSvc64.exe <br>

## 开发者（真正的开发者 我只是folk了项目 进行了修改）
- 开发者: [shshouse](https://github.com/shshouse)
- Bilibili: [shshouse](https://space.bilibili.com/3493127123897196)
- 爱发电: [shshouse](https://afdian.com/a/shshouse)

## 免责声明
本软件仅供技术研究和学习使用，使用本软件造成的任何后果由使用者自行承担。
