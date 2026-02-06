// 窗口布局类型 - 支持递归嵌套的分割布局
export type WindowLayout = string | {
  direction: 'row' | 'column';
  first: WindowLayout;
  second: WindowLayout;
  splitPercentage?: number;
};

// 单个窗格的配置
export interface PaneConfig {
  id: string;
  folderPath?: string;
  label?: string;
  cursorPid?: number;
  isRunning?: boolean;
}

// 收藏的布局
export interface SavedLayout {
  id: string;
  name: string;
  layout: WindowLayout;
  panes: Record<string, PaneConfig>;
  createdAt: number;
}

// 打开Cursor的结果
export interface OpenCursorResult {
  success: boolean;
  pid?: number;
  error?: string;
}

// Cursor路径检测结果
export interface DetectCursorResult {
  path: string;
  exists: boolean;
}

// Electron API 类型定义
export interface ElectronAPI {
  getLayout: () => Promise<WindowLayout>;
  saveLayout: (layout: WindowLayout) => Promise<boolean>;
  getPanes: () => Promise<Record<string, PaneConfig>>;
  savePanes: (panes: Record<string, PaneConfig>) => Promise<boolean>;
  getCursorPath: () => Promise<string>;
  setCursorPath: (path: string) => Promise<boolean>;
  detectCursorPath: () => Promise<DetectCursorResult>;
  validateCursorPath: (path: string) => Promise<boolean>;
  selectCursorFile: () => Promise<string | null>;
  openCursor: (paneId: string, folderPath?: string, paneBounds?: { x: number; y: number; width: number; height: number }) => Promise<OpenCursorResult>;
  resizeEmbeddedWindow: (paneId: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<boolean>;
  focusEmbeddedWindow: (paneId: string) => Promise<boolean>;
  isEmbedSupported: () => Promise<boolean>;
  onCursorEmbedded: (callback: (paneId: string, hwnd: number) => void) => void;
  closeCursor: (paneId: string) => Promise<boolean>;
  selectFolder: () => Promise<string | null>;
  getConfig: () => Promise<unknown>;
  resetConfig: () => Promise<boolean>;
  openExternal: (url: string) => Promise<void>;
  onCursorClosed: (callback: (paneId: string) => void) => void;
  onCursorError: (callback: (paneId: string, error: string) => void) => void;
  onWindowMoved: (callback: () => void) => void;
  onWindowFocused: (callback: () => void) => void;
  removeAllListeners: (channel: string) => void;
  getLogPath: () => Promise<string>;
  openLogFolder: () => Promise<boolean>;
  // 布局收藏功能
  getSavedLayouts: () => Promise<SavedLayout[]>;
  saveLayoutAs: (name: string, layout: WindowLayout, panes: Record<string, PaneConfig>) => Promise<SavedLayout>;
  deleteSavedLayout: (id: string) => Promise<boolean>;
  renameSavedLayout: (id: string, name: string) => Promise<boolean>;
  // 窗口控制
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;
  onWindowMaximizedChange: (callback: (isMaximized: boolean) => void) => void;
  // 隐藏/显示嵌入窗口
  hideAllEmbeddedWindows: () => Promise<void>;
  showAllEmbeddedWindows: () => Promise<void>;
  showEmbeddedWindow: (paneId: string) => Promise<void>;
  // 关闭前保存状态
  onSaveStateBeforeClose: (callback: () => void) => void;
  // 通知主进程状态已保存
  stateSaved: () => Promise<boolean>;
  // 鼠标穿透控制
  setIgnoreMouseEvents: (ignore: boolean) => Promise<void>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
