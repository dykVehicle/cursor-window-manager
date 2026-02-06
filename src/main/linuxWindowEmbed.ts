/**
 * Linux 窗口嵌入模块
 * 使用 xdotool 实现窗口管理（伪嵌入模式：去除边框 + 位置同步）
 */

import { BrowserWindow, screen, app } from 'electron';
import { exec, execSync, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

// ============ X11 / EWMH 辅助（用于可靠置顶，避免主窗口遮挡）============
// 说明：
// - 直接用 xprop 修改 _NET_WM_STATE 往往会被窗口管理器覆盖
// - 需要向 root window 发送 EWMH ClientMessage 请求（wmctrl 就是这么做的）
// - 本项目不依赖 wmctrl，因此用 koffi 调 libX11 发送消息
let koffi: any = null;
let x11: {
  XOpenDisplay: any;
  XCloseDisplay: any;
  XDefaultScreen: any;
  XRootWindow: any;
  XInternAtom: any;
  XSendEvent: any;
  XFlush: any;
  XRaiseWindow: any;
  XSetTransientForHint: any;
  XReparentWindow: any;
  XMoveResizeWindow: any;
  XMapWindow: any;
} | null = null;
let x11Display: any = null;
let x11RootWindow: bigint | null = null;
let x11Atoms: Map<string, bigint> = new Map();
let x11InitTried = false;

// XShape 扩展（用于设置主窗口输入区域，实现 pane 区域鼠标穿透）
let xShapeAvailable = false;
let XShapeCombineRectangles: any = null;

function toBigInt(v: any): bigint {
  return typeof v === 'bigint' ? v : BigInt(v ?? 0);
}

function is64BitUnix(): boolean {
  // Node 的 process.arch 在常见 64 位环境为 x64/arm64
  return process.arch === 'x64' || process.arch === 'arm64';
}

function alignUp(n: number, align: number): number {
  return Math.ceil(n / align) * align;
}

function initX11(): boolean {
  if (process.platform !== 'linux') return false;
  if (x11Display) return true;
  if (x11InitTried) return false;
  x11InitTried = true;

  try {
    koffi = require('koffi');
    const lib = koffi.load('libX11.so.6');

    x11 = {
      XOpenDisplay: lib.func('XOpenDisplay', 'void*', ['str']),
      XCloseDisplay: lib.func('XCloseDisplay', 'int', ['void*']),
      XDefaultScreen: lib.func('XDefaultScreen', 'int', ['void*']),
      XRootWindow: lib.func('XRootWindow', 'ulong', ['void*', 'int']),
      XInternAtom: lib.func('XInternAtom', 'ulong', ['void*', 'str', 'int']),
      XSendEvent: lib.func('XSendEvent', 'int', ['void*', 'ulong', 'int', 'long', 'void*']),
      XFlush: lib.func('XFlush', 'int', ['void*']),
      XRaiseWindow: lib.func('XRaiseWindow', 'int', ['void*', 'ulong']),
      XSetTransientForHint: lib.func('XSetTransientForHint', 'int', ['void*', 'ulong', 'ulong']),
      XReparentWindow: lib.func('XReparentWindow', 'int', ['void*', 'ulong', 'ulong', 'int', 'int']),
      XMoveResizeWindow: lib.func('XMoveResizeWindow', 'int', ['void*', 'ulong', 'int', 'int', 'uint', 'uint']),
      XMapWindow: lib.func('XMapWindow', 'int', ['void*', 'ulong']),
    };

    const displayName = process.env.DISPLAY || '';
    x11Display = x11.XOpenDisplay(displayName);
    if (!x11Display) {
      log('[X11] XOpenDisplay failed, DISPLAY=', displayName);
      x11Display = null;
      return false;
    }

    const screenNum: number = x11.XDefaultScreen(x11Display);
    x11RootWindow = toBigInt(x11.XRootWindow(x11Display, screenNum));

    // 尽量在进程退出时释放（非关键）
    process.once('exit', () => {
      try {
        if (x11 && x11Display) {
          x11.XCloseDisplay(x11Display);
        }
      } catch {
        // ignore
      } finally {
        x11Display = null;
        x11RootWindow = null;
        x11Atoms.clear();
        x11InitTried = false;
      }
    });

    log('[X11] Initialized OK, rootWindow=', String(x11RootWindow));
    
    // 加载 XShape 扩展（用于输入区域穿透）
    try {
      const libXext = koffi.load('libXext.so.6');
      // XShapeCombineRectangles(Display*, Window, int kind, int x_off, int y_off, XRectangle*, int n_rects, int op, int ordering)
      // XRectangle = { short x, short y, unsigned short width, unsigned short height } = 8 bytes
      XShapeCombineRectangles = libXext.func('XShapeCombineRectangles', 'void', [
        'void*', 'ulong', 'int', 'int', 'int', 'void*', 'int', 'int', 'int'
      ]);
      xShapeAvailable = true;
      log('[X11] XShape extension loaded OK');
    } catch (e: any) {
      log('[X11] XShape extension not available:', e?.message);
      xShapeAvailable = false;
    }
    
    return true;
  } catch (e: any) {
    log('[X11] init failed:', e?.message || String(e));
    x11Display = null;
    x11RootWindow = null;
    x11 = null;
    return false;
  }
}

function getAtom(name: string): bigint {
  if (!initX11() || !x11 || !x11Display) return 0n;
  const cached = x11Atoms.get(name);
  if (cached) return cached;
  const atom = toBigInt(x11.XInternAtom(x11Display, name, 0));
  x11Atoms.set(name, atom);
  return atom;
}

function buildClientMessageEvent(params: {
  window: bigint;
  messageType: bigint;
  data: [bigint, bigint, bigint, bigint, bigint];
}): Buffer {
  // XClientMessageEvent 布局（与 Xlib 一致）：type/int, serial/ulong, send_event/Bool(int),
  // display/ptr, window/Window(ulong), message_type/Atom(ulong), format/int, data.l[5]/long[5]
  const is64 = is64BitUnix();
  const LONG_SIZE = is64 ? 8 : 4;
  const PTR_SIZE = is64 ? 8 : 4;
  // XEvent 在 Xlib 中固定为 24 * sizeof(long)（32位=96字节，64位=192字节）
  // XSendEvent 会读取 sizeof(XEvent) 字节，因此这里必须按该大小分配，避免越界读取导致事件内容异常
  const EVENT_SIZE = 24 * LONG_SIZE;

  const offsetType = 0;
  const offsetSerial = alignUp(offsetType + 4, LONG_SIZE);
  const offsetSendEvent = offsetSerial + LONG_SIZE;
  const offsetDisplay = alignUp(offsetSendEvent + 4, PTR_SIZE);
  const offsetWindow = offsetDisplay + PTR_SIZE;
  const offsetMessageType = offsetWindow + LONG_SIZE;
  const offsetFormat = offsetMessageType + LONG_SIZE;
  const offsetData = alignUp(offsetFormat + 4, LONG_SIZE);
  const buf = Buffer.alloc(EVENT_SIZE);

  // type = ClientMessage (33)
  buf.writeInt32LE(33, offsetType);

  // serial = 0
  if (is64) buf.writeBigUInt64LE(0n, offsetSerial);
  else buf.writeUInt32LE(0, offsetSerial);

  // send_event = True (1)
  buf.writeInt32LE(1, offsetSendEvent);

  // display 指针：我们只需要把事件发给 WM，display 字段对 XSendEvent 并非必需
  // 注意：koffi 的 Display* 是 External 对象，无法转换为 number/bigint；因此这里安全地写 0
  if (is64) buf.writeBigUInt64LE(0n, offsetDisplay);
  else buf.writeUInt32LE(0, offsetDisplay);

  // window / message_type
  if (is64) buf.writeBigUInt64LE(params.window, offsetWindow);
  else buf.writeUInt32LE(Number(params.window), offsetWindow);

  if (is64) buf.writeBigUInt64LE(params.messageType, offsetMessageType);
  else buf.writeUInt32LE(Number(params.messageType), offsetMessageType);

  // format = 32
  buf.writeInt32LE(32, offsetFormat);

  // data.l[0..4]（long）
  const writeLong = (idx: number, v: bigint) => {
    const off = offsetData + idx * LONG_SIZE;
    if (is64) buf.writeBigInt64LE(v, off);
    else buf.writeInt32LE(Number(v), off);
  };

  writeLong(0, params.data[0]);
  writeLong(1, params.data[1]);
  writeLong(2, params.data[2]);
  writeLong(3, params.data[3]);
  writeLong(4, params.data[4]);

  return buf;
}

function requestNetWmState(windowId: string, stateAtomName: string, action: 0 | 1 | 2): boolean {
  if (!initX11() || !x11 || !x11Display || !x11RootWindow) return false;

  try {
    const netWmState = getAtom('_NET_WM_STATE');
    const stateAtom = getAtom(stateAtomName);
    if (netWmState === 0n || stateAtom === 0n) return false;

    const win = toBigInt(windowId);
    // EWMH: data.l[0]=action(0/1/2), l[1]=state1, l[2]=state2, l[3]=source(1=app), l[4]=0
    const event = buildClientMessageEvent({
      window: win,
      messageType: netWmState,
      data: [BigInt(action), stateAtom, 0n, 1n, 0n],
    });

    // SubstructureRedirectMask | SubstructureNotifyMask
    const mask = 0x00100000 | 0x00080000;
    const rc = x11.XSendEvent(x11Display, x11RootWindow, 0, mask, event);
    x11.XFlush(x11Display);
    return !!rc;
  } catch (e: any) {
    log('[X11] requestNetWmState failed:', e?.message || String(e));
    return false;
  }
}

// 获取日志文件路径（与 main.ts 相同）
function getLogFilePath(): string {
  const appDir = app.isPackaged ? path.dirname(app.getPath('exe')) : path.resolve(__dirname, '..', '..');
  return path.join(appDir, 'data', 'cursor-window-manager.log');
}

// 日志函数 - 同时输出到 console 和文件
function log(...args: any[]) {
  const timestamp = new Date().toISOString();
  const message = `[${timestamp}] [Linux] ${args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')}`;
  console.log(message);
  
  // 写入日志文件
  try {
    fs.appendFileSync(getLogFilePath(), message + '\n');
  } catch (e) {
    // 忽略写入错误
  }
}

// 检查 xdotool 是否可用
let xdotoolAvailable: boolean | null = null;

export async function checkXdotool(): Promise<boolean> {
  if (xdotoolAvailable !== null) return xdotoolAvailable;
  
  try {
    await execAsync('which xdotool');
    xdotoolAvailable = true;
    log('xdotool is available');
  } catch {
    xdotoolAvailable = false;
    log('xdotool is NOT available');
  }
  return xdotoolAvailable;
}

// 存储嵌入窗口信息
interface LinuxWindowInfo {
  windowId: string;  // X11 窗口 ID
  pid: number;
  reparented?: boolean;  // 是否已通过 XReparentWindow 嵌入
}

const embeddedWindows: Map<string, LinuxWindowInfo> = new Map();

// 定期打印 Map 状态（调试用）
let debugIntervalStarted = false;
function startDebugInterval() {
  if (debugIntervalStarted) return;
  debugIntervalStarted = true;
  setInterval(() => {
    if (embeddedWindows.size > 0) {
      log(`[DEBUG] embeddedWindows status: size=${embeddedWindows.size}, keys=[${Array.from(embeddedWindows.keys()).join(',')}]`);
    }
  }, 5000);
}
startDebugInterval();

// 记录已知的 Cursor 窗口 ID（用于排除）
const knownCursorWindowIds: Set<string> = new Set();

// 存储主窗口 X11 ID（用于 stacking）
let mainWindowX11Id: string | null = null;

/**
 * 设置主窗口 X11 ID（在嵌入前由 main.ts 调用）
 */
export function setMainWindowX11Id(id: string): void {
  mainWindowX11Id = id;
  log(`[X11] Main window X11 ID set to: ${id}`);
}

// ============ XReparentWindow 嵌入 ============
// 将子 Cursor 窗口 reparent 到主 Electron 窗口中，成为真正的 X11 子窗口
// 这样输入事件会自动正确分发到子窗口，不需要 XShape 穿透

/**
 * 将窗口重新挂载为另一个窗口的 X11 子窗口
 * reparent 后窗口坐标变为相对于父窗口，且自动跟随父窗口最小化/关闭
 */
export function reparentWindow(childId: string, parentId: string, x: number, y: number): boolean {
  if (!initX11() || !x11 || !x11Display) return false;
  try {
    const childWin = toBigInt(childId);
    const parentWin = toBigInt(parentId);
    x11.XReparentWindow(x11Display, childWin, parentWin, Math.round(x), Math.round(y));
    x11.XMapWindow(x11Display, childWin);
    x11.XFlush(x11Display);
    log(`[X11] XReparentWindow: child=${childId} -> parent=${parentId} at (${x}, ${y})`);
    return true;
  } catch (e: any) {
    log(`[X11] XReparentWindow failed: ${e?.message}`);
    return false;
  }
}

/**
 * 使用 X11 API 直接移动和调整窗口大小（用于 reparent 后的子窗口）
 * 坐标是相对于父窗口的
 */
export function moveResizeWindowX11(windowId: string, x: number, y: number, width: number, height: number): boolean {
  if (!x11 || !x11Display) return false;
  try {
    x11.XMoveResizeWindow(
      x11Display,
      toBigInt(windowId),
      Math.round(x),
      Math.round(y),
      Math.max(1, Math.round(width)),
      Math.max(1, Math.round(height))
    );
    x11.XFlush(x11Display);
    return true;
  } catch (e: any) {
    log(`[X11] XMoveResizeWindow failed: ${e?.message}`);
    return false;
  }
}

/**
 * 检查窗口是否已被 reparent
 */
export function isWindowReparented(paneId: string): boolean {
  const info = embeddedWindows.get(paneId);
  return info?.reparented === true;
}

// ============ XShape 输入穿透 ============
// XRectangle 结构体：short x, short y, unsigned short width, unsigned short height = 8 bytes

function buildXRectangleBuffer(rects: Array<{x: number, y: number, width: number, height: number}>): Buffer {
  const buf = Buffer.alloc(rects.length * 8);
  for (let i = 0; i < rects.length; i++) {
    buf.writeInt16LE(Math.round(rects[i].x), i * 8);
    buf.writeInt16LE(Math.round(rects[i].y), i * 8 + 2);
    buf.writeUInt16LE(Math.round(rects[i].width), i * 8 + 4);
    buf.writeUInt16LE(Math.round(rects[i].height), i * 8 + 6);
  }
  return buf;
}

/**
 * 更新主窗口的输入区域（XShape ShapeInput）
 * 让已嵌入 Cursor 的 pane 内容区域鼠标穿透，点击直接到达子 Cursor 窗口
 * 
 * @param windowWidth  主窗口宽度
 * @param windowHeight 主窗口高度
 * @param excludeRegions 需要穿透的区域（pane 内容区域坐标，相对于主窗口）
 */
export function updateMainWindowInputShape(
  windowWidth: number,
  windowHeight: number,
  excludeRegions: Array<{x: number, y: number, width: number, height: number}>
): boolean {
  if (!xShapeAvailable || !XShapeCombineRectangles || !x11Display || !mainWindowX11Id) {
    return false;
  }
  
  const ShapeInput = 2;
  const ShapeSet = 0;
  const ShapeSubtract = 3;
  const Unsorted = 0;
  const win = toBigInt(mainWindowX11Id);
  
  try {
    // 1. 设置整个窗口为输入区域
    const fullRect = buildXRectangleBuffer([{ x: 0, y: 0, width: windowWidth, height: windowHeight }]);
    XShapeCombineRectangles(x11Display, win, ShapeInput, 0, 0, fullRect, 1, ShapeSet, Unsorted);
    
    // 2. 减去每个已嵌入 Cursor 的 pane 内容区域（使这些区域鼠标穿透）
    for (const region of excludeRegions) {
      if (region.width <= 0 || region.height <= 0) continue;
      const rect = buildXRectangleBuffer([region]);
      XShapeCombineRectangles(x11Display, win, ShapeInput, 0, 0, rect, 1, ShapeSubtract, Unsorted);
    }
    
    if (x11) x11.XFlush(x11Display);
    return true;
  } catch (e: any) {
    log(`[XShape] updateMainWindowInputShape failed: ${e?.message}`);
    return false;
  }
}

/**
 * 重置主窗口输入区域（取消穿透，恢复正常）
 */
export function resetMainWindowInputShape(windowWidth: number, windowHeight: number): boolean {
  if (!xShapeAvailable || !XShapeCombineRectangles || !x11Display || !mainWindowX11Id) {
    return false;
  }
  
  try {
    const fullRect = buildXRectangleBuffer([{ x: 0, y: 0, width: windowWidth, height: windowHeight }]);
    XShapeCombineRectangles(x11Display, toBigInt(mainWindowX11Id), 2/*ShapeInput*/, 0, 0, fullRect, 1, 0/*ShapeSet*/, 0/*Unsorted*/);
    if (x11) x11.XFlush(x11Display);
    return true;
  } catch (e: any) {
    log(`[XShape] resetMainWindowInputShape failed: ${e?.message}`);
    return false;
  }
}

/**
 * 同步提升单个窗口（使用 X11 API，无延迟）
 */
function raiseWindowX11(windowId: string): boolean {
  if (!initX11() || !x11 || !x11Display) return false;
  try {
    x11.XRaiseWindow(x11Display, toBigInt(windowId));
    return true;
  } catch (e: any) {
    log(`[X11] XRaiseWindow failed for ${windowId}:`, e?.message);
    return false;
  }
}

/**
 * 获取窗口几何信息
 */
async function getWindowGeometry(windowId: string): Promise<{ width: number; height: number } | null> {
  try {
    const { stdout } = await execAsync(`xdotool getwindowgeometry ${windowId}`, { timeout: 2000 });
    const match = stdout.match(/Geometry:\s+(\d+)x(\d+)/);
    if (match) {
      return { width: parseInt(match[1]), height: parseInt(match[2]) };
    }
  } catch {
    // 忽略
  }
  return null;
}

/**
 * 获取窗口标题
 */
async function getWindowTitle(windowId: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`xdotool getwindowname ${windowId}`, { timeout: 2000 });
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * 记录当前所有 Cursor 窗口（用于后续识别新窗口）
 */
export async function recordExistingCursorWindows(): Promise<void> {
  try {
    const { stdout } = await execAsync('xdotool search --name "Cursor"', { timeout: 5000 });
    const windowIds = stdout.trim().split('\n').filter(id => id.length > 0);
    windowIds.forEach(id => knownCursorWindowIds.add(id));
    log(`Recorded ${knownCursorWindowIds.size} existing Cursor windows`);
  } catch {
    // 忽略
  }
}

// 缓存已检查过的小窗口 ID（避免重复检查几何信息）
const rejectedSmallWindows: Set<string> = new Set();

/**
 * 查找新创建的 Cursor 主窗口
 * 使用单条 shell 命令批量获取所有窗口 ID + 几何信息，大幅减少 subprocess 开销
 */
export async function findNewCursorWindow(maxAttempts: number = 50, delayMs: number = 100): Promise<string | null> {
  log(`Looking for new Cursor window (excluding ${knownCursorWindowIds.size} known, ${rejectedSmallWindows.size} rejected)`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // 单条命令：搜索所有 Cursor 窗口并批量获取几何信息（1 次 subprocess 代替 N 次）
      // 注意：--shell 输出是多行的，用 tr 合并为单行
      const { stdout } = await execAsync(
        `xdotool search --name "Cursor" 2>/dev/null | while read wid; do geo=$(xdotool getwindowgeometry --shell "$wid" 2>/dev/null | tr '\\n' ' '); echo "WID=$wid $geo"; done`,
        { timeout: 2000, shell: '/bin/bash' }
      );
      
      // 解析输出：每行 "WID=12345 X=0 Y=0 WIDTH=1280 HEIGHT=800 SCREEN=0"
      const lines = stdout.trim().split('\n').filter(l => l.startsWith('WID='));
      for (const line of lines) {
        const widMatch = line.match(/WID=(\d+)/);
        const wMatch = line.match(/WIDTH=(\d+)/);
        const hMatch = line.match(/HEIGHT=(\d+)/);
        if (!widMatch) continue;
        
        const windowId = widMatch[1];
        // 跳过已知和已拒绝的窗口
        if (knownCursorWindowIds.has(windowId) || rejectedSmallWindows.has(windowId)) continue;
        
        const width = wMatch ? parseInt(wMatch[1]) : 0;
        const height = hMatch ? parseInt(hMatch[1]) : 0;
        
        if (width >= 100 && height >= 100) {
          log(`Found new Cursor window: ID=${windowId}, size=${width}x${height} (attempt ${attempt})`);
          return windowId;
        } else {
          // 记住这个小窗口，下次不再检查
          rejectedSmallWindows.add(windowId);
        }
      }
    } catch (e: any) {
      // xdotool search 找不到窗口时返回非 0，正常
    }
    
    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  log('New Cursor window not found after all attempts');
  return null;
}

/**
 * 通过窗口标题查找窗口 ID
 */
export async function findWindowByTitle(titlePattern: string, excludeIds: string[] = []): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`xdotool search --name "${titlePattern}"`, { timeout: 5000 });
    const windowIds = stdout.trim().split('\n').filter(id => id.length > 0 && !excludeIds.includes(id));
    
    if (windowIds.length > 0) {
      return windowIds[windowIds.length - 1];
    }
  } catch {
    // 没找到窗口
  }
  return null;
}

/**
 * 移除窗口边框装饰
 * 使用 _MOTIF_WM_HINTS（最可靠的方法，几乎所有 WM 都支持）
 */
export async function removeWindowDecorations(windowId: string): Promise<boolean> {
  log(`Removing decorations for window: ${windowId}`);
  
  try {
    // _MOTIF_WM_HINTS: flags=2 表示只设置 decorations，decorations=0 表示无边框
    await execAsync(`xprop -id ${windowId} -f _MOTIF_WM_HINTS 32c -set _MOTIF_WM_HINTS "2, 0, 0, 0, 0"`, { timeout: 1000 });
    log('Applied _MOTIF_WM_HINTS - decorations removed');
    return true;
  } catch (e: any) {
    log(`Failed to remove decorations: ${e.message}`);
    return false;
  }
}

/**
 * 移动并调整窗口大小（单次 xdotool 调用，快速）
 */
export async function moveResizeWindow(
  windowId: string,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<boolean> {
  const roundX = Math.round(x);
  const roundY = Math.round(y);
  const roundW = Math.round(width);
  const roundH = Math.round(height);
  
  try {
    // 单次 xdotool 调用完成：激活 + 调整大小 + 移动 + 提升
    const cmd = `xdotool windowactivate --sync ${windowId} windowsize ${windowId} ${roundW} ${roundH} windowmove ${windowId} ${roundX} ${roundY} windowraise ${windowId}`;
    log(`Executing: ${cmd}`);
    await execAsync(cmd, { timeout: 3000 });
    
    log(`Window moved to (${roundX},${roundY}), size ${roundW}x${roundH}`);
    return true;
  } catch (e: any) {
    log(`Failed to move/resize window: ${e.message}`);
    return false;
  }
}

/**
 * 快速移动并调整窗口大小（异步非阻塞版，用于拖拽时）
 * 使用 spawn 而不是 execSync，不等待命令完成
 */
const lastPosition: Map<string, { x: number; y: number; w: number; h: number }> = new Map();

// 移动计数器（用于调试）
let moveCount = 0;

export function moveResizeWindowSync(
  windowId: string,
  x: number,
  y: number,
  width: number,
  height: number
): boolean {
  const roundX = Math.round(x);
  const roundY = Math.round(y);
  const roundW = Math.round(width);
  const roundH = Math.round(height);
  
  moveCount++;
  
  // 检查位置是否真的变化了（避免重复执行相同命令）
  const last = lastPosition.get(windowId);
  const positionChanged = !last || last.x !== roundX || last.y !== roundY;
  const sizeChanged = !last || last.w !== roundW || last.h !== roundH;
  
  if (!positionChanged && !sizeChanged) {
    return true; // 位置没变，跳过
  }
  
  lastPosition.set(windowId, { x: roundX, y: roundY, w: roundW, h: roundH });
  
  try {
    if (sizeChanged) {
      // 移动、调整大小、提升
      const child = spawn('xdotool', [
        'windowmove', windowId, String(roundX), String(roundY),
        'windowsize', windowId, String(roundW), String(roundH),
        'windowraise', windowId
      ], { stdio: 'ignore', detached: true });
      child.unref();
    } else {
      // 只移动和提升（更快）
      const child = spawn('xdotool', [
        'windowmove', windowId, String(roundX), String(roundY),
        'windowraise', windowId
      ], { stdio: 'ignore', detached: true });
      child.unref();
    }
    return true;
  } catch (e: any) {
    log(`[moveSync] FAILED windowId=${windowId}: ${e.message}`);
    return false;
  }
}

/**
 * 批量移动/调整大小（单次 xdotool 调用），用于主窗口拖拽时高频同步
 * - 只对发生变化的窗口发命令
 * - 默认会对变更的窗口执行 windowraise，减少被主窗口遮挡的概率
 */
export function batchMoveResizeWindowsSync(
  ops: Array<{ windowId: string; x: number; y: number; width: number; height: number }>,
  options?: { raise?: boolean }
): boolean {
  if (ops.length === 0) return true;

  const args: string[] = [];
  const shouldRaise = options?.raise !== false;

  for (const op of ops) {
    const windowId = op.windowId;
    const roundX = Math.round(op.x);
    const roundY = Math.round(op.y);
    const roundW = Math.round(op.width);
    const roundH = Math.round(op.height);

    const last = lastPosition.get(windowId);
    const positionChanged = !last || last.x !== roundX || last.y !== roundY;
    const sizeChanged = !last || last.w !== roundW || last.h !== roundH;

    if (!positionChanged && !sizeChanged) continue;

    // 先更新缓存，避免同一帧内重复触发
    lastPosition.set(windowId, { x: roundX, y: roundY, w: roundW, h: roundH });

    // 使用 xdotool 的多命令模式：cmd1 args cmd2 args ...
    args.push('windowmove', windowId, String(roundX), String(roundY));
    if (sizeChanged) {
      args.push('windowsize', windowId, String(roundW), String(roundH));
    }
    if (shouldRaise) {
      args.push('windowraise', windowId);
    }
  }

  if (args.length === 0) return true;

  try {
    const child = spawn('xdotool', args, { stdio: 'ignore', detached: true });
    child.unref();
    return true;
  } catch (e: any) {
    log(`[batchMoveSync] FAILED: ${e.message}`);
    return false;
  }
}

/**
 * 设置窗口层级（仅使用 windowraise，不设全局 ABOVE 避免遮挡其他程序）
 * 配合 WM_TRANSIENT_FOR 实现：子窗口在主窗口之上，但不遮挡其他应用
 */
export async function setWindowAbove(windowId: string, above: boolean = true): Promise<boolean> {
  log(`[setWindowAbove] Setting window ${windowId} above=${above}`);
  
  if (above) {
    try {
      await execAsync(`xdotool windowraise ${windowId}`, { timeout: 1000 });
      log(`[setWindowAbove] Raised window ${windowId} with xdotool`);
      return true;
    } catch (e) {
      log(`[setWindowAbove] xdotool windowraise failed`);
      return false;
    }
  } else {
    // 移除 ABOVE 状态（如果之前有设置的话）
    requestNetWmState(windowId, '_NET_WM_STATE_ABOVE', 0);
    requestNetWmState(windowId, '_NET_WM_STATE_STAYS_ON_TOP', 0);
    return true;
  }
}

/**
 * 移除所有嵌入窗口的全局置顶状态（修复遮挡其他程序的问题）
 */
export function removeGlobalAboveState(): void {
  for (const [paneId, info] of embeddedWindows) {
    requestNetWmState(info.windowId, '_NET_WM_STATE_ABOVE', 0);
    requestNetWmState(info.windowId, '_NET_WM_STATE_STAYS_ON_TOP', 0);
    log(`[removeGlobalAbove] Removed ABOVE/TOP for pane=${paneId}, windowId=${info.windowId}`);
  }
}

/**
 * 设置窗口为另一个窗口的 transient（父子窗口关系）
 * WM_TRANSIENT_FOR 让窗口管理器：
 *   - 始终将子窗口保持在父窗口之上
 *   - 父窗口获得焦点时自动提升子窗口
 *   - 父窗口最小化/恢复时子窗口跟随
 */
export async function setWindowTransientFor(childWindowId: string, parentWindowId: string): Promise<boolean> {
  // 优先使用 X11 API（直接传数值，无格式转换问题）
  if (initX11() && x11 && x11Display) {
    try {
      const childWin = toBigInt(childWindowId);
      const parentWin = toBigInt(parentWindowId);
      x11.XSetTransientForHint(x11Display, childWin, parentWin);
      x11.XFlush(x11Display);
      log(`[X11] Set WM_TRANSIENT_FOR: child=${childWindowId}, parent=${parentWindowId} (via X11 API)`);
      return true;
    } catch (e: any) {
      log(`[X11] XSetTransientForHint failed: ${e?.message}, falling back to xprop`);
    }
  }
  
  // 兜底：使用 xprop（修复：用 32c 格式 + 十六进制值，确保正确）
  try {
    const hexParentId = '0x' + parseInt(parentWindowId).toString(16);
    await execAsync(`xprop -id ${childWindowId} -f WM_TRANSIENT_FOR 32x -set WM_TRANSIENT_FOR ${hexParentId}`);
    log(`Set transient_for via xprop: child=${childWindowId}, parent=${parentWindowId} (hex=${hexParentId})`);
    return true;
  } catch (e: any) {
    log(`Failed to set transient_for: ${e.message}`);
    return false;
  }
}

/**
 * 获取主窗口的 X11 窗口 ID
 */
export async function getMainWindowId(mainWindow: BrowserWindow): Promise<string | null> {
  try {
    // 获取 Electron 窗口的 native handle
    const nativeHandle = mainWindow.getNativeWindowHandle();
    // 在 Linux 上，这个 handle 就是 X11 窗口 ID
    const windowId = nativeHandle.readUInt32LE(0);
    log(`Main window X11 ID: ${windowId}`);
    return windowId.toString();
  } catch (e: any) {
    log(`Failed to get main window ID: ${e.message}`);
    return null;
  }
}

/**
 * 激活窗口（设置焦点）
 */
export async function focusWindow(windowId: string): Promise<boolean> {
  try {
    await execAsync(`xdotool windowactivate ${windowId}`);
    return true;
  } catch (e: any) {
    console.error(`[Linux] Failed to focus window: ${e.message}`);
    return false;
  }
}

/**
 * 关闭窗口
 */
export async function closeWindow(windowId: string): Promise<boolean> {
  try {
    await execAsync(`xdotool windowclose ${windowId}`);
    return true;
  } catch (e: any) {
    console.error(`[Linux] Failed to close window: ${e.message}`);
    return false;
  }
}

/**
 * 嵌入窗口到指定位置（伪嵌入：移除边框 + 定位）
 */
export async function embedWindowLinux(
  paneId: string,
  pid: number,
  mainWindow: BrowserWindow,
  paneBounds: { x: number; y: number; width: number; height: number }
): Promise<{ success: boolean; windowId?: string; error?: string }> {
  log(`Embedding window for pane: ${paneId}, pid: ${pid}`);
  
  // 检查 xdotool
  if (!await checkXdotool()) {
    return { success: false, error: 'xdotool is not installed' };
  }
  
  // 查找新创建的 Cursor 主窗口（排除小窗口和已知窗口）
  const windowId = await findNewCursorWindow(30, 500);
  if (!windowId) {
    return { success: false, error: 'New Cursor window not found' };
  }
  
  // 将此窗口标记为已知（避免被其他 pane 使用）
  knownCursorWindowIds.add(windowId);
  
  // 取消最大化（xprop 方式）
  try {
    await execAsync(`xprop -id ${windowId} -f _NET_WM_STATE 32a -remove _NET_WM_STATE_MAXIMIZED_VERT,_NET_WM_STATE_MAXIMIZED_HORZ`, { timeout: 1000 });
  } catch (e) {
    // 忽略（可能不是最大化状态）
  }
  
  // 移除窗口装饰
  await removeWindowDecorations(windowId);
  
  const mainWindowId = mainWindowX11Id || (await getMainWindowId(mainWindow));
  
  // ★ 不使用 XReparentWindow 嵌入模式
  // 原因：当 Cursor 窗口通过 XReparentWindow 成为 Electron 主窗口的 X11 子窗口后，
  // Electron/Chromium 的输入处理层（GTK/GDK）会拦截主窗口上的所有鼠标事件，
  // 导致子 Cursor 窗口完全无法响应鼠标点击。
  // 
  // 改用浮动窗口模式：Cursor 窗口保持为独立的顶层窗口，
  // 通过 WM_TRANSIENT_FOR 保持在主窗口之上，
  // 通过 XShape（ShapeInput）在主窗口对应 pane 区域打"输入穿透洞"，
  // 让鼠标事件直接穿透到下方的浮动 Cursor 窗口。
  const reparented = false;
  log(`[Embed] Using floating window mode (transient + XShape) for pane: ${paneId}`);
  
  // 设置 WM_TRANSIENT_FOR：让窗口管理器始终将 Cursor 窗口保持在主窗口之上
  if (mainWindowId) {
    await setWindowTransientFor(windowId, mainWindowId);
  }
  
  // 移动到屏幕绝对坐标（主窗口 contentBounds + pane 相对位置）
  const contentBounds = mainWindow.getContentBounds();
  const screenX = contentBounds.x + paneBounds.x;
  const screenY = contentBounds.y + paneBounds.y;
  
  log(`Moving window to: (${screenX}, ${screenY}), size: ${paneBounds.width}x${paneBounds.height}`);
  
  const moveResult = await moveResizeWindow(windowId, screenX, screenY, paneBounds.width, paneBounds.height);
  if (!moveResult) {
    return { success: false, error: 'Failed to move/resize window' };
  }
  raiseWindowX11(windowId);
  
  // 保存窗口信息
  embeddedWindows.set(paneId, { windowId, pid, reparented });
  log(`[EMBED] Done: paneId=${paneId}, windowId=${windowId}, reparented=${reparented}, total=${embeddedWindows.size}`);
  
  return { success: true, windowId };
}

/**
 * 调整嵌入窗口大小
 */
// 用于调试：记录最后一次 resize 的信息
const lastResizeInfo: Map<string, { x: number; y: number; w: number; h: number; time: number }> = new Map();

// 调试计数器
let resizeCallCount = 0;
let lastDebugTime = 0;

export async function resizeEmbeddedWindowLinux(
  paneId: string,
  mainWindow: BrowserWindow,
  paneBounds: { x: number; y: number; width: number; height: number }
): Promise<boolean> {
  resizeCallCount++;
  
  // 每次都检查 Map 状态
  const mapSize = embeddedWindows.size;
  const mapKeys = Array.from(embeddedWindows.keys());
  
  const info = embeddedWindows.get(paneId);
  if (!info) {
    // 调试：每 500ms 打印一次
    const now = Date.now();
    if (now - lastDebugTime > 500) {
      log(`[RESIZE] pane=${paneId} NOT FOUND! Map.size=${mapSize}, keys=[${mapKeys.join(',')}], call#${resizeCallCount}`);
      lastDebugTime = now;
    }
    return false;
  }
  
  // 找到了，打印确认
  if (resizeCallCount <= 3 || resizeCallCount % 100 === 0) {
    log(`[RESIZE] FOUND pane=${paneId}, windowId=${info.windowId}, Map.size=${mapSize}`);
  }
  
  const contentBounds = mainWindow.getContentBounds();
  const screenX = contentBounds.x + paneBounds.x;
  const screenY = contentBounds.y + paneBounds.y;
  
  // 调试：每 500ms 打印一次 resize 信息（更频繁以便调试移动问题）
  const now = Date.now();
  const lastInfo = lastResizeInfo.get(paneId);
  const posChanged = !lastInfo || lastInfo.x !== screenX || lastInfo.y !== screenY;
  
  if (!lastInfo || now - lastInfo.time > 500 || (posChanged && now - lastInfo.time > 100)) {
    log(`[resize] pane=${paneId}, windowId=${info.windowId}, mainWin=(${contentBounds.x},${contentBounds.y}), pane=(${paneBounds.x},${paneBounds.y}), screen=(${screenX},${screenY}), size=${paneBounds.width}x${paneBounds.height}`);
    lastResizeInfo.set(paneId, { x: screenX, y: screenY, w: paneBounds.width, h: paneBounds.height, time: now });
  }
  
  return moveResizeWindowSync(info.windowId, screenX, screenY, paneBounds.width, paneBounds.height);
}

/**
 * 聚焦嵌入窗口
 */
export async function focusEmbeddedWindowLinux(paneId: string): Promise<boolean> {
  const info = embeddedWindows.get(paneId);
  if (!info) return false;
  
  return focusWindow(info.windowId);
}

/**
 * 通过窗口 ID 获取实际的进程 PID（Cursor fork 后的真实进程）
 */
async function getWindowPid(windowId: string): Promise<number | null> {
  try {
    const { stdout } = await execAsync(`xdotool getwindowpid ${windowId}`, { timeout: 2000 });
    const pid = parseInt(stdout.trim());
    return pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * 杀掉 Cursor 进程及其子进程
 * 先 SIGTERM 优雅退出，1.5秒后 SIGKILL 强制杀死
 */
function killProcessTree(pid: number): void {
  log(`[Kill] Killing Cursor process tree: PID ${pid}`);
  
  // 先发 SIGTERM（给 Cursor 保存状态的机会）
  try {
    // pkill -P 杀子进程，kill 杀主进程
    exec(`kill -TERM ${pid} 2>/dev/null; pkill -TERM -P ${pid} 2>/dev/null`);
  } catch { /* 忽略 */ }
  
  // 1.5秒后强制 SIGKILL（确保彻底清理）
  setTimeout(() => {
    try {
      process.kill(pid, 0); // 检查是否还活着
      log(`[Kill] PID ${pid} still alive after SIGTERM, force killing`);
      try { execSync(`pkill -9 -P ${pid} 2>/dev/null || true`, { timeout: 2000 }); } catch {}
      try { execSync(`kill -9 ${pid} 2>/dev/null || true`, { timeout: 2000 }); } catch {}
    } catch {
      // 进程已退出，OK
    }
  }, 1500);
}

/**
 * 关闭嵌入窗口并杀掉 Cursor 进程
 */
export async function closeEmbeddedWindowLinux(paneId: string): Promise<boolean> {
  const info = embeddedWindows.get(paneId);
  if (!info) return false;
  
  log(`[Close] Closing pane=${paneId}, windowId=${info.windowId}`);
  
  // 1. 获取实际的 Cursor 进程 PID（在关窗口之前，否则窗口没了就拿不到了）
  const pid = await getWindowPid(info.windowId);
  
  // 2. 关闭窗口
  const result = await closeWindow(info.windowId);
  
  // 3. 杀掉 Cursor 进程（避免幽灵进程残留，导致重开时窗口混乱）
  if (pid) {
    killProcessTree(pid);
  }
  
  // 4. 清理跟踪状态
  embeddedWindows.delete(paneId);
  knownCursorWindowIds.delete(info.windowId);
  rejectedSmallWindows.delete(info.windowId);
  
  log(`[Close] Done: pane=${paneId}, pid=${pid}, remaining=${embeddedWindows.size}`);
  return result;
}

/**
 * 获取嵌入窗口信息
 */
export function getEmbeddedWindowInfo(paneId: string): LinuxWindowInfo | undefined {
  return embeddedWindows.get(paneId);
}

/**
 * 获取所有嵌入窗口的 pane ID
 */
export function getAllEmbeddedPaneIds(): string[] {
  return Array.from(embeddedWindows.keys());
}

/**
 * 提升所有嵌入窗口到主窗口之上（同步 X11 API，立即生效）
 * 不使用全局 ABOVE（避免遮挡其他程序如 Chrome）
 */
export function raiseAllEmbeddedWindows(): void {
  // 只提升非 reparented 窗口（reparented 窗口已经是主窗口的子窗口，自动在上面）
  const nonReparentedIds = Array.from(embeddedWindows.values())
    .filter(info => !info.reparented)
    .map(info => info.windowId);
  if (nonReparentedIds.length === 0) return;

  // 优先使用同步 X11 API（立即生效，无 spawn 延迟）
  if (x11 && x11Display) {
    for (const id of nonReparentedIds) {
      raiseWindowX11(id);
    }
    x11.XFlush(x11Display);
    return;
  }

  // 兜底：使用 xdotool（异步）
  const args: string[] = [];
  for (const id of nonReparentedIds) {
    args.push('windowraise', id);
  }

  try {
    const child = spawn('xdotool', args, { stdio: 'ignore', detached: true });
    child.unref();
  } catch (e: any) {
    log(`[raiseAll] FAILED: ${e.message}`);
  }
}

/**
 * 最小化所有嵌入窗口（主窗口最小化时调用）
 */
export function minimizeAllWindows(): void {
  // reparented 窗口跟随父窗口自动最小化，只需处理非 reparented 的
  const nonReparentedIds = Array.from(embeddedWindows.values())
    .filter(info => !info.reparented)
    .map(info => info.windowId);
  if (nonReparentedIds.length === 0) return;

  log(`[minimize] Minimizing ${nonReparentedIds.length} non-reparented embedded windows`);
  
  const args: string[] = [];
  for (const id of nonReparentedIds) {
    args.push('windowminimize', id);
  }

  try {
    const child = spawn('xdotool', args, { stdio: 'ignore', detached: true });
    child.unref();
  } catch (e: any) {
    log(`[minimize] FAILED: ${e.message}`);
  }
}

/**
 * 恢复所有嵌入窗口（主窗口从最小化恢复时调用）
 */
export function restoreAllWindows(): void {
  // reparented 窗口跟随父窗口自动恢复，只需处理非 reparented 的
  const nonReparentedIds = Array.from(embeddedWindows.values())
    .filter(info => !info.reparented)
    .map(info => info.windowId);
  if (nonReparentedIds.length === 0) return;

  log(`[restore] Restoring ${nonReparentedIds.length} non-reparented embedded windows`);
  
  const args: string[] = [];
  for (const id of nonReparentedIds) {
    args.push('windowactivate', id);
  }

  try {
    const child = spawn('xdotool', args, { stdio: 'ignore', detached: true });
    child.unref();
  } catch (e: any) {
    log(`[restore] FAILED: ${e.message}`);
  }
}

/**
 * 检查是否支持 Linux 窗口嵌入
 */
export async function isLinuxEmbedSupported(): Promise<boolean> {
  if (process.platform !== 'linux') return false;
  return await checkXdotool();
}

/**
 * 清理所有嵌入窗口（异步版）
 */
export async function cleanupAllWindows(): Promise<void> {
  for (const [paneId, info] of embeddedWindows) {
    try {
      const pid = await getWindowPid(info.windowId);
      await closeWindow(info.windowId);
      if (pid) killProcessTree(pid);
    } catch (e) {
      console.error(`[Linux] Failed to close window for pane ${paneId}:`, e);
    }
  }
  embeddedWindows.clear();
  knownCursorWindowIds.clear();
  rejectedSmallWindows.clear();
}

/**
 * 同步清理所有嵌入窗口（用于主窗口关闭时）
 * ★ 必须全部同步执行：应用即将退出，setTimeout/异步回调不会执行
 */
export function cleanupAllWindowsSync(): void {
  const entries = Array.from(embeddedWindows.entries());
  if (entries.length === 0) return;
  
  log(`[Cleanup] Closing ${entries.length} embedded windows and killing processes...`);
  
  // 1. 先收集所有窗口的 PID（必须在关窗口之前获取，关窗后拿不到 PID）
  const pidsToKill: number[] = [];
  for (const [, info] of entries) {
    try {
      const stdout = execSync(`xdotool getwindowpid ${info.windowId}`, { timeout: 1000 }).toString().trim();
      const pid = parseInt(stdout);
      if (pid > 0) pidsToKill.push(pid);
    } catch {
      // 窗口可能已经不存在
    }
  }
  
  // 2. 关闭所有窗口
  for (const [, info] of entries) {
    try {
      execSync(`xdotool windowclose ${info.windowId}`, { timeout: 1000 });
    } catch {
      // 忽略
    }
  }
  
  // 3. 立即强制杀掉所有 Cursor 进程（SIGKILL，同步执行）
  //    不能用 setTimeout（应用正在退出，回调不会执行）
  //    不能只用 SIGTERM（Cursor 不一定响应）
  for (const pid of pidsToKill) {
    log(`[Cleanup] Force killing Cursor PID: ${pid}`);
    try {
      // 先杀子进程（Cursor 的 renderer/extension host 等）
      execSync(`pkill -9 -P ${pid} 2>/dev/null || true`, { timeout: 2000 });
    } catch { /* 忽略 */ }
    try {
      // 再杀主进程
      execSync(`kill -9 ${pid} 2>/dev/null || true`, { timeout: 2000 });
    } catch { /* 忽略 */ }
  }
  
  log(`[Cleanup] Done: killed ${pidsToKill.length} processes`);
  
  embeddedWindows.clear();
  knownCursorWindowIds.clear();
  rejectedSmallWindows.clear();
}

/**
 * 删除嵌入窗口记录（不关闭窗口）
 */
export function removeEmbeddedWindow(paneId: string): void {
  embeddedWindows.delete(paneId);
}
