# Multi Cursor - 多窗口管理器

<p align="center">
  <img src="assets/multi-cursor-logo.png" alt="Multi Cursor Logo" width="200">
</p>

一个跨平台的 Cursor 多窗口管理工具，支持自由切分窗格、拖动调整布局，将多个 Cursor 编辑器实例嵌入到统一界面中管理。

## 功能特性

- **自由切分窗口** - 支持水平和垂直分割，创建任意数量的窗格
- **拖动调整布局** - 拖动分割线实时调整窗格大小
- **布局持久化** - 自动保存布局配置，下次启动时恢复
- **预设布局** - 提供单窗格、双窗格、三窗格、四窗格等预设布局
- **一键启动 Cursor** - 每个窗格可独立打开 Cursor 编辑器并自动嵌入
- **跨平台支持** - 同时支持 Windows 和 Linux（X11）

## 目录

- [Windows 安装部署](#windows-安装部署)
- [Linux 安装部署](#linux-安装部署)
- [使用说明](#使用说明)
- [开发指南](#开发指南)
- [技术栈](#技术栈)
- [常见问题](#常见问题)

---

## Windows 安装部署

### 环境要求

| 依赖 | 版本要求 | 说明 |
|------|---------|------|
| Node.js | >= 18.x | 推荐使用 LTS 版本 |
| npm | >= 9.x | 随 Node.js 一起安装 |
| Cursor | 最新版 | 需要已安装 Cursor 编辑器 |
| PowerShell | >= 5.1 | Windows 自带 |

### 方式一：源码运行（推荐开发/调试）

```bash
# 1. 克隆项目
git clone https://github.com/dyk/cursor-window-manager.git
cd cursor-window-manager

# 2. 切换到 Windows 主分支
git checkout main

# 3. 安装依赖
npm install

# 4. 编译主进程
npm run build:main

# 5. 启动开发模式（两个终端分别执行）
# 终端 1：启动 Vite 开发服务器
npm run dev:renderer

# 终端 2：启动 Electron（等待终端 1 启动完成后执行）
npm run start
```

> **简化启动**：也可以使用 `npm run dev` 一键同时启动 Vite 和 TypeScript 编译监控，然后再执行 `npm run start`。

### 方式二：打包为可执行文件

```bash
# 打包为 Windows 便携版 (.exe)
npm run dist:win
```

打包完成后，可执行文件位于 `release/` 目录下，双击即可运行。

### Windows 嵌入原理

Windows 版本使用 PowerShell 脚本 (`embedWindow.ps1`) 调用 Windows API 实现窗口嵌入：
- 通过 `SetWindowLong` 移除 Cursor 窗口的标题栏和边框
- 通过 `SetWindowLongPtr(GWLP_HWNDPARENT)` 设置 Owner 关系（非 SetParent，避免 Chromium 输入问题）
- 通过 `MoveWindow` / `SetWindowPos` 精确定位窗口到对应窗格位置

---

## Linux 安装部署

### 环境要求

| 依赖 | 版本要求 | 说明 |
|------|---------|------|
| Node.js | >= 18.x | 推荐通过 nvm 安装 |
| npm | >= 9.x | 随 Node.js 一起安装 |
| Cursor | 最新版 | 需要已安装 Cursor 编辑器（AppImage 或 deb） |
| xdotool | 最新版 | **必须安装**，用于窗口查找和操作 |
| libX11 | - | 系统通常自带 |
| libXext | - | 系统通常自带（XShape 扩展） |
| X11 桌面 | - | **必须使用 X11 会话**（Wayland 暂不支持） |

### 安装系统依赖

```bash
# Ubuntu / Debian
sudo apt update
sudo apt install xdotool libx11-dev libxext-dev

# Fedora
sudo dnf install xdotool libX11-devel libXext-devel

# Arch Linux
sudo pacman -S xdotool libx11 libxext
```

### 确认使用 X11 会话

```bash
# 检查当前显示服务器
echo $XDG_SESSION_TYPE
# 应输出: x11

# 如果输出 wayland，需要在登录界面切换到 X11/Xorg 会话
```

### 方式一：一键启动脚本（推荐）

```bash
# 1. 克隆项目
git clone https://github.com/dyk/cursor-window-manager.git
cd cursor-window-manager

# 2. 切换到 Linux 分支
git checkout main_linux

# 3. 赋予启动脚本执行权限
chmod +x start.sh

# 4. 一键启动（首次运行会自动安装依赖和编译）
./start.sh
```

`start.sh` 脚本会自动完成：
- 检查并安装 npm 依赖
- 编译 TypeScript 主进程代码
- 启动 Vite 开发服务器
- 启动 Electron 应用

### 方式二：手动启动

```bash
# 1. 克隆项目
git clone https://github.com/dyk/cursor-window-manager.git
cd cursor-window-manager

# 2. 切换到 Linux 分支
git checkout main_linux

# 3. 安装依赖
npm install

# 4. 编译主进程
npm run build:main

# 5. 启动开发模式（两个终端分别执行）
# 终端 1：启动 Vite 开发服务器
npm run dev:renderer

# 终端 2：启动 Electron（等待终端 1 启动完成后执行）
npm run start
```

### 方式三：打包为 AppImage

```bash
# 打包为 Linux AppImage
npm run dist:linux
```

打包完成后，AppImage 文件位于 `release/` 目录下：

```bash
chmod +x release/*.AppImage
./release/*.AppImage
```

### Linux 嵌入原理

Linux 版本使用 X11 API + xdotool 实现窗口管理（浮动窗口模式）：
- 通过 `xdotool` 查找新创建的 Cursor 窗口
- 通过 `_MOTIF_WM_HINTS` 移除窗口装饰（标题栏和边框）
- 通过 `WM_TRANSIENT_FOR` 设置父子窗口关系（Cursor 窗口始终在主窗口之上）
- 通过 `XShape` 扩展在主窗口的 pane 区域创建输入穿透，鼠标事件直接传递给 Cursor 窗口
- 通过 `koffi` 库直接调用 libX11 发送 EWMH 消息，实现可靠的窗口层级管理

---

## 使用说明

1. **启动程序** - 启动后默认显示三窗格布局
2. **切换布局** - 使用工具栏按钮快速切换预设布局（1/2/3/4 窗格）
3. **调整大小** - 拖动窗格之间的分割线调整大小
4. **添加窗格** - 点击"添加窗格"创建新窗格
5. **打开 Cursor** - 在每个窗格中选择项目文件夹，点击启动 Cursor，窗口会自动嵌入到对应窗格
6. **自动保存** - 布局配置会自动保存，下次启动时自动恢复

---

## 开发指南

### 项目结构

```
cursor-window-manager/
├── src/
│   ├── main/                    # Electron 主进程
│   │   ├── main.ts              # 主进程入口
│   │   ├── preload.ts           # 预加载脚本
│   │   ├── windowEmbed.ts       # Windows 窗口嵌入模块
│   │   ├── linuxWindowEmbed.ts  # Linux 窗口嵌入模块（X11）
│   │   ├── embedWindow.ps1      # Windows PowerShell 嵌入脚本
│   │   └── types.ts             # 类型定义
│   └── renderer/                # React 渲染进程
│       ├── App.tsx              # 主应用组件
│       ├── components/          # UI 组件
│       │   ├── Pane.tsx         # 窗格组件
│       │   ├── SplitLayout.tsx  # 分割布局
│       │   ├── Toolbar.tsx      # 工具栏
│       │   └── SettingsModal.tsx # 设置弹窗
│       ├── styles/              # 样式文件
│       └── types.ts             # 前端类型定义
├── assets/                      # 静态资源（图标等）
├── data/                        # 运行时数据（配置、日志）
├── start.sh                     # Linux 一键启动脚本
├── package.json                 # 项目配置
├── tsconfig.json                # TypeScript 配置（渲染进程）
├── tsconfig.main.json           # TypeScript 配置（主进程）
└── vite.config.ts               # Vite 配置
```

### 开发命令

```bash
npm run dev            # 同时启动 Vite + TypeScript 编译监控
npm run dev:main       # 仅启动主进程 TypeScript 编译监控
npm run dev:renderer   # 仅启动 Vite 开发服务器
npm run start          # 启动 Electron（开发模式）
npm run build          # 构建全部（主进程 + 渲染进程）
npm run build:main     # 仅构建主进程
npm run build:renderer # 仅构建渲染进程
npm run dist:win       # 打包 Windows 版
npm run dist:linux     # 打包 Linux 版
```

---

## 技术栈

- **Electron** - 跨平台桌面应用框架
- **React** - UI 框架
- **TypeScript** - 类型安全
- **Vite** - 前端构建工具
- **koffi** - FFI 库，直接调用系统原生 API（Windows user32.dll / Linux libX11）
- **xdotool** - Linux 窗口操作工具
- **electron-store** - 持久化存储
- **react-mosaic-component** - 窗格分割布局组件

---

## 常见问题

### Windows

**Q: 启动后 Cursor 窗口没有嵌入？**
A: 确保 PowerShell 执行策略允许运行脚本。在管理员 PowerShell 中执行：
```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**Q: 嵌入后无法点击 Cursor 窗口？**
A: 这是已知的 Chromium SetParent 限制。当前版本使用 Owner 模式（非 SetParent），应可正常接收输入。如仍有问题，请尝试重启应用。

### Linux

**Q: 提示 "xdotool is not installed"？**
A: 请安装 xdotool：`sudo apt install xdotool`

**Q: 窗口嵌入不生效或位置偏移？**
A: 请确认使用的是 X11 会话而非 Wayland：
```bash
echo $XDG_SESSION_TYPE  # 应输出 x11
```
如果是 Wayland，请在登录界面选择 "GNOME on Xorg" 或 "X11" 会话。

**Q: koffi 相关错误？**
A: koffi 是 native 模块，需确保编译环境：
```bash
sudo apt install build-essential python3
npm rebuild
```

**Q: 启动后 Cursor 窗口遮挡了其他应用？**
A: 当前版本使用 `WM_TRANSIENT_FOR` 而非全局 `_NET_WM_STATE_ABOVE`，Cursor 窗口仅在主窗口之上，不会遮挡其他应用。如有异常请提交 issue。

---

## 分支说明

| 分支 | 说明 |
|------|------|
| `main` | Windows 版本主分支 |
| `main_linux` | Linux 版本主分支 |

---

## 许可证

MIT
