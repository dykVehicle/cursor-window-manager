import React, { useState, useRef, useEffect, useCallback } from 'react';
import { SubCursorConfig } from '../types';

// 调试开关 - 生产环境关闭
const DEBUG = false;
const log = DEBUG ? console.log.bind(console) : () => {};

interface SubCursorProps {
  subCursorId: string;
  config: SubCursorConfig;
  onOpenCursor: (bounds: { x: number; y: number; width: number; height: number }) => void;
  onCloseCursor: () => void;
  onSelectFolder: () => void;
  onClearFolder: () => void;
  onRemove: () => void;
  onUpdateLabel: (label: string) => void;
  onSplit?: (direction: 'up' | 'down' | 'left' | 'right') => void;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
}

function SubCursor({
  subCursorId,
  config,
  onOpenCursor,
  onCloseCursor,
  onSelectFolder,
  onClearFolder,
  onRemove,
  onUpdateLabel,
  onSplit,
  isMaximized = false,
  onToggleMaximize,
}: SubCursorProps) {
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelInput, setLabelInput] = useState(config.label || '');
  const [isEmbedded, setIsEmbedded] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const subCursorRef = useRef<HTMLDivElement>(null); // 整个 sub-cursor 的 ref
  const contentRef = useRef<HTMLDivElement>(null);
  
  // 获取内容区域的坐标（相对于父窗口客户区）
  // 使用 Owner 模式浮动窗口，坐标是相对于父窗口的
  // 返回 CSS 像素，主进程会处理 DPI 缩放转换
  const getSubCursorBounds = useCallback(() => {
    if (contentRef.current) {
      // 直接使用 content 区域的位置
      const contentRect = contentRef.current.getBoundingClientRect();
      // 同时传递 devicePixelRatio 给主进程统一处理
      const dpr = window.devicePixelRatio || 1;
      log('[getSubCursorBounds] DPI scale factor:', dpr);
      log('[getSubCursorBounds] CSS pixels:', contentRect.left, contentRect.top, contentRect.width, contentRect.height);
      
      return {
        x: Math.round(contentRect.left),
        y: Math.round(contentRect.top),
        width: Math.round(contentRect.width),
        height: Math.round(contentRect.height),
        dpr: dpr, // 传递缩放因子
      };
    }
    return { x: 0, y: 0, width: 800, height: 600, dpr: 1 };
  }, []);
  
  // 处理打开Cursor
  const handleOpenCursor = useCallback(() => {
    const bounds = getSubCursorBounds();
    log('Opening Cursor with bounds:', bounds);
    onOpenCursor(bounds);
  }, [getSubCursorBounds, onOpenCursor]);
  
  // 监听嵌入成功事件
  useEffect(() => {
    const handleEmbedded = (embeddedSubCursorId: string) => {
      log('[SubCursor] Received cursor-embedded event:', embeddedSubCursorId, 'my subCursorId:', subCursorId);
      if (embeddedSubCursorId === subCursorId) {
        log('[SubCursor] Setting isEmbedded to true');
        setIsEmbedded(true);
        
        // 嵌入成功后多次调整大小，确保 CSS 变化（embedded 类移除 padding）后坐标正确
        // 使用更多次数和更长时间间隔来确保完美贴合
        const adjustSize = (delay: number) => {
          setTimeout(() => {
            const bounds = getSubCursorBounds();
            log(`[SubCursor] Resize after embed (${delay}ms):`, bounds);
            window.electronAPI.resizeEmbeddedWindow(subCursorId, bounds);
          }, delay);
        };
        // 多次调整确保完美贴合
        adjustSize(50);
        adjustSize(100);
        adjustSize(200);
        adjustSize(400);
        adjustSize(800);
        adjustSize(1500);
      }
    };
    
    window.electronAPI.onCursorEmbedded(handleEmbedded);
    
    return () => {
      // 注意：IPC 监听器需要手动移除
    };
  }, [subCursorId, getSubCursorBounds]);
  
  // 监听大小变化，更新嵌入窗口大小
  // 注意：window-moved 事件在 App.tsx 中统一处理，避免多个 SubCursor 的 removeAllListeners 相互干扰
  useEffect(() => {
    // 只要 Cursor 在运行就监听 resize
    if (!config.isRunning || !subCursorRef.current) return;
    
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let lastBounds = { x: 0, y: 0, width: 0, height: 0 };
    let isResizing = false;
    
    const doResize = () => {
      if (isResizing) return;
      isResizing = true;
      
      const bounds = getSubCursorBounds();
      // 使用更小的阈值确保精确贴合（1 像素）
      const threshold = 1;
      const changed = Math.abs(bounds.width - lastBounds.width) > threshold || 
          Math.abs(bounds.height - lastBounds.height) > threshold ||
          Math.abs(bounds.x - lastBounds.x) > threshold ||
          Math.abs(bounds.y - lastBounds.y) > threshold;
      
      if (changed) {
        lastBounds = { ...bounds };
        window.electronAPI.resizeEmbeddedWindow(subCursorId, bounds);
      }
      
      isResizing = false;
    };
    
    const handleResize = () => {
      // 使用 50ms 防抖
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(doResize, 50);
    };
    
    // 使用 ResizeObserver 监听整个 sub-cursor 的大小变化
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(subCursorRef.current);
    
    // 同时监听窗口 resize
    window.addEventListener('resize', handleResize);
    
    // 监听窗口最大化/还原事件 - 需要立即调整大小
    window.electronAPI.onWindowMaximizedChange(() => {
      // 最大化/还原后延迟多次调整，确保尺寸正确
      setTimeout(doResize, 100);
      setTimeout(doResize, 300);
      setTimeout(doResize, 500);
    });
    
    // 初始调整一次（延迟执行）
    debounceTimer = setTimeout(doResize, 300);
    
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      window.electronAPI.removeAllListeners('window-maximized-change');
    };
  }, [config.isRunning, subCursorId, getSubCursorBounds]);

  const displayName = config.label || subCursorId;
  const isRunning = config.isRunning;

  const handleLabelSubmit = () => {
    onUpdateLabel(labelInput);
    setIsEditingLabel(false);
  };

  const handleLabelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleLabelSubmit();
    } else if (e.key === 'Escape') {
      setLabelInput(config.label || '');
      setIsEditingLabel(false);
    }
  };

  // 右键菜单处理
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleCloseContextMenu = () => {
    setContextMenu(null);
  };

  const handleSplit = (direction: 'up' | 'down' | 'left' | 'right') => {
    setContextMenu(null);
    onSplit?.(direction);
  };

  // 点击外部关闭右键菜单
  useEffect(() => {
    if (contextMenu) {
      const handleClick = () => setContextMenu(null);
      window.addEventListener('click', handleClick);
      return () => window.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);

  // 获取文件夹名称（用于显示）
  const getFolderName = (path: string) => {
    const parts = path.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || path;
  };

  return (
    <div className={`sub-cursor ${isEmbedded ? 'has-embedded' : ''}`} ref={subCursorRef} data-sub-cursor-id={subCursorId} onContextMenu={handleContextMenu}>
      {/* 右键菜单 */}
      {contextMenu && onSplit && (
        <div 
          className="context-menu"
          style={{ 
            position: 'fixed', 
            left: contextMenu.x, 
            top: contextMenu.y,
            zIndex: 10000 
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="context-menu-item" onClick={() => handleSplit('up')}>
            <SplitUpIcon /> 向上拆分
          </div>
          <div className="context-menu-item" onClick={() => handleSplit('down')}>
            <SplitDownIcon /> 向下拆分
          </div>
          <div className="context-menu-item" onClick={() => handleSplit('left')}>
            <SplitLeftIcon /> 向左拆分
          </div>
          <div className="context-menu-item" onClick={() => handleSplit('right')}>
            <SplitRightIcon /> 向右拆分
          </div>
        </div>
      )}
      {/* 头部 */}
      <div className="sub-cursor-header">
        {isEditingLabel ? (
          <input
            type="text"
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            onBlur={handleLabelSubmit}
            onKeyDown={handleLabelKeyDown}
            autoFocus
            style={{
              flex: 1,
              background: 'var(--bg-primary)',
              border: '1px solid var(--accent-blue)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 8px',
              fontSize: '13px',
            }}
          />
        ) : (
          <span
            className="sub-cursor-title"
            onDoubleClick={() => setIsEditingLabel(true)}
            title="双击编辑名称"
          >
            {displayName}
          </span>
        )}

        {/* 运行状态 */}
        {isRunning && (
          <span className="sub-cursor-status running">
            <span className="status-dot" />
            运行中
          </span>
        )}

        {/* 操作按钮 */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {onToggleMaximize && (
            <button
              className="icon-button"
              onClick={onToggleMaximize}
              data-tooltip={isMaximized ? "还原" : "最大化"}
            >
              {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
            </button>
          )}
          <button
            className="icon-button"
            onClick={onSelectFolder}
            data-tooltip="选择文件夹"
          >
            <FolderIcon />
          </button>
          <button
            className="icon-button danger"
            onClick={onRemove}
            data-tooltip="删除"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {/* 内容 - 这是嵌入Cursor窗口的区域 */}
      <div 
        className={`sub-cursor-content ${isEmbedded ? 'embedded' : ''}`} 
        ref={contentRef}
        onClick={() => {
          // 点击时设置焦点到嵌入的窗口
          if (isEmbedded && config.isRunning) {
            log('[SubCursor] Click - focusing embedded window:', subCursorId);
            window.electronAPI.focusEmbeddedWindow(subCursorId);
          }
        }}
      >
        {isRunning && isEmbedded ? (
          // Cursor已嵌入，显示空白区域（Cursor窗口会覆盖这里）
          null // 不需要任何内容，Cursor窗口会覆盖
        ) : isRunning ? (
          <div className="sub-cursor-running-info">
            <CursorIcon className="sub-cursor-running-icon" />
            <span className="sub-cursor-running-text">Cursor 正在运行</span>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              (嵌入中...)
            </span>
            {config.folderPath && (
              <div className="sub-cursor-folder-info">
                <FolderOpenIcon />
                <span title={config.folderPath}>{getFolderName(config.folderPath)}</span>
              </div>
            )}
            <button className="btn-secondary" onClick={onCloseCursor}>
              <StopIcon />
              关闭 Cursor
            </button>
          </div>
        ) : (
          <>
            <div className="sub-cursor-placeholder">
              <CursorIcon className="sub-cursor-placeholder-icon" />
              <p className="sub-cursor-placeholder-text">
                {config.folderPath
                  ? '点击启动按钮打开 Cursor'
                  : '选择一个文件夹，然后启动 Cursor'}
              </p>
            </div>

            {config.folderPath && (
              <div className="sub-cursor-folder-info">
                <FolderOpenIcon />
                <span title={config.folderPath}>{getFolderName(config.folderPath)}</span>
                <button 
                  className="clear-folder-btn" 
                  onClick={onClearFolder}
                  title="清除文件夹"
                >
                  ×
                </button>
              </div>
            )}

            <div className="sub-cursor-actions">
              {!config.folderPath && (
                <button className="btn-secondary" onClick={onSelectFolder}>
                  <FolderIcon />
                  选择文件夹
                </button>
              )}
              {config.folderPath && (
                <button className="btn-secondary" onClick={onSelectFolder}>
                  <FolderIcon />
                  更换
                </button>
              )}
              <button className="btn-primary" onClick={handleOpenCursor}>
                <PlayIcon />
                启动 Cursor
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// 图标组件
function CursorIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
      <path d="M12 2L2 12h3v9h6v-6h2v6h6v-9h3L12 2z" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function FolderOpenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v11z" />
      <path d="M2 10h20" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  );
}

// 最大化图标
function MaximizeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
      <rect x="4" y="4" width="16" height="16" rx="1" />
    </svg>
  );
}

// 还原图标
function RestoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
      <rect x="6" y="6" width="12" height="12" rx="1" />
      <path d="M9 6V4h11v11h-2" />
    </svg>
  );
}

// 拆分图标
function SplitUpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <path d="M12 6l-3 3m3-3l3 3" />
    </svg>
  );
}

function SplitDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <path d="M12 18l-3-3m3 3l3-3" />
    </svg>
  );
}

function SplitLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="3" x2="12" y2="21" />
      <path d="M6 12l3-3m-3 3l3 3" />
    </svg>
  );
}

function SplitRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="3" x2="12" y2="21" />
      <path d="M18 12l-3-3m3 3l-3 3" />
    </svg>
  );
}

export default SubCursor;
