import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import Store from 'electron-store';
import { spawn, ChildProcess, exec, execSync } from 'child_process';
import { WindowLayout, PaneConfig, AppConfig } from './types';

// ============ 获取程序运行目录 ============
// 获取程序运行的实际目录（而不是用户数据目录）
function getAppDirectory(): string {
  // 打包后：返回可执行文件所在目录
  // 开发时：返回项目根目录
  if (app.isPackaged) {
    // 获取可执行文件所在目录
    return path.dirname(app.getPath('exe'));
  } else {
    // 开发模式下使用项目根目录
    return path.resolve(__dirname, '..', '..');
  }
}

// 确保数据目录存在
function ensureDataDirectory(): string {
  const appDir = getAppDirectory();
  const dataDir = path.join(appDir, 'data');
  
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  } catch (e) {
    console.error('Failed to create data directory:', e);
  }
  
  return dataDir;
}

const DATA_DIR = ensureDataDirectory();
const LOG_FILE = path.join(DATA_DIR, 'cursor-window-manager.log');

// ============ 日志系统 ============
function log(...args: any[]) {
  const timestamp = new Date().toISOString();
  const message = `[${timestamp}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')}`;
  console.log(message);
  
  try {
    fs.appendFileSync(LOG_FILE, message + '\n');
  } catch (e) {
    console.error('Failed to write log:', e);
  }
}

function clearLog() {
  try {
    fs.writeFileSync(LOG_FILE, `=== Cursor Window Manager Log ===\nStarted at: ${new Date().toISOString()}\nLog file: ${LOG_FILE}\nData directory: ${DATA_DIR}\n\n`);
  } catch (e) {
    console.error('Failed to clear log:', e);
  }
}

// 启动时清空日志
clearLog();
log('App starting...');
log('App directory:', getAppDirectory());
log('Data directory:', DATA_DIR);
log('Log file:', LOG_FILE);
log('App path:', app.getAppPath());
log('Platform:', process.platform);
log('Electron version:', process.versions.electron);
// ============ 日志系统结束 ============

// 配置存储 - 存放在程序运行目录下的 data 文件夹中
const store = new Store<AppConfig>({
  name: 'config',
  cwd: DATA_DIR,  // 指定配置文件存放目录
  defaults: {
    layout: {
      direction: 'row',
      first: 'pane-1',
      second: 'pane-2',
      splitPercentage: 50,
    },
    panes: {},
    windowBounds: {
      width: 1400,
      height: 900,
    },
    cursorPath: '',
  },
});

let mainWindow: BrowserWindow | null = null;
const cursorProcesses: Map<string, ChildProcess> = new Map();
// 存储嵌入窗口的句柄和父窗口句柄
interface EmbeddedWindowInfo {
  hwnd: number;
  parentHwnd: number;
}
const embeddedWindows: Map<string, EmbeddedWindowInfo> = new Map();

// 嵌入队列 - 确保嵌入操作顺序执行
interface EmbedTask {
  paneId: string;
  paneBounds: { x: number; y: number; width: number; height: number; dpr?: number };
  parentHwndBuffer: Buffer;
  parentHwndNumber: number;
  targetPid?: number; // 目标进程 PID，用于精确匹配
  resolve: (value: void) => void;
}
const embedQueue: EmbedTask[] = [];
let isEmbedding = false;

// 处理嵌入队列
async function processEmbedQueue() {
  if (isEmbedding || embedQueue.length === 0) return;
  
  isEmbedding = true;
  const task = embedQueue.shift()!;
  
  log(`[EmbedQueue] Processing task for pane: ${task.paneId}, queue remaining: ${embedQueue.length}`);
  
  try {
    const maxAttempts = 15;
    const delayBetweenAttempts = 1000;
    let embedSucceeded = false;
    
    for (let attempt = 1; attempt <= maxAttempts && !embedSucceeded; attempt++) {
      log(`[EmbedQueue] Attempt ${attempt}/${maxAttempts} for pane: ${task.paneId}`);
      
      // 获取已嵌入的窗口列表
      const existingHwnds = Array.from(embeddedWindows.values()).map(info => info.hwnd);
      
      // 计算屏幕坐标：转换为物理像素（Per-Monitor V2 模式）
      let screenBounds = { x: 0, y: 0, width: task.paneBounds.width, height: task.paneBounds.height };
      if (mainWindow) {
        const contentBounds = mainWindow.getContentBounds();
        const display = screen.getDisplayMatching(mainWindow.getBounds());
        const scaleFactor = display.scaleFactor || 1;
        
        // 计算 pane 左上角和右下角的 DIP 坐标
        const dipTopLeft = { 
          x: contentBounds.x + task.paneBounds.x, 
          y: contentBounds.y + task.paneBounds.y 
        };
        let dipBottomRight = { 
          x: contentBounds.x + task.paneBounds.x + task.paneBounds.width, 
          y: contentBounds.y + task.paneBounds.y + task.paneBounds.height 
        };
        
        // 确保 pane 右下角不超出主窗口内容区域，预留边框宽度
        const borderWidth = 3;
        const contentRight = contentBounds.x + contentBounds.width - borderWidth;
        const contentBottom = contentBounds.y + contentBounds.height - borderWidth;
        dipBottomRight = {
          x: Math.min(dipBottomRight.x, contentRight),
          y: Math.min(dipBottomRight.y, contentBottom)
        };
        
        // 使用 dipToScreenPoint 统一转换
        const screenTopLeft = screen.dipToScreenPoint(dipTopLeft);
        const screenBottomRight = screen.dipToScreenPoint(dipBottomRight);
        
        screenBounds = {
          x: screenTopLeft.x,
          y: screenTopLeft.y,
          width: screenBottomRight.x - screenTopLeft.x,
          height: screenBottomRight.y - screenTopLeft.y,
        };
        log(`[EmbedQueue] scaleFactor=${scaleFactor}, dip=(${dipTopLeft.x},${dipTopLeft.y})-(${dipBottomRight.x},${dipBottomRight.y}), screen=(${screenBounds.x},${screenBounds.y},${screenBounds.width}x${screenBounds.height})[physical]`);
      }
      
      const result = await embedWindowWithPowerShell('Cursor', task.parentHwndBuffer, screenBounds, existingHwnds, task.targetPid);
      
      if (result.success && result.hwnd) {
        embedSucceeded = true;
        log(`[EmbedQueue] SUCCESS for pane: ${task.paneId}, hwnd: ${result.hwnd}`);
        embeddedWindows.set(task.paneId, { hwnd: result.hwnd, parentHwnd: task.parentHwndNumber });
        mainWindow?.webContents.send('cursor-embedded', task.paneId, result.hwnd);
      } else {
        log(`[EmbedQueue] Attempt failed: ${result.error?.substring(0, 100)}`);
        if (attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, delayBetweenAttempts));
        } else {
          mainWindow?.webContents.send('cursor-error', task.paneId, 'Timeout: ' + (result.error || 'Window not found'));
        }
      }
    }
  } catch (e: any) {
    log(`[EmbedQueue] Error: ${e.message}`);
    mainWindow?.webContents.send('cursor-error', task.paneId, e.message);
  }
  
  task.resolve();
  isEmbedding = false;
  
  // 处理下一个任务
  processEmbedQueue();
}

// 添加嵌入任务到队列
function queueEmbedTask(task: Omit<EmbedTask, 'resolve'>): Promise<void> {
  return new Promise((resolve) => {
    embedQueue.push({ ...task, resolve });
    log(`[EmbedQueue] Task added for pane: ${task.paneId}, queue length: ${embedQueue.length}`);
    processEmbedQueue();
  });
}

// 获取 PowerShell 脚本路径
function getEmbedScriptPath(): string {
  // 可能的路径列表
  const possiblePaths = [
    path.join(process.resourcesPath || '', 'embedWindow.ps1'),
    path.join(__dirname, 'embedWindow.ps1'),
    path.join(__dirname, '..', 'embedWindow.ps1'),
    path.join(__dirname, '..', '..', 'embedWindow.ps1'),
    path.join(__dirname, '..', '..', 'src', 'main', 'embedWindow.ps1'),
    path.join(app.getAppPath(), 'embedWindow.ps1'),
    path.join(app.getAppPath(), '..', 'embedWindow.ps1'),
  ];
  
  log('Looking for embed script...');
  log('__dirname:', __dirname);
  log('resourcesPath:', process.resourcesPath);
  log('appPath:', app.getAppPath());
  
  for (const p of possiblePaths) {
    const exists = fileExists(p);
    log(`  ${p} => ${exists ? 'FOUND' : 'not found'}`);
    if (exists) {
      log('Using embed script:', p);
      return p;
    }
  }
  
  log('ERROR: Embed script not found!');
  return possiblePaths[0];
}

// 使用 PowerShell 嵌入窗口
async function embedWindowWithPowerShell(
  windowTitle: string,
  parentHwnd: Buffer,
  bounds: { x: number; y: number; width: number; height: number },
  excludeHwnds: number[] = [],
  targetPid?: number
): Promise<{ success: boolean; hwnd?: number; error?: string }> {
  return new Promise((resolve) => {
    log('=== embedWindowWithPowerShell ===');
    log('Window title to find:', windowTitle);
    log('Target PID:', targetPid);
    log('Bounds:', bounds);
    log('Exclude HWNDs:', excludeHwnds);
    
    if (process.platform !== 'win32') {
      log('ERROR: Not on Windows');
      resolve({ success: false, error: 'Only supported on Windows' });
      return;
    }
    
    // 将 Buffer 转换为 HWND 数值
    log('Parent HWND buffer:', parentHwnd.toString('hex'));
    log('Buffer length:', parentHwnd.length);
    
    let hwndNumber: number;
    try {
      if (parentHwnd.length >= 8) {
        hwndNumber = Number(parentHwnd.readBigUInt64LE(0));
      } else {
        hwndNumber = parentHwnd.readUInt32LE(0);
      }
    } catch (e) {
      log('Error reading HWND:', e);
      hwndNumber = parentHwnd.readUInt32LE(0);
    }
    
    log('Parent HWND number:', hwndNumber);
    
    const scriptPath = getEmbedScriptPath();
    log('Embed script path:', scriptPath);
    log('Script exists:', fileExists(scriptPath));
    
    // 构建排除列表参数和 PID 参数
    const excludeParam = excludeHwnds.length > 0 ? ` -ExcludeHwnds "${excludeHwnds.join(',')}"` : '';
    const pidParam = targetPid ? ` -TargetPid ${targetPid}` : '';
    const command = `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -ChildWindowTitle "${windowTitle}" -ParentHwnd ${hwndNumber} -X ${bounds.x} -Y ${bounds.y} -Width ${bounds.width} -Height ${bounds.height}${excludeParam}${pidParam}`;
    
    log('Executing PowerShell command:');
    log(command);
    
    exec(command, { encoding: 'utf8', timeout: 30000 }, (error, stdout, stderr) => {
      log('--- PowerShell Output ---');
      log('STDOUT:', stdout);
      if (stderr) log('STDERR:', stderr);
      
      if (error) {
        log('PowerShell ERROR:', error.message);
        log('Error code:', error.code);
        resolve({ success: false, error: `${error.message}\n${stderr}\n${stdout}` });
        return;
      }
      
      // 解析输出获取子窗口句柄
      const lines = stdout.trim().split('\n');
      const lastLine = lines[lines.length - 1].trim();
      
      log('Last line:', lastLine);
      log('Contains SUCCESS:', stdout.includes('SUCCESS'));
      
      if (stdout.includes('SUCCESS')) {
        const hwnd = parseInt(lastLine, 10);
        log('Parsed child HWND:', hwnd);
        resolve({ success: true, hwnd: isNaN(hwnd) ? 0 : hwnd });
      } else {
        log('Embed failed, output does not contain SUCCESS');
        resolve({ success: false, error: stdout });
      }
    });
  });
}

// Resize 状态管理
let pendingResize: { hwnd: number; bounds: { x: number; y: number; width: number; height: number } } | null = null;
let isResizing = false;
let resizeCount = 0;

// ============ 常驻 PowerShell 进程（快速 resize）============
let psProcess: ReturnType<typeof spawn> | null = null;
let psReady = false;

// 安全写入 PowerShell stdin
function psWrite(cmd: string): boolean {
  if (!psProcess || !psReady || !psProcess.stdin || psProcess.stdin.destroyed) {
    log('[PS] Cannot write - process not ready or stdin destroyed');
    return false;
  }
  try {
    psProcess.stdin.write(cmd);
    return true;
  } catch (e: any) {
    log('[PS] Write error:', e.message);
    return false;
  }
}

function initPowerShellProcess() {
  if (process.platform !== 'win32' || psProcess) return;
  
  log('[PS] Starting persistent PowerShell process...');
  
  // 启动常驻 PowerShell 进程
  psProcess = spawn('powershell', [
    '-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  
  // 处理 stdin 错误
  psProcess.stdin?.on('error', (err) => {
    log('[PS] stdin error:', err.message);
  });
  
  // 发送初始化代码（只加载一次 Add-Type）- 包含所有窗口操作 API
  // 浮动窗口模式需要 GetWindowRect 来获取父窗口位置
  // 添加 ShowWindow 和 SetLayeredWindowAttributes 用于隐藏/透明度控制
  // 添加 PostMessage 用于关闭窗口
  // 添加 ClientToScreen 用于精确获取客户区屏幕坐标（解决窗口不贴合问题）
  // 添加 SetProcessDpiAwarenessContext 设置 Per-Monitor DPI Aware V2 模式
  const initCode = `
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public struct RECT{public int L,T,R,B;}public class WinAPI{[DllImport("user32.dll")]public static extern bool MoveWindow(IntPtr h,int x,int y,int w,int h2,bool r);[DllImport("user32.dll")]public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int w,int h2,uint f);[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out RECT r);[DllImport("user32.dll")]public static extern bool ClientToScreen(IntPtr h,IntPtr pt);[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);[DllImport("user32.dll")]public static extern IntPtr SetFocus(IntPtr h);[DllImport("user32.dll")]public static extern bool EnableWindow(IntPtr h,bool e);[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);[DllImport("user32.dll")]public static extern bool AttachThreadInput(uint a,uint b,bool c);[DllImport("kernel32.dll")]public static extern uint GetCurrentThreadId();[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);[DllImport("user32.dll")]public static extern int GetWindowLong(IntPtr h,int i);[DllImport("user32.dll")]public static extern int SetWindowLong(IntPtr h,int i,int v);[DllImport("user32.dll")]public static extern bool SetLayeredWindowAttributes(IntPtr h,uint k,byte a,uint f);[DllImport("user32.dll")]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);[DllImport("user32.dll")]public static extern bool SetProcessDpiAwarenessContext(IntPtr v);}'
$global:GWL_EXSTYLE=-20
$global:WS_EX_LAYERED=0x80000
$global:LWA_ALPHA=2
$global:WM_CLOSE=0x0010
[WinAPI]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))|Out-Null
Write-Host "PS_READY"
`;
  // 初始化代码必须直接写入（不能用 psWrite，因为 psReady 还是 false）
  try {
    psProcess.stdin?.write(initCode);
  } catch (e: any) {
    log('[PS] Failed to write init code:', e.message);
  }
  
  psProcess.stdout?.on('data', (data: Buffer) => {
    const output = data.toString().trim();
    if (output.includes('PS_READY')) {
      log('[PS] PowerShell ready!');
      psReady = true;
    } else if (output.includes('RESIZE_OK')) {
      log('[PS] Resize completed');
    } else if (output.includes('FOCUS_OK')) {
      log('[PS] Focus completed');
    }
  });
  
  psProcess.stderr?.on('data', (data: Buffer) => {
    log('[PS] Error:', data.toString());
  });
  
  psProcess.on('exit', (code) => {
    log('[PS] Process exited with code:', code);
    psProcess = null;
    psReady = false;
    // 尝试重启
    setTimeout(() => initPowerShellProcess(), 1000);
  });
  
  psProcess.on('error', (err) => {
    log('[PS] Process error:', err.message);
  });
}


// 使用常驻 PowerShell 调整窗口位置
// bounds 包含 CSS 像素坐标（DIP）
// PowerShell 已设置为 Per-Monitor DPI Aware V2，SetWindowPos 需要物理像素坐标
async function resizeEmbeddedWindowWithPowerShell(
  hwnd: number,
  bounds: { x: number; y: number; width: number; height: number; dpr?: number }
): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  
  if (!psProcess) {
    initPowerShellProcess();
  }
  
  if (!psReady || !psProcess) {
    return false;
  }
  
  if (!mainWindow) return false;
  
  // 获取主窗口客户区在屏幕上的位置（DIP）
  const contentBounds = mainWindow.getContentBounds();
  
  // 获取主窗口所在显示器的 scaleFactor（仅用于日志）
  const display = screen.getDisplayMatching(mainWindow.getBounds());
  const scaleFactor = display.scaleFactor || 1;
  
  // 计算 pane 左上角和右下角的 DIP 坐标
  const dipTopLeft = { 
    x: contentBounds.x + bounds.x, 
    y: contentBounds.y + bounds.y 
  };
  let dipBottomRight = { 
    x: contentBounds.x + bounds.x + bounds.width, 
    y: contentBounds.y + bounds.y + bounds.height 
  };
  
  // 获取主窗口内容区域边界，预留边框宽度（主程序绿色边框约 2 DIP）
  const borderWidth = 2;
  const contentRight = contentBounds.x + contentBounds.width - borderWidth;
  const contentBottom = contentBounds.y + contentBounds.height - borderWidth;
  
  // 确保 pane 右下角不超出主窗口内容区域（裁剪到边框内侧）
  dipBottomRight = {
    x: Math.min(dipBottomRight.x, contentRight),
    y: Math.min(dipBottomRight.y, contentBottom)
  };
  
  // 使用 dipToScreenPoint 统一转换，确保边界精确对齐
  const screenTopLeft = screen.dipToScreenPoint(dipTopLeft);
  const screenBottomRight = screen.dipToScreenPoint(dipBottomRight);
  
  // 通过两点相减计算精确的物理像素尺寸
  const width = screenBottomRight.x - screenTopLeft.x;
  const height = screenBottomRight.y - screenTopLeft.y;
  
  resizeCount++;
  log(`[Resize] hwnd=${hwnd}, scaleFactor=${scaleFactor}, dip=(${dipTopLeft.x},${dipTopLeft.y})-(${dipBottomRight.x},${dipBottomRight.y}), screen=(${screenTopLeft.x},${screenTopLeft.y}), size=(${width}x${height})[physical]`);
  
  // 使用物理像素坐标
  const cmd = `[WinAPI]::SetWindowPos([IntPtr]${hwnd},[IntPtr]::Zero,${screenTopLeft.x},${screenTopLeft.y},${width},${height},0x0014)|Out-Null\n`;
  return psWrite(cmd);
}

// 使用常驻 PowerShell 聚焦窗口（用于用户点击特定 pane 时）
function focusWindowWithPowerShell(hwnd: number, _parentHwnd: number) {
  if (!psProcess || !psReady) {
    log(`[Focus] PS not ready for hwnd=${hwnd}, will retry in 100ms`);
    setTimeout(() => focusWindowWithPowerShell(hwnd, _parentHwnd), 100);
    return;
  }
  
  // 浮动窗口模式下，直接设置焦点即可（不是 WS_CHILD）
  const cmd = `[WinAPI]::EnableWindow([IntPtr]${hwnd},$true)|Out-Null;[WinAPI]::SetForegroundWindow([IntPtr]${hwnd})|Out-Null;[WinAPI]::SetFocus([IntPtr]${hwnd})|Out-Null;Write-Host "FOCUS_OK"\n`;
  if (psWrite(cmd)) {
    log(`[Focus] Sent focus command for hwnd=${hwnd}`);
  }
}

// 检查文件是否存在
function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

// 获取Cursor可执行文件路径
function getCursorPath(): string {
  const savedPath = store.get('cursorPath');
  if (savedPath && fileExists(savedPath)) return savedPath;

  // 根据平台返回默认路径
  if (process.platform === 'win32') {
    // Windows上可能的Cursor位置
    const possiblePaths = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'cursor', 'Cursor.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'cursor', 'Cursor.exe'),
      path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Programs', 'cursor', 'Cursor.exe'),
      // Program Files 路径
      'C:\\Program Files\\cursor\\Cursor.exe',
      'C:\\Program Files (x86)\\cursor\\Cursor.exe',
      'D:\\Program Files\\cursor\\Cursor.exe',
      'D:\\Program Files (x86)\\cursor\\Cursor.exe',
      // 其他可能路径
      'C:\\Program Files\\Cursor\\Cursor.exe',
      'D:\\Program Files\\Cursor\\Cursor.exe',
    ];
    
    for (const p of possiblePaths) {
      if (fileExists(p)) {
        console.log('Found Cursor at:', p);
        return p;
      }
    }
    // 返回第一个路径作为默认
    return possiblePaths[0];
  } else if (process.platform === 'linux') {
    // Linux上可能的Cursor位置
    const possiblePaths = [
      '/usr/bin/cursor',
      '/usr/local/bin/cursor',
      path.join(process.env.HOME || '', '.local', 'bin', 'cursor'),
      path.join(process.env.HOME || '', 'Applications', 'cursor.AppImage'),
      '/opt/Cursor/cursor',
      '/snap/bin/cursor',
    ];
    
    for (const p of possiblePaths) {
      if (fileExists(p)) {
        console.log('Found Cursor at:', p);
        return p;
      }
    }
    return possiblePaths[0];
  }
  return 'cursor';
}

function createWindow(): void {
  const bounds = store.get('windowBounds');
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: bounds.width || 1400,
    height: bounds.height || 900,
    x: bounds.x ?? Math.floor((screenWidth - (bounds.width || 1400)) / 2),
    y: bounds.y ?? Math.floor((screenHeight - (bounds.height || 900)) / 2),
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      devTools: true,
    },
  });

  // 调试时打开开发者工具（生产环境注释掉）
  // mainWindow.webContents.openDevTools();

  // 监听渲染器错误
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log('[Renderer] Process gone:', details.reason);
  });
  
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    log('[Renderer] Failed to load:', errorCode, errorDescription);
  });

  // 开发模式加载Vite开发服务器，生产模式加载打包后的文件
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
  
  // 调试：打开开发者工具（调试完成后注释掉）
  // mainWindow.webContents.openDevTools();

  // 标记是否正在关闭中
  let isClosing = false;
  
  // 保存窗口位置和大小，并在关闭前关闭所有 Cursor 窗口
  mainWindow.on('close', (event) => {
    if (!mainWindow) return;
    
    // 如果已经在关闭流程中，直接继续
    if (isClosing) return;
    
    // 阻止立即关闭，先保存状态
    event.preventDefault();
    isClosing = true;
    stateSavedReceived = false; // 重置状态保存标志
    
    const bounds = mainWindow.getBounds();
    store.set('windowBounds', bounds);
    
    // 通知渲染器保存当前 pane 状态（包括运行中的 Cursor 项目）
    // 这样下次启动时可以自动恢复
    mainWindow.webContents.send('save-state-before-close');
    
    // 关闭所有嵌入的 Cursor 窗口（发送 WM_CLOSE 消息）
    if (process.platform === 'win32' && psProcess && psReady && embeddedWindows.size > 0) {
      log('[Cleanup] Closing all embedded Cursor windows before exit...');
      
      for (const [paneId, info] of embeddedWindows) {
        log(`[Cleanup] Sending WM_CLOSE to: paneId=${paneId}, hwnd=${info.hwnd}`);
        // 使用 PostMessage 发送 WM_CLOSE（异步，不等待响应）
        psWrite(`[WinAPI]::PostMessage([IntPtr]${info.hwnd},$global:WM_CLOSE,[IntPtr]::Zero,[IntPtr]::Zero)|Out-Null\n`);
      }
    }
    
    embeddedWindows.clear();
    
    // 等待渲染进程保存状态完成（通过 state-saved IPC），最多等待 2 秒
    // 如果超时，强制关闭
    setTimeout(() => {
      if (mainWindow && !stateSavedReceived) {
        log('[Cleanup] Timeout waiting for state-saved, force closing');
        mainWindow.destroy();
      }
    }, 2000);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    
    // 关闭所有Cursor进程
    cursorProcesses.forEach((proc) => {
      proc.kill();
    });
    cursorProcesses.clear();
    
    // 延迟关闭 PowerShell 进程，确保所有命令都已执行
    setTimeout(() => {
      if (psProcess) {
        log('[Cleanup] Killing PowerShell process');
        psProcess.kill();
        psProcess = null;
      }
    }, 1000);
  });
  
  // 主窗口移动时通知渲染进程更新 Cursor 窗口位置
  mainWindow.on('move', () => {
    mainWindow?.webContents.send('window-moved');
  });
  
  // 主窗口获得焦点时的处理
  // 浮动窗口模式下，只需要通知渲染进程，不需要做特殊处理
  mainWindow.on('focus', () => {
    log('[MainWindow] Focus received');
    mainWindow?.webContents.send('window-focused');
  });
  
  // 窗口最大化/还原时通知渲染进程
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window-maximized-change', true);
  });
  
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window-maximized-change', false);
  });
}

// IPC处理器

// 获取保存的布局
ipcMain.handle('get-layout', () => {
  return store.get('layout');
});

// 保存布局
ipcMain.handle('save-layout', (_event, layout: WindowLayout) => {
  store.set('layout', layout);
  return true;
});

// 获取窗格配置
ipcMain.handle('get-panes', () => {
  return store.get('panes');
});

// 保存窗格配置
ipcMain.handle('save-panes', (_event, panes: Record<string, PaneConfig>) => {
  store.set('panes', panes);
  return true;
});

// 获取Cursor路径
ipcMain.handle('get-cursor-path', () => {
  return getCursorPath();
});

// 设置Cursor路径
ipcMain.handle('set-cursor-path', (_event, cursorPath: string) => {
  store.set('cursorPath', cursorPath);
  return true;
});

// 自动检测Cursor路径
ipcMain.handle('detect-cursor-path', () => {
  const detectedPath = getCursorPath();
  const exists = fileExists(detectedPath);
  return { path: detectedPath, exists };
});

// 验证Cursor路径是否有效
ipcMain.handle('validate-cursor-path', (_event, cursorPath: string) => {
  return fileExists(cursorPath);
});

// 选择Cursor可执行文件
ipcMain.handle('select-cursor-file', async () => {
  const { dialog } = require('electron');
  const filters = process.platform === 'win32' 
    ? [{ name: 'Executable', extensions: ['exe'] }]
    : [{ name: 'All Files', extensions: ['*'] }];
    
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters,
    title: 'Select Cursor Executable',
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// 打开Cursor实例并嵌入到窗格中
ipcMain.handle('open-cursor', async (_event, paneId: string, folderPath?: string, paneBounds?: { x: number; y: number; width: number; height: number; dpr?: number }) => {
  const cursorPath = getCursorPath();
  
  log('');
  log('========================================');
  log('=== Opening Cursor ===');
  log('========================================');
  log('Pane ID:', paneId);
  log('Cursor path:', cursorPath);
  log('Cursor exists:', fileExists(cursorPath));
  log('Folder path:', folderPath);
  log('Pane bounds:', paneBounds);
  log('Platform:', process.platform);
  
  // 检查Cursor是否存在
  if (!fileExists(cursorPath)) {
    const errorMsg = `Cursor not found at: ${cursorPath}. Please set the correct path in Settings.`;
    log('ERROR:', errorMsg);
    mainWindow?.webContents.send('cursor-error', paneId, errorMsg);
    return { success: false, error: errorMsg };
  }
  
  try {
    if (process.platform === 'win32') {
      // Windows: 使用 spawn 启动 Cursor 以获取真实 PID
      const args: string[] = ['--new-window'];
      if (folderPath) {
        args.push(folderPath);
      }
      
      log('Spawning Cursor with args:', args);
      
      const cursorProcess = spawn(cursorPath, args, {
        detached: true, // 让 Cursor 作为独立进程运行
        stdio: 'ignore',
        windowsHide: false,
      });
      
      const cursorPid = cursorProcess.pid;
      log('Cursor spawned with PID:', cursorPid);
      
      // 解除子进程与父进程的关联，让它可以独立运行
      cursorProcess.unref();
      
      if (cursorPid) {
        // 保存进程引用和 PID
        cursorProcesses.set(paneId, cursorProcess);
        
        // 等待 Cursor 窗口出现并嵌入（使用队列确保顺序执行）
        if (paneBounds && mainWindow) {
          // 获取主窗口句柄
          const parentHwndBuffer = mainWindow.getNativeWindowHandle();
          log('Parent window handle buffer:', parentHwndBuffer.toString('hex'));
          
          // 转换为数值（用于存储和后续操作）
          let parentHwndNumber: number;
          if (parentHwndBuffer.length >= 8) {
            parentHwndNumber = Number(parentHwndBuffer.readBigUInt64LE(0));
          } else {
            parentHwndNumber = parentHwndBuffer.readUInt32LE(0);
          }
          
          // 延迟后加入队列，让 Cursor 有时间启动
          setTimeout(() => {
            queueEmbedTask({
              paneId,
              paneBounds,
              parentHwndBuffer,
              parentHwndNumber,
              targetPid: cursorPid, // 传递 PID 用于精确匹配
            });
          }, 2000);
        } else {
          log('No paneBounds or mainWindow, skipping embed');
        }
      }
      
      return { success: true, pid: cursorPid || 0 };
      
    } else {
      // Linux/macOS: 使用 spawn（暂不支持嵌入）
      const args: string[] = ['--new-window'];
      if (folderPath) {
        args.push(folderPath);
      }
      
      console.log('Spawn args:', args);
      
      const proc = spawn(cursorPath, args, {
        detached: true,
        stdio: 'ignore',
      });
      
      proc.unref();
      cursorProcesses.set(paneId, proc);
      
      console.log('Cursor started with PID:', proc.pid);

      proc.on('exit', (code) => {
        console.log(`Cursor process ${paneId} exited with code:`, code);
        cursorProcesses.delete(paneId);
        mainWindow?.webContents.send('cursor-closed', paneId);
      });

      proc.on('error', (err) => {
        console.error(`Failed to start Cursor: ${err.message}`);
        cursorProcesses.delete(paneId);
        mainWindow?.webContents.send('cursor-error', paneId, err.message);
      });

      return { success: true, pid: proc.pid };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error starting Cursor:', message);
    return { success: false, error: message };
  }
});

// 调整嵌入窗口大小
ipcMain.handle('resize-embedded-window', async (_event, paneId: string, bounds: { x: number; y: number; width: number; height: number; dpr?: number }) => {
  const info = embeddedWindows.get(paneId);
  log(`[IPC resize-embedded-window] paneId=${paneId}, hwnd=${info?.hwnd}, dpr=${bounds.dpr}, bounds=`, bounds);
  if (info) {
    return await resizeEmbeddedWindowWithPowerShell(info.hwnd, bounds);
  }
  log(`[IPC resize-embedded-window] No hwnd found for paneId=${paneId}`);
  return false;
});

// 设置焦点到嵌入的窗口
ipcMain.handle('focus-embedded-window', async (_event, paneId: string) => {
  const info = embeddedWindows.get(paneId);
  log(`[IPC focus-embedded-window] paneId=${paneId}, hwnd=${info?.hwnd}`);
  if (info && process.platform === 'win32') {
    // 使用持久化 PowerShell 设置焦点（包含 AttachThreadInput）
    focusWindowWithPowerShell(info.hwnd, info.parentHwnd);
    return true;
  }
  return false;
});

// 检查是否支持窗口嵌入
ipcMain.handle('is-embed-supported', () => {
  return process.platform === 'win32';
});

// 获取日志文件路径
ipcMain.handle('get-log-path', () => {
  log('Log path requested');
  return LOG_FILE;
});

// 获取数据目录路径
ipcMain.handle('get-data-path', () => {
  return DATA_DIR;
});

// 打开日志文件所在目录
ipcMain.handle('open-log-folder', () => {
  log('Opening log folder:', DATA_DIR);
  shell.showItemInFolder(LOG_FILE);
  return true;
});

// 关闭Cursor实例
ipcMain.handle('close-cursor', (_event, paneId: string) => {
  log(`[close-cursor] Closing cursor for pane: ${paneId}`);
  
  // 关闭嵌入的窗口
  const embedInfo = embeddedWindows.get(paneId);
  if (embedInfo && process.platform === 'win32' && psProcess && psReady) {
    log(`[close-cursor] Sending WM_CLOSE to hwnd: ${embedInfo.hwnd}`);
    psWrite(`[WinAPI]::PostMessage([IntPtr]${embedInfo.hwnd},$global:WM_CLOSE,[IntPtr]::Zero,[IntPtr]::Zero)|Out-Null\n`);
    embeddedWindows.delete(paneId);
  }
  
  // 关闭进程
  const proc = cursorProcesses.get(paneId);
  if (proc) {
    proc.kill();
    cursorProcesses.delete(paneId);
    return true;
  }
  return embedInfo !== undefined;
});

// 选择文件夹
ipcMain.handle('select-folder', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// 打开外部链接
ipcMain.handle('open-external', (_event, url: string) => {
  shell.openExternal(url);
});

// 获取所有配置
ipcMain.handle('get-config', () => {
  return store.store;
});

// 重置配置
ipcMain.handle('reset-config', () => {
  store.clear();
  return true;
});

// ===== 布局收藏功能 =====

interface SavedLayout {
  id: string;
  name: string;
  layout: WindowLayout;
  panes: Record<string, PaneConfig>;
  createdAt: number;
}

// 获取所有收藏的布局
ipcMain.handle('get-saved-layouts', () => {
  return store.get('savedLayouts', []) as SavedLayout[];
});

// 保存当前布局
ipcMain.handle('save-layout-as', (_event, name: string, layout: WindowLayout, panes: Record<string, PaneConfig>) => {
  const savedLayouts = store.get('savedLayouts', []) as SavedLayout[];
  
  // 清理 panes 中的运行时状态
  const cleanPanes: Record<string, PaneConfig> = {};
  for (const [id, pane] of Object.entries(panes)) {
    cleanPanes[id] = {
      id: pane.id,
      folderPath: pane.folderPath,
      label: pane.label,
    };
  }
  
  const newLayout: SavedLayout = {
    id: `layout-${Date.now()}`,
    name,
    layout,
    panes: cleanPanes,
    createdAt: Date.now(),
  };
  
  savedLayouts.push(newLayout);
  store.set('savedLayouts', savedLayouts);
  return newLayout;
});

// 删除收藏的布局
ipcMain.handle('delete-saved-layout', (_event, id: string) => {
  const savedLayouts = store.get('savedLayouts', []) as SavedLayout[];
  const filtered = savedLayouts.filter(l => l.id !== id);
  store.set('savedLayouts', filtered);
  return true;
});

// 重命名收藏的布局
ipcMain.handle('rename-saved-layout', (_event, id: string, name: string) => {
  const savedLayouts = store.get('savedLayouts', []) as SavedLayout[];
  const layout = savedLayouts.find(l => l.id === id);
  if (layout) {
    layout.name = name;
    store.set('savedLayouts', savedLayouts);
    return true;
  }
  return false;
});

// 窗口控制（用于自定义标题栏）
ipcMain.handle('window-minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('window-close', () => {
  mainWindow?.close();
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow?.isMaximized() ?? false;
});

// 标记状态是否已保存
let stateSavedReceived = false;

// 渲染进程通知主进程状态已保存，可以关闭
ipcMain.handle('state-saved', () => {
  log('[state-saved] State saved confirmed, proceeding with close');
  stateSavedReceived = true;
  // 立即关闭窗口
  if (mainWindow) {
    mainWindow.destroy();
  }
  return true;
});

// 隐藏/显示嵌入窗口（用于显示弹出菜单时避免遮挡）
// SW_HIDE = 0, SW_SHOW = 5
ipcMain.handle('hide-all-embedded-windows', async () => {
  if (process.platform !== 'win32' || !psProcess || !psReady) return;
  
  log('[hide-all] Hiding all embedded windows');
  for (const [paneId, info] of embeddedWindows) {
    // 使用 ShowWindow 隐藏窗口（SW_HIDE = 0）
    const cmd = `[WinAPI]::ShowWindow([IntPtr]${info.hwnd},0)|Out-Null\n`;
    psWrite(cmd);
    log(`[hide-all] Hidden pane=${paneId}, hwnd=${info.hwnd}`);
  }
});

ipcMain.handle('show-all-embedded-windows', async () => {
  if (process.platform !== 'win32' || !psProcess || !psReady) return;
  
  log('[show-all] Showing all embedded windows');
  for (const [paneId, info] of embeddedWindows) {
    // 使用 ShowWindow 显示窗口（SW_SHOWNOACTIVATE = 4，避免抢焦点）
    const cmd = `[WinAPI]::ShowWindow([IntPtr]${info.hwnd},4)|Out-Null\n`;
    psWrite(cmd);
    log(`[show-all] Shown pane=${paneId}, hwnd=${info.hwnd}`);
  }
});

// 只显示特定 pane 的嵌入窗口
ipcMain.handle('show-embedded-window', async (_event, paneId: string) => {
  if (process.platform !== 'win32' || !psProcess || !psReady) return;
  
  const info = embeddedWindows.get(paneId);
  if (info) {
    log(`[show-single] Showing embedded window for pane=${paneId}, hwnd=${info.hwnd}`);
    const cmd = `[WinAPI]::ShowWindow([IntPtr]${info.hwnd},4)|Out-Null\n`;
    psWrite(cmd);
  }
});

app.whenReady().then(() => {
  createWindow();
  
  // 提前初始化 PowerShell 进程（用于快速 resize）
  if (process.platform === 'win32') {
    initPowerShellProcess();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
