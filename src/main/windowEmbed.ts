/**
 * Windows 窗口嵌入模块
 * 使用 Windows API 将外部应用窗口嵌入到 Electron 窗口中
 */

import { BrowserWindow } from 'electron';

// 在Windows上才加载koffi
let koffi: any = null;
let user32: any = null;

// Windows API 常量
const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const WS_CHILD = 0x40000000;
const WS_VISIBLE = 0x10000000;
const WS_POPUP = 0x80000000;
const WS_CAPTION = 0x00C00000;
const WS_THICKFRAME = 0x00040000;
const WS_BORDER = 0x00800000;
const WS_SYSMENU = 0x00080000;
const WS_MINIMIZEBOX = 0x00020000;
const WS_MAXIMIZEBOX = 0x00010000;
const WS_EX_APPWINDOW = 0x00040000;
const SWP_FRAMECHANGED = 0x0020;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SW_SHOW = 5;

interface WindowInfo {
  hwnd: number;
  title: string;
  processId: number;
}

// 初始化 Windows API
function initWindowsAPI(): boolean {
  if (process.platform !== 'win32') {
    console.log('Window embedding only supported on Windows');
    return false;
  }
  
  try {
    koffi = require('koffi');
    
    // 加载 user32.dll
    const lib = koffi.load('user32.dll');
    
    user32 = {
      FindWindowW: lib.func('FindWindowW', 'void*', ['str16', 'str16']),
      FindWindowExW: lib.func('FindWindowExW', 'void*', ['void*', 'void*', 'str16', 'str16']),
      SetParent: lib.func('SetParent', 'void*', ['void*', 'void*']),
      GetWindowLongW: lib.func('GetWindowLongW', 'int', ['void*', 'int']),
      SetWindowLongW: lib.func('SetWindowLongW', 'int', ['void*', 'int', 'int']),
      SetWindowPos: lib.func('SetWindowPos', 'int', ['void*', 'void*', 'int', 'int', 'int', 'int', 'uint']),
      ShowWindow: lib.func('ShowWindow', 'int', ['void*', 'int']),
      GetWindowThreadProcessId: lib.func('GetWindowThreadProcessId', 'uint', ['void*', 'uint*']),
      EnumWindows: lib.func('EnumWindows', 'int', ['pointer', 'void*']),
      GetWindowTextW: lib.func('GetWindowTextW', 'int', ['void*', 'str16', 'int']),
      GetWindowTextLengthW: lib.func('GetWindowTextLengthW', 'int', ['void*']),
      IsWindowVisible: lib.func('IsWindowVisible', 'int', ['void*']),
      MoveWindow: lib.func('MoveWindow', 'int', ['void*', 'int', 'int', 'int', 'int', 'int']),
    };
    
    console.log('Windows API initialized successfully');
    return true;
  } catch (error) {
    console.error('Failed to initialize Windows API:', error);
    return false;
  }
}

// 查找窗口
export function findWindowByTitle(titleContains: string): number | null {
  if (!user32) {
    if (!initWindowsAPI()) return null;
  }
  
  const windows: WindowInfo[] = [];
  
  try {
    // 定义回调函数
    const enumCallback = koffi.proto('int EnumWindowsCallback(void* hwnd, void* lParam)');
    
    const callback = koffi.register((hwnd: any, _lParam: any) => {
      try {
        if (user32.IsWindowVisible(hwnd)) {
          const length = user32.GetWindowTextLengthW(hwnd);
          if (length > 0) {
            const buffer = Buffer.alloc((length + 1) * 2);
            user32.GetWindowTextW(hwnd, buffer, length + 1);
            const title = buffer.toString('utf16le').replace(/\0+$/, '');
            
            if (title.toLowerCase().includes(titleContains.toLowerCase())) {
              // 转换 hwnd 为数字
              const hwndNum = typeof hwnd === 'bigint' ? Number(hwnd) : hwnd;
              windows.push({ hwnd: hwndNum, title, processId: 0 });
            }
          }
        }
      } catch (e) {
        // 忽略单个窗口的错误
      }
      return 1; // 继续枚举
    }, koffi.pointer(enumCallback));
    
    user32.EnumWindows(callback, null);
    koffi.unregister(callback);
    
    console.log('Found windows:', windows);
    
    if (windows.length > 0) {
      return windows[0].hwnd;
    }
  } catch (error) {
    console.error('Error finding window:', error);
  }
  
  return null;
}

// 嵌入窗口
export function embedWindow(
  childHwnd: number,
  parentWindow: BrowserWindow,
  bounds: { x: number; y: number; width: number; height: number }
): boolean {
  if (!user32) {
    if (!initWindowsAPI()) return false;
  }
  
  try {
    // 获取父窗口句柄
    const parentHwnd = parentWindow.getNativeWindowHandle();
    
    console.log('Embedding window:', childHwnd, 'into parent:', parentHwnd);
    console.log('Bounds:', bounds);
    
    // 获取当前窗口样式
    const currentStyle = user32.GetWindowLongW(childHwnd, GWL_STYLE);
    const currentExStyle = user32.GetWindowLongW(childHwnd, GWL_EXSTYLE);
    
    console.log('Current style:', currentStyle.toString(16));
    console.log('Current exStyle:', currentExStyle.toString(16));
    
    // 移除边框、标题栏等装饰，添加子窗口样式
    const newStyle = (currentStyle & ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_BORDER | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX)) | WS_CHILD | WS_VISIBLE;
    const newExStyle = currentExStyle & ~WS_EX_APPWINDOW;
    
    // 设置新样式
    user32.SetWindowLongW(childHwnd, GWL_STYLE, newStyle);
    user32.SetWindowLongW(childHwnd, GWL_EXSTYLE, newExStyle);
    
    // 设置父窗口
    user32.SetParent(childHwnd, parentHwnd);
    
    // 移动并调整大小
    user32.MoveWindow(childHwnd, bounds.x, bounds.y, bounds.width, bounds.height, 1);
    
    // 应用样式更改
    user32.SetWindowPos(childHwnd, null, bounds.x, bounds.y, bounds.width, bounds.height, 
      SWP_FRAMECHANGED | SWP_NOZORDER | SWP_NOACTIVATE);
    
    // 显示窗口
    user32.ShowWindow(childHwnd, SW_SHOW);
    
    console.log('Window embedded successfully');
    return true;
  } catch (error) {
    console.error('Error embedding window:', error);
    return false;
  }
}

// 调整嵌入窗口的大小和位置
export function resizeEmbeddedWindow(
  hwnd: number,
  bounds: { x: number; y: number; width: number; height: number }
): boolean {
  if (!user32) {
    if (!initWindowsAPI()) return false;
  }
  
  try {
    user32.MoveWindow(hwnd, bounds.x, bounds.y, bounds.width, bounds.height, 1);
    return true;
  } catch (error) {
    console.error('Error resizing window:', error);
    return false;
  }
}

// 取消嵌入窗口（恢复为独立窗口）
export function unembedWindow(hwnd: number): boolean {
  if (!user32) {
    if (!initWindowsAPI()) return false;
  }
  
  try {
    // 设置父窗口为桌面（null）
    user32.SetParent(hwnd, null);
    
    // 恢复窗口样式
    const currentStyle = user32.GetWindowLongW(hwnd, GWL_STYLE);
    const newStyle = (currentStyle & ~WS_CHILD) | WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
    user32.SetWindowLongW(hwnd, GWL_STYLE, newStyle);
    
    // 应用更改
    user32.SetWindowPos(hwnd, null, 100, 100, 800, 600, SWP_FRAMECHANGED);
    user32.ShowWindow(hwnd, SW_SHOW);
    
    return true;
  } catch (error) {
    console.error('Error unembedding window:', error);
    return false;
  }
}

// 检查窗口嵌入功能是否可用
export function isEmbedSupported(): boolean {
  if (process.platform !== 'win32') {
    return false;
  }
  return initWindowsAPI();
}

export { initWindowsAPI };
