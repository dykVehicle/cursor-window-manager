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
} | null = null;
let x11Display: any = null;
let x11RootWindow: bigint | null = null;
let x11Atoms: Map<string, bigint> = new Map();
let x11InitTried = false;

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

/**
 * 查找新创建的 Cursor 主窗口
 * 排除已知窗口和小窗口
 */
export async function findNewCursorWindow(maxAttempts: number = 30, delayMs: number = 500): Promise<string | null> {
  log(`Looking for new Cursor window (excluding ${knownCursorWindowIds.size} known windows)`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { stdout } = await execAsync('xdotool search --name "Cursor"', { timeout: 5000 });
      const windowIds = stdout.trim().split('\n').filter(id => id.length > 0);
      
      // 查找新的、足够大的窗口
      for (const windowId of windowIds) {
        if (knownCursorWindowIds.has(windowId)) continue;
        
        // 检查窗口大小（排除小于 100x100 的辅助窗口）
        const geometry = await getWindowGeometry(windowId);
        if (geometry && geometry.width >= 100 && geometry.height >= 100) {
          const title = await getWindowTitle(windowId);
          log(`Found new Cursor window: ID=${windowId}, title="${title}", size=${geometry.width}x${geometry.height} (attempt ${attempt})`);
          return windowId;
        }
      }
    } catch (e: any) {
      log(`Search failed: ${e.message}`);
    }
    
    if (attempt < maxAttempts) {
      log(`Attempt ${attempt}/${maxAttempts} - waiting...`);
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
 * 尝试多种方法：_MOTIF_WM_HINTS, wmctrl undecorate, _GTK_HIDE_TITLEBAR_WHEN_MAXIMIZED
 * 注意：Cursor/Electron 应用通常使用 CSD (Client-Side Decorations)，服务器端方法可能无效
 */
export async function removeWindowDecorations(windowId: string): Promise<boolean> {
  log(`Removing decorations for window: ${windowId}`);
  
  try {
    // 方法1：使用 xprop 设置 _MOTIF_WM_HINTS (最常用的方法)
    // flags=2 表示只设置 decorations，decorations=0 表示无边框
    try {
      await execAsync(`xprop -id ${windowId} -f _MOTIF_WM_HINTS 32c -set _MOTIF_WM_HINTS "2, 0, 0, 0, 0"`);
      log('Applied _MOTIF_WM_HINTS');
    } catch (e) {
      log('_MOTIF_WM_HINTS failed');
    }
    
    // 方法2：使用 wmctrl 移除装饰（如果可用）
    try {
      // 转换为十六进制格式
      const hexId = '0x' + parseInt(windowId).toString(16);
      await execAsync(`wmctrl -i -r ${hexId} -b add,fullscreen`);
      await new Promise(resolve => setTimeout(resolve, 100));
      await execAsync(`wmctrl -i -r ${hexId} -b remove,fullscreen`);
      log('Applied wmctrl fullscreen toggle trick');
    } catch (e) {
      // wmctrl 可能不可用
    }
    
    // 方法3：对于 GTK 应用，尝试设置隐藏标题栏
    try {
      await execAsync(`xprop -id ${windowId} -f _GTK_HIDE_TITLEBAR_WHEN_MAXIMIZED 32c -set _GTK_HIDE_TITLEBAR_WHEN_MAXIMIZED 1`);
      log('Applied _GTK_HIDE_TITLEBAR_WHEN_MAXIMIZED');
    } catch (e) {
      // 忽略
    }
    
    // 方法4：设置 _NET_WM_STATE 移除边框相关状态
    try {
      await execAsync(`xprop -id ${windowId} -f _NET_WM_STATE 32a -remove _NET_WM_STATE_DECORATED`);
    } catch (e) {
      // 忽略
    }
    
    log(`Decorations removal attempted for window: ${windowId}`);
    return true;
  } catch (e: any) {
    log(`Failed to remove decorations: ${e.message}`);
    return false;
  }
}

/**
 * 移动并调整窗口大小
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
    // 先激活窗口
    log(`Activating window: ${windowId}`);
    await execAsync(`xdotool windowactivate --sync ${windowId}`, { timeout: 3000 });
    
    // 调整大小
    const sizeCmd = `xdotool windowsize --sync ${windowId} ${roundW} ${roundH}`;
    log(`Executing: ${sizeCmd}`);
    await execAsync(sizeCmd, { timeout: 5000 });
    
    // 移动
    const moveCmd = `xdotool windowmove --sync ${windowId} ${roundX} ${roundY}`;
    log(`Executing: ${moveCmd}`);
    await execAsync(moveCmd, { timeout: 5000 });
    
    // 验证窗口位置和大小
    try {
      const { stdout } = await execAsync(`xdotool getwindowgeometry ${windowId}`, { timeout: 2000 });
      log(`Window geometry after move: ${stdout.trim().replace(/\n/g, ', ')}`);
    } catch (e) {
      // 忽略验证错误
    }
    
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
 * 设置窗口置顶（使用多种方法确保生效）
 */
export async function setWindowAbove(windowId: string, above: boolean = true): Promise<boolean> {
  log(`[setWindowAbove] Setting window ${windowId} above=${above}`);
  let success = false;
  
  if (above) {
    // 首选：EWMH ClientMessage（等价于 wmctrl -b add,above），可靠避免被主窗口遮挡
    // 兼容性：部分 WM 更偏好 _NET_WM_STATE_STAYS_ON_TOP
    const ewmhAboveOk = requestNetWmState(windowId, '_NET_WM_STATE_ABOVE', 1);
    const ewmhStayOk = requestNetWmState(windowId, '_NET_WM_STATE_STAYS_ON_TOP', 1);
    if (ewmhAboveOk || ewmhStayOk) {
      log(`[setWindowAbove] Set ABOVE/TOP via EWMH for window ${windowId} (above=${ewmhAboveOk}, top=${ewmhStayOk})`);
      success = true;
    } else {
      log(`[setWindowAbove] EWMH method failed, falling back...`);
    }

    // 兜底：提升窗口（不改变 state，某些 WM 仍可能被覆盖）
    if (!success) {
      try {
        await execAsync(`xdotool windowraise ${windowId}`, { timeout: 1000 });
        log(`[setWindowAbove] Raised window ${windowId} with xdotool`);
        success = true;
      } catch (e) {
        log(`[setWindowAbove] xdotool windowraise failed`);
      }
    }
  } else {
    // 移除 ABOVE 状态（目前项目主要用 above=true，仍提供对称实现）
    const ewmhAboveOk = requestNetWmState(windowId, '_NET_WM_STATE_ABOVE', 0);
    const ewmhStayOk = requestNetWmState(windowId, '_NET_WM_STATE_STAYS_ON_TOP', 0);
    success = ewmhAboveOk || ewmhStayOk;
  }
  
  return success;
}

/**
 * 设置窗口为另一个窗口的 transient（类似子窗口关系）
 * 这可以让窗口管理器更好地处理窗口关系
 */
export async function setWindowTransientFor(childWindowId: string, parentWindowId: string): Promise<boolean> {
  try {
    // 使用 xprop 设置 WM_TRANSIENT_FOR 属性
    await execAsync(`xprop -id ${childWindowId} -f WM_TRANSIENT_FOR 32x -set WM_TRANSIENT_FOR ${parentWindowId}`);
    log(`Set transient_for: child=${childWindowId}, parent=${parentWindowId}`);
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
  
  // 确保窗口不是最大化状态（最大化窗口无法移动/调整大小）
  try {
    await execAsync(`xdotool windowactivate ${windowId}`);
    // 尝试取消最大化
    await execAsync(`xprop -id ${windowId} -f _NET_WM_STATE 32a -remove _NET_WM_STATE_MAXIMIZED_VERT,_NET_WM_STATE_MAXIMIZED_HORZ`);
    log('Removed maximized state');
  } catch (e) {
    log('Could not remove maximized state (may not be maximized)');
  }
  
  // 移除窗口装饰
  await removeWindowDecorations(windowId);
  
  // 等待装饰移除生效
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // 获取主窗口的 X11 ID 并设置 transient_for 关系
  // 这可以让窗口管理器将 Cursor 窗口视为主窗口的"子窗口"
  const mainWindowId = await getMainWindowId(mainWindow);
  if (mainWindowId) {
    await setWindowTransientFor(windowId, mainWindowId);
  }
  
  // 计算屏幕坐标
  const contentBounds = mainWindow.getContentBounds();
  const screenX = contentBounds.x + paneBounds.x;
  const screenY = contentBounds.y + paneBounds.y;
  
  log(`Moving window to: (${screenX}, ${screenY}), size: ${paneBounds.width}x${paneBounds.height}`);
  log(`Main window content bounds: x=${contentBounds.x}, y=${contentBounds.y}, w=${contentBounds.width}, h=${contentBounds.height}`);
  log(`Pane bounds: x=${paneBounds.x}, y=${paneBounds.y}, w=${paneBounds.width}, h=${paneBounds.height}`);
  
  // 移动并调整大小
  const moveResult = await moveResizeWindow(windowId, screenX, screenY, paneBounds.width, paneBounds.height);
  if (!moveResult) {
    return { success: false, error: 'Failed to move/resize window' };
  }
  
  // 将窗口置于主窗口之上
  await setWindowAbove(windowId, true);
  
  // 保存窗口信息 - 这是关键步骤！
  log(`[EMBED] Saving to embeddedWindows: paneId=${paneId}, windowId=${windowId}`);
  embeddedWindows.set(paneId, { windowId, pid });
  
  // 立即验证
  const savedInfo = embeddedWindows.get(paneId);
  log(`[EMBED] Verification: size=${embeddedWindows.size}, savedInfo.windowId=${savedInfo?.windowId}`);
  log(`[EMBED] All keys: ${Array.from(embeddedWindows.keys()).join(',')}`);
  
  if (!savedInfo) {
    log(`[EMBED] ERROR: Failed to save to Map!`);
    return { success: false, error: 'Failed to save window info to Map' };
  }
  
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
 * 关闭嵌入窗口
 */
export async function closeEmbeddedWindowLinux(paneId: string): Promise<boolean> {
  const info = embeddedWindows.get(paneId);
  if (!info) return false;
  
  const result = await closeWindow(info.windowId);
  embeddedWindows.delete(paneId);
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
 * 提升所有嵌入窗口到前面（异步非阻塞）
 */
export function raiseAllEmbeddedWindows(): void {
  const windowIds = Array.from(embeddedWindows.values()).map((info) => info.windowId);
  if (windowIds.length === 0) return;

  // 先请求置顶（ABOVE），避免主窗口获得焦点后遮挡
  for (const id of windowIds) {
    requestNetWmState(id, '_NET_WM_STATE_ABOVE', 1);
    requestNetWmState(id, '_NET_WM_STATE_STAYS_ON_TOP', 1);
  }

  // 单次调用批量 raise，避免 N 次 spawn
  const args: string[] = [];
  for (const id of windowIds) {
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
 * 检查是否支持 Linux 窗口嵌入
 */
export async function isLinuxEmbedSupported(): Promise<boolean> {
  if (process.platform !== 'linux') return false;
  return await checkXdotool();
}

/**
 * 清理所有嵌入窗口
 */
export async function cleanupAllWindows(): Promise<void> {
  for (const [paneId, info] of embeddedWindows) {
    try {
      await closeWindow(info.windowId);
    } catch (e) {
      console.error(`[Linux] Failed to close window for pane ${paneId}:`, e);
    }
  }
  embeddedWindows.clear();
}

/**
 * 同步清理所有嵌入窗口（用于主窗口关闭时）
 */
export function cleanupAllWindowsSync(): void {
  const windowIds = Array.from(embeddedWindows.values()).map((info) => info.windowId);
  if (windowIds.length === 0) return;
  
  console.log(`[Linux] Closing ${windowIds.length} embedded windows...`);
  
  try {
    // 批量关闭所有窗口
    for (const windowId of windowIds) {
      try {
        execSync(`xdotool windowclose ${windowId}`, { timeout: 1000 });
        console.log(`[Linux] Closed window: ${windowId}`);
      } catch (e: any) {
        console.error(`[Linux] Failed to close window ${windowId}:`, e.message);
      }
    }
  } catch (e: any) {
    console.error(`[Linux] Failed to cleanup windows:`, e.message);
  }
  
  embeddedWindows.clear();
}

/**
 * 删除嵌入窗口记录（不关闭窗口）
 */
export function removeEmbeddedWindow(paneId: string): void {
  embeddedWindows.delete(paneId);
}
