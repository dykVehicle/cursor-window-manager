import { contextBridge, ipcRenderer } from 'electron';

// 暴露给渲染进程的API
contextBridge.exposeInMainWorld('electronAPI', {
  // 布局相关
  getLayout: () => ipcRenderer.invoke('get-layout'),
  saveLayout: (layout: unknown) => ipcRenderer.invoke('save-layout', layout),
  
  // Sub Cursor 相关
  getSubCursors: () => ipcRenderer.invoke('get-sub-cursors'),
  saveSubCursors: (subCursors: unknown) => ipcRenderer.invoke('save-sub-cursors', subCursors),
  
  // Cursor相关
  getCursorPath: () => ipcRenderer.invoke('get-cursor-path'),
  setCursorPath: (path: string) => ipcRenderer.invoke('set-cursor-path', path),
  detectCursorPath: () => ipcRenderer.invoke('detect-cursor-path'),
  validateCursorPath: (path: string) => ipcRenderer.invoke('validate-cursor-path', path),
  selectCursorFile: () => ipcRenderer.invoke('select-cursor-file'),
  openCursor: (subCursorId: string, folderPath?: string, subCursorBounds?: { x: number; y: number; width: number; height: number; dpr?: number }) => 
    ipcRenderer.invoke('open-cursor', subCursorId, folderPath, subCursorBounds),
  resizeEmbeddedWindow: (subCursorId: string, bounds: { x: number; y: number; width: number; height: number; dpr?: number }) =>
    ipcRenderer.invoke('resize-embedded-window', subCursorId, bounds),
  focusEmbeddedWindow: (subCursorId: string) =>
    ipcRenderer.invoke('focus-embedded-window', subCursorId),
  isEmbedSupported: () => ipcRenderer.invoke('is-embed-supported'),
  onCursorEmbedded: (callback: (subCursorId: string, hwnd: number) => void) => {
    ipcRenderer.on('cursor-embedded', (_event, subCursorId, hwnd) => callback(subCursorId, hwnd));
  },
  closeCursor: (subCursorId: string) => ipcRenderer.invoke('close-cursor', subCursorId),
  
  // 文件夹选择
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  
  // 配置相关
  getConfig: () => ipcRenderer.invoke('get-config'),
  resetConfig: () => ipcRenderer.invoke('reset-config'),
  
  // 外部链接
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  
  // 监听事件
  onCursorClosed: (callback: (subCursorId: string) => void) => {
    ipcRenderer.on('cursor-closed', (_event, subCursorId) => callback(subCursorId));
  },
  onCursorError: (callback: (subCursorId: string, error: string) => void) => {
    ipcRenderer.on('cursor-error', (_event, subCursorId, error) => callback(subCursorId, error));
  },
  onWindowMoved: (callback: () => void) => {
    ipcRenderer.on('window-moved', () => callback());
  },
  onWindowFocused: (callback: () => void) => {
    ipcRenderer.on('window-focused', () => callback());
  },
  
  // 移除监听器
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
  
  // 日志相关
  getLogPath: () => ipcRenderer.invoke('get-log-path'),
  openLogFolder: () => ipcRenderer.invoke('open-log-folder'),
  
  // 布局收藏
  getSavedLayouts: () => ipcRenderer.invoke('get-saved-layouts'),
  saveLayoutAs: (name: string, layout: unknown, subCursors: unknown) => ipcRenderer.invoke('save-layout-as', name, layout, subCursors),
  deleteSavedLayout: (id: string) => ipcRenderer.invoke('delete-saved-layout', id),
  renameSavedLayout: (id: string, name: string) => ipcRenderer.invoke('rename-saved-layout', id, name),
  
  // 窗口控制（自定义标题栏）
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onWindowMaximizedChange: (callback: (isMaximized: boolean) => void) => {
    ipcRenderer.on('window-maximized-change', (_event, isMaximized) => callback(isMaximized));
  },
  
  // 隐藏/显示嵌入窗口（用于弹出菜单）
  hideAllEmbeddedWindows: () => ipcRenderer.invoke('hide-all-embedded-windows'),
  showAllEmbeddedWindows: () => ipcRenderer.invoke('show-all-embedded-windows'),
  showEmbeddedWindow: (subCursorId: string) => ipcRenderer.invoke('show-embedded-window', subCursorId),
  
  // 关闭前保存状态
  onSaveStateBeforeClose: (callback: () => void) => {
    ipcRenderer.on('save-state-before-close', () => callback());
  },
  
  // 通知主进程状态已保存
  stateSaved: () => ipcRenderer.invoke('state-saved'),
  
  // 鼠标穿透控制（Linux：让 sub-cursor 区域的点击直接到达子窗口）
  setIgnoreMouseEvents: (ignore: boolean) => ipcRenderer.invoke('set-ignore-mouse-events', ignore),
});
