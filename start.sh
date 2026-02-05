#!/bin/bash
# Multi Cursor 一键启动脚本

cd "$(dirname "$0")"

# 检查依赖是否安装
if [ ! -d "node_modules" ]; then
    echo "首次运行，正在安装依赖..."
    npm install
fi

# 启动开发模式
echo "正在启动 Multi Cursor..."
npm run dev &

# 等待 Vite 服务器启动
sleep 3

# 启动 Electron
npm run start
