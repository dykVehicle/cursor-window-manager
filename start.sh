#!/bin/bash
# Multi Cursor 一键启动脚本

# 设置工作目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 确保 PATH 包含 npm/node
export PATH="$HOME/.nvm/versions/node/$(ls -1 $HOME/.nvm/versions/node 2>/dev/null | tail -1)/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

# 检查依赖是否安装
if [ ! -d "node_modules" ]; then
    echo "首次运行，正在安装依赖..."
    npm install
fi

# 每次启动前重新编译主进程代码（确保 TypeScript 修改生效）
echo "正在编译主进程..."
npm run build:main

# 启动开发模式（Vite + Electron）
echo "正在启动 Multi Cursor..."

# 启动 Vite 开发服务器
npm run dev:renderer &
VITE_PID=$!

# 等待 Vite 服务器启动
sleep 2

# 启动 Electron
npm run start

# 清理 Vite 进程
kill $VITE_PID 2>/dev/null
