import React, { useState, useEffect, useCallback, useRef } from 'react';
import { WindowLayout, PaneConfig } from './types';
import SplitLayout from './components/SplitLayout';
import Toolbar from './components/Toolbar';
import SettingsModal from './components/SettingsModal';
import './styles/app.css';

// 调试开关 - 生产环境关闭
const DEBUG = false;
const log = DEBUG ? log.bind(console) : () => {};

// 默认布局 - 4窗口 (2x2)
const DEFAULT_LAYOUT: WindowLayout = {
  direction: 'row',
  first: {
    direction: 'column',
    first: 'pane-1',
    second: 'pane-3',
    splitPercentage: 50,
  },
  second: {
    direction: 'column',
    first: 'pane-2',
    second: 'pane-4',
    splitPercentage: 50,
  },
  splitPercentage: 50,
};

function App() {
  const [layout, setLayout] = useState<WindowLayout>(DEFAULT_LAYOUT);
  const [panes, setPanes] = useState<Record<string, PaneConfig>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  // 当前最大化的 pane ID，null 表示没有最大化
  const [maximizedPaneId, setMaximizedPaneId] = useState<string | null>(null);
  
  // 使用 ref 保存最新的 panes 状态，用于关闭前保存
  const panesRef = useRef(panes);
  useEffect(() => {
    panesRef.current = panes;
  }, [panes]);

  // 加载保存的配置
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const savedLayout = await window.electronAPI.getLayout();
        const savedPanes = await window.electronAPI.getPanes();
        
        if (savedLayout) {
          setLayout(savedLayout);
        }
        if (savedPanes) {
          console.log('[Load] Saved panes loaded:', JSON.stringify(savedPanes));
          // 收集需要自动恢复的 pane（有 folderPath 的都需要恢复）
          const panesToRestore: string[] = [];
          
          // 重置所有 pane 的运行状态（因为程序重启了，Cursor 并没有在运行）
          const cleanPanes: Record<string, PaneConfig> = {};
          Object.entries(savedPanes).forEach(([paneId, pane]) => {
            cleanPanes[paneId] = {
              ...pane,
              isRunning: false,
              cursorPid: undefined,
            };
            // 记录需要恢复的 pane（只要有 folderPath 就恢复）
            if (pane.folderPath) {
              panesToRestore.push(paneId);
              console.log(`[Load] Pane ${paneId} will be restored with folderPath: ${pane.folderPath}`);
            }
          });
          
          setPanes(cleanPanes);
          
          // 自动恢复之前打开的 Cursor 窗口（延迟执行以等待 DOM 渲染完成）
          if (panesToRestore.length > 0) {
            console.log(`[AutoRestore] Will restore ${panesToRestore.length} Cursor windows:`, panesToRestore);
            // 使用递归延迟打开，避免同时打开太多窗口
            const restoreNext = async (index: number) => {
              if (index >= panesToRestore.length) return;
              
              const paneId = panesToRestore[index];
              const pane = savedPanes[paneId];
              const paneEl = document.querySelector(`[data-pane-id="${paneId}"] .pane-content`);
              
              if (paneEl && pane.folderPath) {
                const rect = paneEl.getBoundingClientRect();
                log(`[AutoRestore] Restoring Cursor for ${paneId}:`, pane.folderPath, rect);
                const result = await window.electronAPI.openCursor(paneId, pane.folderPath, {
                  x: Math.round(rect.left),
                  y: Math.round(rect.top),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                });
                // 如果成功，更新状态
                if (result.success) {
                  setPanes(prev => ({
                    ...prev,
                    [paneId]: { ...prev[paneId], isRunning: true, cursorPid: result.pid },
                  }));
                }
              } else {
                log(`[AutoRestore] Cannot restore ${paneId}: paneEl=${!!paneEl}, folderPath=${pane.folderPath}`);
              }
              
              // 2秒后打开下一个
              setTimeout(() => restoreNext(index + 1), 2000);
            };
            
            // 1.5秒后开始恢复
            setTimeout(() => restoreNext(0), 1500);
          }
        }
      } catch (error) {
        console.error('Failed to load config:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadConfig();

    // 监听Cursor关闭事件
    window.electronAPI.onCursorClosed((paneId) => {
      setPanes((prev) => ({
        ...prev,
        [paneId]: { ...prev[paneId], isRunning: false, cursorPid: undefined },
      }));
    });

    window.electronAPI.onCursorError((paneId, error) => {
      console.error(`Cursor error for pane ${paneId}:`, error);
      setPanes((prev) => ({
        ...prev,
        [paneId]: { ...prev[paneId], isRunning: false, cursorPid: undefined },
      }));
    });

    // 监听关闭前保存状态事件（保存当前的 panes 配置，包括 folderPath）
    window.electronAPI.onSaveStateBeforeClose(async () => {
      console.log('[SaveState] Saving state before close, panes:', JSON.stringify(panesRef.current));
      // 使用 ref 获取最新的 panes 状态
      await window.electronAPI.savePanes(panesRef.current);
      console.log('[SaveState] Panes saved successfully');
      // 通知主进程保存已完成
      await window.electronAPI.stateSaved();
    });

    return () => {
      window.electronAPI.removeAllListeners('cursor-closed');
      window.electronAPI.removeAllListeners('cursor-error');
      window.electronAPI.removeAllListeners('save-state-before-close');
    };
  }, []); // 依赖数组为空，只在组件挂载时注册一次

  // 布局变化时保存
  const handleLayoutChange = useCallback(async (newLayout: WindowLayout) => {
    setLayout(newLayout);
    await window.electronAPI.saveLayout(newLayout);
  }, []);

  // 窗格配置变化时保存
  const handlePanesChange = useCallback(async (newPanes: Record<string, PaneConfig>) => {
    setPanes(newPanes);
    await window.electronAPI.savePanes(newPanes);
  }, []);

  // 更新单个窗格
  const updatePane = useCallback((paneId: string, config: Partial<PaneConfig>) => {
    handlePanesChange({
      ...panes,
      [paneId]: { ...panes[paneId], id: paneId, ...config },
    });
  }, [panes, handlePanesChange]);

  // 打开Cursor
  const openCursor = useCallback(async (paneId: string, bounds: { x: number; y: number; width: number; height: number }) => {
    const pane = panes[paneId];
    log('Opening Cursor for pane:', paneId, 'with bounds:', bounds);
    const result = await window.electronAPI.openCursor(paneId, pane?.folderPath, bounds);
    
    if (result.success) {
      updatePane(paneId, { isRunning: true, cursorPid: result.pid });
    } else {
      console.error('Failed to open Cursor:', result.error);
    }
  }, [panes, updatePane]);

  // 关闭Cursor
  const closeCursor = useCallback(async (paneId: string) => {
    await window.electronAPI.closeCursor(paneId);
    updatePane(paneId, { isRunning: false, cursorPid: undefined });
  }, [updatePane]);

  // 选择文件夹
  const selectFolder = useCallback(async (paneId: string) => {
    const folderPath = await window.electronAPI.selectFolder();
    if (folderPath) {
      // 检查是否有其他 pane 已使用该文件夹
      const existingPane = Object.entries(panes).find(
        ([id, config]) => id !== paneId && config.folderPath === folderPath
      );
      
      if (existingPane) {
        const [existingPaneId, existingConfig] = existingPane;
        const existingPaneName = existingConfig.label || existingPaneId;
        const shouldCopy = window.confirm(
          `窗格 "${existingPaneName}" 已打开此文件夹。\n\n是否复制其窗口配置？`
        );
        
        if (shouldCopy) {
          // 复制配置（包括文件夹路径）
          updatePane(paneId, { 
            folderPath,
            label: existingConfig.label ? `${existingConfig.label} (副本)` : undefined,
          });
        } else {
          // 仅设置文件夹路径
          updatePane(paneId, { folderPath });
        }
      } else {
        updatePane(paneId, { folderPath });
      }
    }
  }, [panes, updatePane]);

  // 清除文件夹选择
  const clearFolder = useCallback((paneId: string) => {
    updatePane(paneId, { folderPath: undefined });
  }, [updatePane]);

  // 添加新窗格
  const addPane = useCallback(() => {
    const paneIds = getAllPaneIds(layout);
    const maxId = paneIds.reduce((max, id) => {
      const num = parseInt(id.replace('pane-', ''), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);
    const newPaneId = `pane-${maxId + 1}`;

    // 在最后一个位置添加新窗格
    const newLayout: WindowLayout = {
      direction: 'column',
      first: layout,
      second: newPaneId,
      splitPercentage: 75,
    };

    handleLayoutChange(newLayout);
  }, [layout, handleLayoutChange]);

  // 删除窗格
  const removePane = useCallback((paneId: string) => {
    const newLayout = removePaneFromLayout(layout, paneId);
    if (newLayout) {
      handleLayoutChange(newLayout);
      // 同时删除窗格配置
      const newPanes = { ...panes };
      delete newPanes[paneId];
      handlePanesChange(newPanes);
    }
  }, [layout, panes, handleLayoutChange, handlePanesChange]);

  // 拆分窗格
  const splitPane = useCallback((paneId: string, direction: 'up' | 'down' | 'left' | 'right') => {
    // 计算新窗格ID
    const paneIds = getAllPaneIds(layout);
    const maxId = paneIds.reduce((max, id) => {
      const num = parseInt(id.replace('pane-', ''), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);
    const newPaneId = `pane-${maxId + 1}`;

    // 根据方向创建新的分割布局
    const splitDirection = (direction === 'left' || direction === 'right') ? 'row' : 'column';
    const isFirstPosition = (direction === 'up' || direction === 'left');
    
    const newSplit: WindowLayout = {
      direction: splitDirection,
      first: isFirstPosition ? newPaneId : paneId,
      second: isFirstPosition ? paneId : newPaneId,
      splitPercentage: 50,
    };

    // 替换布局中的 paneId
    const replaceInLayout = (l: WindowLayout): WindowLayout => {
      if (typeof l === 'string') {
        return l === paneId ? newSplit : l;
      }
      return {
        ...l,
        first: replaceInLayout(l.first),
        second: replaceInLayout(l.second),
      };
    };

    const newLayout = replaceInLayout(layout);
    handleLayoutChange(newLayout);
  }, [layout, handleLayoutChange]);

  // 重置布局
  const resetLayout = useCallback(() => {
    // 先关闭所有运行中的 Cursor
    Object.keys(panes).forEach(paneId => {
      if (panes[paneId]?.isRunning) {
        window.electronAPI.closeCursor(paneId);
      }
    });
    handleLayoutChange(DEFAULT_LAYOUT);
    handlePanesChange({});
  }, [panes, handleLayoutChange, handlePanesChange]);

  // 预设布局
  const applyPresetLayout = useCallback((preset: 'single' | 'dual-h' | 'dual-v' | 'quad' | 'triple' | 'six' | 'eight') => {
    let newLayout: WindowLayout;
    
    switch (preset) {
      case 'single':
        newLayout = 'pane-1';
        break;
      case 'dual-h':
        newLayout = {
          direction: 'row',
          first: 'pane-1',
          second: 'pane-2',
          splitPercentage: 50,
        };
        break;
      case 'dual-v':
        newLayout = {
          direction: 'column',
          first: 'pane-1',
          second: 'pane-2',
          splitPercentage: 50,
        };
        break;
      case 'quad':
        newLayout = {
          direction: 'row',
          first: {
            direction: 'column',
            first: 'pane-1',
            second: 'pane-3',
            splitPercentage: 50,
          },
          second: {
            direction: 'column',
            first: 'pane-2',
            second: 'pane-4',
            splitPercentage: 50,
          },
          splitPercentage: 50,
        };
        break;
      case 'triple':
        newLayout = {
          direction: 'row',
          first: 'pane-1',
          second: {
            direction: 'column',
            first: 'pane-2',
            second: 'pane-3',
            splitPercentage: 50,
          },
          splitPercentage: 50,
        };
        break;
      case 'six':
        // 2行3列布局
        newLayout = {
          direction: 'column',
          first: {
            direction: 'row',
            first: 'pane-1',
            second: {
              direction: 'row',
              first: 'pane-2',
              second: 'pane-3',
              splitPercentage: 50,
            },
            splitPercentage: 33,
          },
          second: {
            direction: 'row',
            first: 'pane-4',
            second: {
              direction: 'row',
              first: 'pane-5',
              second: 'pane-6',
              splitPercentage: 50,
            },
            splitPercentage: 33,
          },
          splitPercentage: 50,
        };
        break;
      case 'eight':
        // 2行4列布局
        newLayout = {
          direction: 'column',
          first: {
            direction: 'row',
            first: {
              direction: 'row',
              first: 'pane-1',
              second: 'pane-2',
              splitPercentage: 50,
            },
            second: {
              direction: 'row',
              first: 'pane-3',
              second: 'pane-4',
              splitPercentage: 50,
            },
            splitPercentage: 50,
          },
          second: {
            direction: 'row',
            first: {
              direction: 'row',
              first: 'pane-5',
              second: 'pane-6',
              splitPercentage: 50,
            },
            second: {
              direction: 'row',
              first: 'pane-7',
              second: 'pane-8',
              splitPercentage: 50,
            },
            splitPercentage: 50,
          },
          splitPercentage: 50,
        };
        break;
      default:
        return;
    }
    
    // 检查当前运行中的 Cursor 数量
    const currentPaneIds = getAllPaneIds(layout);
    const newPaneIds = getAllPaneIds(newLayout);
    const runningPanes = currentPaneIds.filter(id => panes[id]?.isRunning);
    const panesWillBeLost = runningPanes.filter(id => !newPaneIds.includes(id));
    
    // 如果有运行中的 Cursor 会被丢弃，提示用户
    if (panesWillBeLost.length > 0) {
      const names = panesWillBeLost.map(id => panes[id]?.label || id).join(', ');
      const confirmed = window.confirm(
        `切换布局将关闭 ${panesWillBeLost.length} 个运行中的 Cursor 窗口：\n${names}\n\n确定要继续吗？`
      );
      if (!confirmed) {
        return;
      }
      // 关闭将被丢弃的 Cursor
      panesWillBeLost.forEach(paneId => {
        window.electronAPI.closeCursor(paneId);
      });
    }
    
    handleLayoutChange(newLayout);
  }, [handleLayoutChange, layout, panes]);

  // 加载收藏的布局（必须在条件返回之前定义 hooks）
  const loadSavedLayout = useCallback((savedLayout: WindowLayout, savedPanes: Record<string, PaneConfig>) => {
    // 先关闭所有运行中的 Cursor
    Object.keys(panes).forEach(paneId => {
      if (panes[paneId]?.isRunning) {
        window.electronAPI.closeCursor(paneId);
      }
    });
    
    // 加载新布局
    setLayout(savedLayout);
    setPanes(savedPanes);
    window.electronAPI.saveLayout(savedLayout);
    window.electronAPI.savePanes(savedPanes);
  }, [panes]);

  // 切换 pane 最大化状态
  const toggleMaximizePane = useCallback(async (paneId: string) => {
    if (maximizedPaneId === paneId) {
      // 已经最大化，则还原
      setMaximizedPaneId(null);
      // 延迟显示所有嵌入窗口并更新位置（等待布局更新）
      setTimeout(async () => {
        await window.electronAPI.showAllEmbeddedWindows();
        // 更新所有运行中的 pane 窗口位置
        Object.keys(panes).forEach(id => {
          if (panes[id]?.isRunning) {
            const paneEl = document.querySelector(`[data-pane-id="${id}"] .pane-content`);
            if (paneEl) {
              const rect = paneEl.getBoundingClientRect();
              window.electronAPI.resizeEmbeddedWindow(id, {
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              });
            }
          }
        });
      }, 50);
    } else {
      // 最大化此 pane
      // 先隐藏所有嵌入窗口
      await window.electronAPI.hideAllEmbeddedWindows();
      setMaximizedPaneId(paneId);
      // 然后延迟更新最大化 pane 的窗口位置并显示
      setTimeout(async () => {
        if (panes[paneId]?.isRunning) {
          // 重新调整当前 pane 窗口的位置
          const paneEl = document.querySelector(`[data-pane-id="${paneId}"] .pane-content`);
          if (paneEl) {
            const rect = paneEl.getBoundingClientRect();
            await window.electronAPI.resizeEmbeddedWindow(paneId, {
              x: Math.round(rect.left),
              y: Math.round(rect.top),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            });
            // 只显示当前 pane 的嵌入窗口
            await window.electronAPI.showEmbeddedWindow(paneId);
          }
        }
      }, 100);
    }
  }, [maximizedPaneId, panes]);

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>加载中...</p>
      </div>
    );
  }

  return (
    <div className="app">
      <Toolbar
        onAddPane={addPane}
        onResetLayout={resetLayout}
        onApplyPreset={applyPresetLayout}
        onOpenSettings={() => setShowSettings(true)}
        currentLayout={layout}
        currentPanes={panes}
        onLoadLayout={loadSavedLayout}
      />
      
      <div className="layout-container">
        <SplitLayout
          layout={layout}
          panes={panes}
          onLayoutChange={handleLayoutChange}
          onOpenCursor={openCursor}
          onCloseCursor={closeCursor}
          onSelectFolder={selectFolder}
          onClearFolder={clearFolder}
          onRemovePane={removePane}
          onUpdatePane={updatePane}
          onSplitPane={splitPane}
          maximizedPaneId={maximizedPaneId}
          onToggleMaximize={toggleMaximizePane}
        />
      </div>

      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

// 辅助函数：获取所有窗格ID
function getAllPaneIds(layout: WindowLayout): string[] {
  if (typeof layout === 'string') {
    return [layout];
  }
  return [...getAllPaneIds(layout.first), ...getAllPaneIds(layout.second)];
}

// 辅助函数：从布局中删除窗格
function removePaneFromLayout(layout: WindowLayout, paneId: string): WindowLayout | null {
  if (typeof layout === 'string') {
    return layout === paneId ? null : layout;
  }

  if (layout.first === paneId) {
    return layout.second;
  }
  if (layout.second === paneId) {
    return layout.first;
  }

  const newFirst = removePaneFromLayout(layout.first, paneId);
  const newSecond = removePaneFromLayout(layout.second, paneId);

  if (newFirst === null) return newSecond;
  if (newSecond === null) return newFirst;

  return {
    ...layout,
    first: newFirst,
    second: newSecond,
  };
}

export default App;
