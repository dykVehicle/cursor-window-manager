import React, { useState, useEffect, useCallback } from 'react';
import { SavedLayout, WindowLayout, PaneConfig } from '../types';

declare global {
  interface Window {
    electronAPI: {
      windowMinimize: () => void;
      windowMaximize: () => void;
      windowClose: () => void;
      windowIsMaximized: () => Promise<boolean>;
      onWindowMaximizedChange: (callback: (isMaximized: boolean) => void) => void;
      hideAllEmbeddedWindows: () => void;
      showAllEmbeddedWindows: () => void;
      [key: string]: unknown;
    };
  }
}

type LayoutPreset = 'single' | 'dual-h' | 'dual-v' | 'triple' | 'quad' | 'six' | 'eight';

interface ToolbarProps {
  onAddPane: () => void;
  onResetLayout: () => void;
  onApplyPreset: (preset: LayoutPreset) => void;
  onOpenSettings: () => void;
  currentLayout: WindowLayout;
  currentPanes: Record<string, PaneConfig>;
  onLoadLayout: (layout: WindowLayout, panes: Record<string, PaneConfig>) => void;
}

function Toolbar({ onAddPane, onResetLayout, onApplyPreset, onOpenSettings, currentLayout, currentPanes, onLoadLayout }: ToolbarProps) {
  const [savedLayouts, setSavedLayouts] = useState<SavedLayout[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);
  const [layoutName, setLayoutName] = useState('');
  const [isMaximized, setIsMaximized] = useState(false);

  // 加载收藏的布局
  useEffect(() => {
    loadSavedLayouts();
    // 检查初始窗口状态
    window.electronAPI.windowIsMaximized().then(setIsMaximized);
    // 监听窗口状态变化
    window.electronAPI.onWindowMaximizedChange(setIsMaximized);
  }, []);
  
  // 窗口控制
  const handleMinimize = useCallback(() => {
    window.electronAPI.windowMinimize();
  }, []);
  
  const handleMaximize = useCallback(() => {
    window.electronAPI.windowMaximize();
  }, []);
  
  const handleClose = useCallback(() => {
    window.electronAPI.windowClose();
  }, []);
  
  // 菜单打开/关闭时隐藏/显示嵌入窗口
  const handleMenuOpen = useCallback(() => {
    setShowLayoutMenu(true);
    window.electronAPI.hideAllEmbeddedWindows();
  }, []);
  
  const handleMenuClose = useCallback(() => {
    setShowLayoutMenu(false);
    window.electronAPI.showAllEmbeddedWindows();
  }, []);

  const loadSavedLayouts = async () => {
    const layouts = await window.electronAPI.getSavedLayouts();
    setSavedLayouts(layouts);
  };

  const handleSaveLayout = async () => {
    if (!layoutName.trim()) return;
    await window.electronAPI.saveLayoutAs(layoutName.trim(), currentLayout, currentPanes);
    setLayoutName('');
    setShowSaveDialog(false);
    window.electronAPI.showAllEmbeddedWindows();
    loadSavedLayouts();
  };

  const handleDeleteLayout = async (id: string) => {
    await window.electronAPI.deleteSavedLayout(id);
    loadSavedLayouts();
  };

  const handleLoadLayout = (saved: SavedLayout) => {
    onLoadLayout(saved.layout, saved.panes);
    setShowLayoutMenu(false);
  };
  return (
    <div className="toolbar" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      {/* 标题 */}
      <div className="toolbar-title">
        <CursorLogo />
        Multi Cursor
      </div>

      <div className="toolbar-divider" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} />

      {/* 预设布局 */}
      <div className="toolbar-group" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)', marginRight: '8px' }}>
          布局:
        </span>
        <button
          className="preset-button"
          onClick={() => onApplyPreset('single')}
          data-tooltip="单窗格"
        >
          <SingleLayoutIcon />
        </button>
        <button
          className="preset-button"
          onClick={() => onApplyPreset('dual-h')}
          data-tooltip="左右分割"
        >
          <DualHLayoutIcon />
        </button>
        <button
          className="preset-button"
          onClick={() => onApplyPreset('dual-v')}
          data-tooltip="上下分割"
        >
          <DualVLayoutIcon />
        </button>
        <button
          className="preset-button"
          onClick={() => onApplyPreset('triple')}
          data-tooltip="三窗格"
        >
          <TripleLayoutIcon />
        </button>
        <button
          className="preset-button"
          onClick={() => onApplyPreset('quad')}
          data-tooltip="四窗格"
        >
          <QuadLayoutIcon />
        </button>
        <button
          className="preset-button"
          onClick={() => onApplyPreset('six')}
          data-tooltip="六窗格"
        >
          <SixLayoutIcon />
        </button>
        <button
          className="preset-button"
          onClick={() => onApplyPreset('eight')}
          data-tooltip="八窗格"
        >
          <EightLayoutIcon />
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* 操作按钮 */}
      <button className="btn-secondary" onClick={onAddPane} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <PlusIcon />
        添加窗格
      </button>

      <button className="btn-secondary" onClick={onResetLayout} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <ResetIcon />
        重置
      </button>

      <div className="toolbar-divider" />

      {/* 布局收藏 */}
      <div className="layout-dropdown" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button 
          className="btn-primary"
          onClick={() => showLayoutMenu ? handleMenuClose() : handleMenuOpen()}
        >
          <BookmarkIcon />
          布局管理
          <ChevronIcon />
        </button>
        
        {showLayoutMenu && (
          <>
            <div className="dropdown-backdrop" onClick={handleMenuClose} />
            <div className="dropdown-menu">
              <button 
                className="dropdown-item save-item"
                onClick={() => { setShowSaveDialog(true); setShowLayoutMenu(false); window.electronAPI.hideAllEmbeddedWindows(); }}
              >
                <SaveIcon />
                保存当前布局...
              </button>
              
              {savedLayouts.length > 0 && <div className="dropdown-divider" />}
              
              {savedLayouts.map(saved => (
                <div key={saved.id} className="dropdown-item layout-item">
                  <span onClick={() => { handleLoadLayout(saved); handleMenuClose(); }}>{saved.name}</span>
                  <button 
                    className="delete-btn"
                    onClick={(e) => { e.stopPropagation(); handleDeleteLayout(saved.id); }}
                  >
                    ×
                  </button>
                </div>
              ))}
              
              {savedLayouts.length === 0 && (
                <div className="dropdown-item disabled">暂无收藏的布局</div>
              )}
            </div>
          </>
        )}
      </div>

      {/* 保存布局对话框 */}
      {showSaveDialog && (
        <div className="modal-overlay" onClick={() => { setShowSaveDialog(false); window.electronAPI.showAllEmbeddedWindows(); }}>
          <div className="save-layout-dialog" onClick={e => e.stopPropagation()}>
            <h3>保存布局</h3>
            <input
              type="text"
              placeholder="输入布局名称..."
              value={layoutName}
              onChange={e => setLayoutName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveLayout()}
              autoFocus
            />
            <div className="dialog-buttons">
              <button className="btn-secondary" onClick={() => { setShowSaveDialog(false); window.electronAPI.showAllEmbeddedWindows(); }}>取消</button>
              <button className="btn-primary" onClick={handleSaveLayout}>保存</button>
            </div>
          </div>
        </div>
      )}

      <div className="toolbar-spacer" />

      {/* 设置 */}
      <button className="icon-button" onClick={onOpenSettings} data-tooltip="设置" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <SettingsIcon />
      </button>
      
      {/* 窗口控制按钮 */}
      <div className="window-controls" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button className="window-control-btn minimize" onClick={handleMinimize} title="最小化">
          <MinimizeIcon />
        </button>
        <button className="window-control-btn maximize" onClick={handleMaximize} title={isMaximized ? '还原' : '最大化'}>
          {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button className="window-control-btn close" onClick={handleClose} title="关闭">
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

// 图标组件
function CursorLogo() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
      <path d="M3.5 3.5L20.5 12L10 14L7 21L3.5 3.5Z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ marginLeft: '4px' }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

// 布局预设图标
function SingleLayoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18">
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </svg>
  );
}

function DualHLayoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="3" x2="12" y2="21" />
    </svg>
  );
}

function DualVLayoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  );
}

function TripleLayoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="3" x2="12" y2="21" />
      <line x1="12" y1="12" x2="21" y2="12" />
    </svg>
  );
}

function QuadLayoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="3" x2="12" y2="21" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  );
}

function SixLayoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  );
}

function EightLayoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
      <line x1="3" y1="8" x2="21" y2="8" />
      <line x1="3" y1="16" x2="21" y2="16" />
    </svg>
  );
}

// 窗口控制图标
function MinimizeIcon() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12">
      <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12">
      <rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12">
      <rect x="3" y="0.5" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x="0.5" y="3" width="8" height="8" fill="var(--bg-secondary)" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12">
      <line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" strokeWidth="1.2" />
      <line x1="1" y1="11" x2="11" y2="1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export default Toolbar;
