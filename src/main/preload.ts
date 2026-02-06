import { contextBridge, ipcRenderer } from 'electron';

// 暴露给渲染进程的API
contextBridge.exposeInMainWorld('electronAPI', {
  // 布局相关
  getLayout: () => ipcRenderer.invoke('get-layout'),
  saveLayout: (layout: unknown) => ipcRenderer.invoke('save-layout', layout),
  
  // 窗格相关
  getPanes: () => ipcRenderer.invoke('get-panes'),
  savePanes: (panes: unknown) => ipcRenderer.invoke('save-panes', panes),
  
  // Cursor相关
  getCursorPath: () => ipcRenderer.invoke('get-cursor-path'),
  setCursorPath: (path: string) => ipcRenderer.invoke('set-cursor-path', path),
  detectCursorPath: () => ipcRenderer.invoke('detect-cursor-path'),
  validateCursorPath: (path: string) => ipcRenderer.invoke('validate-cursor-path', path),
  selectCursorFile: () => ipcRenderer.invoke('select-cursor-file'),
  openCursor: (paneId: string, folderPath?: string, paneBounds?: { x: number; y: number; width: number; height: number; dpr?: number }) => 
    ipcRenderer.invoke('open-cursor', paneId, folderPath, paneBounds),
  resizeEmbeddedWindow: (paneId: string, bounds: { x: number; y: number; width: number; height: number; dpr?: number }) =>
    ipcRenderer.invoke('resize-embedded-window', paneId, bounds),
  focusEmbeddedWindow: (paneId: string) =>
    ipcRenderer.invoke('focus-embedded-window', paneId),
  isEmbedSupported: () => ipcRenderer.invoke('is-embed-supported'),
  onCursorEmbedded: (callback: (paneId: string, hwnd: number) => void) => {
    ipcRenderer.on('cursor-embedded', (_event, paneId, hwnd) => callback(paneId, hwnd));
  },
  closeCursor: (paneId: string) => ipcRenderer.invoke('close-cursor', paneId),
  
  // 文件夹选择
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  
  // 配置相关
  getConfig: () => ipcRenderer.invoke('get-config'),
  resetConfig: () => ipcRenderer.invoke('reset-config'),
  
  // 外部链接
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  
  // 监听事件
  onCursorClosed: (callback: (paneId: string) => void) => {
    ipcRenderer.on('cursor-closed', (_event, paneId) => callback(paneId));
  },
  onCursorError: (callback: (paneId: string, error: string) => void) => {
    ipcRenderer.on('cursor-error', (_event, paneId, error) => callback(paneId, error));
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
  saveLayoutAs: (name: string, layout: unknown, panes: unknown) => ipcRenderer.invoke('save-layout-as', name, layout, panes),
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
  showEmbeddedWindow: (paneId: string) => ipcRenderer.invoke('show-embedded-window', paneId),
  
  // 关闭前保存状态
  onSaveStateBeforeClose: (callback: () => void) => {
    ipcRenderer.on('save-state-before-close', () => callback());
  },
  
  // 通知主进程状态已保存
  stateSaved: () => ipcRenderer.invoke('state-saved'),
  
  // 鼠标穿透控制（Linux：让 pane 区域的点击直接到达子窗口）
  setIgnoreMouseEvents: (ignore: boolean) => ipcRenderer.invoke('set-ignore-mouse-events', ignore),
});
