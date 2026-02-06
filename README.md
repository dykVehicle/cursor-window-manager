# Multi Cursor - Cursor 多窗口管理器

一个 Cursor 多窗口管理工具，支持自由切分窗格、将多个 Cursor 实例嵌入到统一界面中管理，并保存/恢复布局配置。

> **当前分支 (main)：Windows 平台专版**，支持将 Cursor 窗口嵌入到窗格中进行统一管理。Linux 平台仅支持启动独立 Cursor 窗口（不支持嵌入）。

## 功能特性

- **窗口嵌入** - 将 Cursor 编辑器窗口嵌入到窗格中，实现多 Cursor 实例的统一管理（Windows 专属）
- **自由切分窗口** - 支持水平和垂直分割，创建任意数量的窗格；右键窗格可向上/下/左/右四个方向拆分
- **拖动调整布局** - 拖动分割线实时调整窗格大小，嵌入的 Cursor 窗口自动跟随调整
- **预设布局** - 提供 7 种预设布局：单窗格、左右分割、上下分割、三窗格、四窗格、六窗格、八窗格
- **布局持久化** - 自动保存布局配置和窗格状态，下次启动时自动恢复
- **布局收藏** - 可以将当前布局保存为收藏，随时切换不同的工作区配置
- **窗格最大化** - 支持单个窗格的最大化/还原切换
- **一键启动 Cursor** - 每个窗格可独立选择文件夹并启动 Cursor 编辑器
- **DPI 缩放支持** - 支持 Per-Monitor DPI Aware V2，在高分屏和多显示器环境下正确显示
- **自定义标题栏** - 无边框窗口设计，内置最小化/最大化/关闭按钮

## Windows 平台安装部署

### 环境要求

- **操作系统**：Windows 10 / 11
- **Node.js**：>= 18.x
- **npm**：>= 9.x
- **PowerShell**：系统自带即可（用于窗口嵌入功能）
- **Cursor 编辑器**：需预先安装 [Cursor](https://cursor.com/)

### 方式一：使用预编译的 Portable 版本

如果已有打包好的 `.exe` 文件：

1. 将 `Multi Cursor Manager.exe` 放到任意目录
2. 双击运行即可（免安装，绿色便携版）
3. 程序会在同目录下自动创建 `data/` 文件夹存放配置文件

### 方式二：从源码构建（推荐）

```bash
# 1. 克隆仓库
git clone https://github.com/dyk/multi-cursor-manager.git
cd multi-cursor-manager

# 2. 安装依赖
npm install

# 3. 开发模式运行（需要同时运行两个命令）
npm run dev      # 启动 TypeScript 编译监听 + Vite 开发服务器
npm run start    # 在另一个终端启动 Electron（开发模式会连接 localhost:5173）

# 4. 构建生产版本
npm run build

# 5. 打包为 Windows Portable 可执行文件
npm run dist:win
```

打包完成后，输出文件位于 `release/` 目录下，生成的是 **Portable（免安装绿色版）** `.exe` 文件 Multi Cursor Manager 1.0.0.exe。

### Cursor 路径配置

程序会自动检测以下位置的 Cursor 安装路径：

```
%LOCALAPPDATA%\Programs\cursor\Cursor.exe    （默认安装位置）
%LOCALAPPDATA%\cursor\Cursor.exe
C:\Program Files\cursor\Cursor.exe
C:\Program Files\Cursor\Cursor.exe
D:\Program Files\cursor\Cursor.exe
D:\Program Files\Cursor\Cursor.exe
```

如果 Cursor 安装在非默认位置，可以在 **设置** 中手动指定路径，或使用 **自动检测** / **浏览** 功能定位。

## 使用说明

### 基本操作

1. **启动程序** - 双击运行，默认显示三窗格布局
2. **选择文件夹** - 点击窗格中的「选择文件夹」按钮，选择项目目录
3. **启动 Cursor** - 点击「启动 Cursor」按钮，Cursor 会自动打开并嵌入到对应窗格中
4. **调整布局** - 拖动窗格之间的分割线调整大小
5. **关闭 Cursor** - 关闭主窗口时会自动关闭所有嵌入的 Cursor 实例

### 布局管理

| 操作 | 说明 |
|------|------|
| **预设布局** | 工具栏提供 7 种预设布局图标，点击即可快速切换 |
| **添加窗格** | 点击工具栏「添加窗格」按钮 |
| **拆分窗格** | 右键点击窗格，选择向上/下/左/右拆分 |
| **删除窗格** | 点击窗格标题栏的 X 按钮 |
| **最大化窗格** | 点击窗格标题栏的最大化按钮，再次点击还原 |
| **重置布局** | 点击工具栏「重置」按钮恢复默认布局 |
| **保存布局** | 点击「布局管理」->「保存当前布局」，输入名称保存 |
| **加载布局** | 点击「布局管理」，从收藏列表中选择已保存的布局 |

### 窗格操作

- **双击标题** - 编辑窗格名称
- **选择文件夹** - 为窗格指定要打开的项目目录
- **更换文件夹** - 已选择文件夹后可更换为其他目录
- **清除文件夹** - 点击文件夹名称旁的 x 清除已选路径

### 设置

点击工具栏的齿轮图标打开设置面板：

- **Cursor 路径** - 手动输入、浏览或自动检测 Cursor 可执行文件路径
- **调试日志** - 打开日志文件夹查看运行日志（用于问题排查）
- **重置配置** - 清除所有保存的布局和设置，恢复默认状态

### 数据存储

所有配置数据存放在程序所在目录下的 `data/` 文件夹中：

```
程序目录/
├── Multi Cursor Manager.exe    # 主程序
├── data/
│   ├── config.json              # 布局配置、窗格设置、Cursor 路径等
│   └── multi-cursor-manager.log  # 运行日志
└── resources/
    └── embedWindow.ps1          # 窗口嵌入脚本（打包自带）
```

> 配置跟随程序，可以将整个目录复制到 U 盘随身携带使用。

## 技术实现说明

### 窗口嵌入原理（Windows）

本工具采用 **Owner 窗口模式（非 SetParent）** 将 Cursor 窗口嵌入到窗格中：

1. 启动 Cursor 进程，获取进程 PID
2. 通过 PID 或窗口标题查找 Cursor 的主窗口句柄（`Chrome_WidgetWin_1` 类型）
3. 移除窗口边框和标题栏（修改 `WS_STYLE` 和 `WS_EX_STYLE`）
4. 使用 `SetWindowLongPtr(GWLP_HWNDPARENT)` 设置 Owner 关系（而非 `SetParent`）
5. 通过 `SetWindowPos` / `MoveWindow` 精确定位窗口到窗格区域

> 使用 Owner 模式而非 Parent 模式是为了避免 Chromium 内核在 `WS_CHILD` 模式下的输入事件问题。

### 性能优化

- 使用**常驻 PowerShell 进程**处理窗口的 resize 和 focus 操作，避免每次调整都启动新进程
- 初始嵌入使用**独立 PowerShell 脚本**（`embedWindow.ps1`），通过队列确保多窗格顺序嵌入
- resize 使用 50ms 防抖 + `ResizeObserver` 监听，确保流畅跟随

## 技术栈

- **Electron** - 桌面应用框架
- **React** - 前端 UI 框架
- **TypeScript** - 类型安全的开发语言
- **Vite** - 前端构建工具
- **react-mosaic-component** - 窗格拖拽分割布局组件
- **electron-store** - 配置持久化存储
- **koffi** - Windows Native API 调用（FFI）
- **PowerShell** - 窗口嵌入和操控脚本

## 常见问题

### Q: Cursor 启动后没有嵌入到窗格中？
A: 嵌入过程大约需要 2-5 秒。如果长时间未嵌入，请检查：
- Cursor 是否已正确安装
- 设置中的 Cursor 路径是否正确
- 查看 `data/multi-cursor-manager.log` 日志文件排查问题

### Q: 嵌入的 Cursor 窗口位置不准确？
A: 在多显示器或不同 DPI 缩放比例下，程序会自动使用 `dipToScreenPoint` 转换坐标。如果仍有偏移，尝试：
- 将主窗口移动到主显示器
- 调整窗口大小触发重新定位

### Q: 关闭主窗口后 Cursor 进程还在运行？
A: 正常情况下，关闭主窗口会自动发送 `WM_CLOSE` 消息关闭所有嵌入的 Cursor 窗口。如果异常退出导致残留进程，可在任务管理器中手动结束。

### Q: 如何在 Linux 上使用？
A: main 分支的 Linux 支持仅限于启动独立的 Cursor 窗口（不嵌入）。可以使用 `npm run dist:linux` 打包为 AppImage 格式。

## 许可证

MIT
