# Cursor 窗口管理器

一个跨平台的 Cursor 多窗口管理工具，支持自由切分窗格、拖动调整布局，并保存/恢复布局配置。

## 功能特性

- 🪟 **自由切分窗口** - 支持水平和垂直分割，创建任意数量的窗格
- 🖱️ **拖动调整布局** - 拖动分割线实时调整窗格大小
- 💾 **布局持久化** - 自动保存布局配置，下次启动时恢复
- 🎨 **预设布局** - 提供单窗格、双窗格、三窗格、四窗格等预设布局
- 🚀 **一键启动 Cursor** - 每个窗格可独立打开 Cursor 编辑器
- 🌐 **跨平台支持** - 同时支持 Windows 和 Linux

## 安装

### 从源码构建

```bash
# 安装依赖
npm install

# 开发模式
npm run dev
npm run start

# 构建
npm run build

# 打包
npm run dist:win    # Windows
npm run dist:linux  # Linux
```

## 使用说明

1. 启动程序后，默认显示三窗格布局
2. 使用工具栏的布局按钮快速切换预设布局
3. 拖动分割线调整窗格大小
4. 点击"添加窗格"创建新窗格
5. 在每个窗格中选择文件夹并启动 Cursor
6. 布局会自动保存，下次启动时恢复

## 技术栈

- Electron
- React
- TypeScript
- Vite
- electron-store

## 许可证

MIT
