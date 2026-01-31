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

// 窗口边界
export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

// 应用配置
export interface AppConfig {
  layout: WindowLayout;
  panes: Record<string, PaneConfig>;
  windowBounds: WindowBounds;
  cursorPath: string;
}

// IPC 消息类型
export interface OpenCursorResult {
  success: boolean;
  pid?: number;
  error?: string;
}
