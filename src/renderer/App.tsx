import React, { useState, useEffect, useCallback, useRef } from 'react';
import { WindowLayout, SubCursorConfig } from './types';
import SplitLayout from './components/SplitLayout';
import Toolbar from './components/Toolbar';
import SettingsModal from './components/SettingsModal';
import './styles/app.css';

// 调试开关 - 生产环境关闭
const DEBUG = false;
const log = DEBUG ? console.log.bind(console) : () => {};

// 默认布局 - 4窗口 (2x2)
const DEFAULT_LAYOUT: WindowLayout = {
  direction: 'row',
  first: {
    direction: 'column',
    first: 'sub-cursor-1',
    second: 'sub-cursor-3',
    splitPercentage: 50,
  },
  second: {
    direction: 'column',
    first: 'sub-cursor-2',
    second: 'sub-cursor-4',
    splitPercentage: 50,
  },
  splitPercentage: 50,
};

function App() {
  const [layout, setLayout] = useState<WindowLayout>(DEFAULT_LAYOUT);
  const [subCursors, setSubCursors] = useState<Record<string, SubCursorConfig>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  // 当前最大化的 sub-cursor ID，null 表示没有最大化
  const [maximizedSubCursorId, setMaximizedSubCursorId] = useState<string | null>(null);
  
  // 使用 ref 保存最新的 subCursors 状态，用于关闭前保存
  const subCursorsRef = useRef(subCursors);
  useEffect(() => {
    subCursorsRef.current = subCursors;
  }, [subCursors]);

  // 加载保存的配置
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const savedLayout = await window.electronAPI.getLayout();
        const savedSubCursors = await window.electronAPI.getSubCursors();
        
        if (savedLayout) {
          setLayout(savedLayout);
        }
        if (savedSubCursors) {
          console.log('[Load] Saved sub-cursors loaded:', JSON.stringify(savedSubCursors));
          // 收集需要自动恢复的 sub-cursor（有 folderPath 的都需要恢复）
          const subCursorsToRestore: string[] = [];
          
          // 重置所有 sub-cursor 的运行状态（因为程序重启了，Cursor 并没有在运行）
          const cleanSubCursors: Record<string, SubCursorConfig> = {};
          Object.entries(savedSubCursors).forEach(([subCursorId, sc]) => {
            cleanSubCursors[subCursorId] = {
              ...sc,
              isRunning: false,
              cursorPid: undefined,
            };
            // 记录需要恢复的 sub-cursor（只要有 folderPath 就恢复）
            if (sc.folderPath) {
              subCursorsToRestore.push(subCursorId);
              console.log(`[Load] Sub-cursor ${subCursorId} will be restored with folderPath: ${sc.folderPath}`);
            }
          });
          
          setSubCursors(cleanSubCursors);
          
          // 自动恢复之前打开的 Cursor 窗口（延迟执行以等待 DOM 渲染完成）
          if (subCursorsToRestore.length > 0) {
            console.log(`[AutoRestore] Will restore ${subCursorsToRestore.length} Cursor windows:`, subCursorsToRestore);
            // 使用递归延迟打开，避免同时打开太多窗口
            const restoreNext = async (index: number) => {
              if (index >= subCursorsToRestore.length) return;
              
              const subCursorId = subCursorsToRestore[index];
              const sc = savedSubCursors[subCursorId];
              const scEl = document.querySelector(`[data-sub-cursor-id="${subCursorId}"] .sub-cursor-content`);
              
              if (scEl && sc.folderPath) {
                const rect = scEl.getBoundingClientRect();
                log(`[AutoRestore] Restoring Cursor for ${subCursorId}:`, sc.folderPath, rect);
                const result = await window.electronAPI.openCursor(subCursorId, sc.folderPath, {
                  x: Math.round(rect.left),
                  y: Math.round(rect.top),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                });
                // 如果成功，更新状态
                if (result.success) {
                  setSubCursors(prev => ({
                    ...prev,
                    [subCursorId]: { ...prev[subCursorId], isRunning: true, cursorPid: result.pid },
                  }));
                }
              } else {
                log(`[AutoRestore] Cannot restore ${subCursorId}: scEl=${!!scEl}, folderPath=${sc.folderPath}`);
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
    window.electronAPI.onCursorClosed((subCursorId) => {
      setSubCursors((prev) => ({
        ...prev,
        [subCursorId]: { ...prev[subCursorId], isRunning: false, cursorPid: undefined },
      }));
    });

    window.electronAPI.onCursorError((subCursorId, error) => {
      console.error(`Cursor error for sub-cursor ${subCursorId}:`, error);
      setSubCursors((prev) => ({
        ...prev,
        [subCursorId]: { ...prev[subCursorId], isRunning: false, cursorPid: undefined },
      }));
    });

    // 监听关闭前保存状态事件（保存当前的 subCursors 配置，包括 folderPath）
    window.electronAPI.onSaveStateBeforeClose(async () => {
      console.log('[SaveState] Saving state before close, subCursors:', JSON.stringify(subCursorsRef.current));
      // 使用 ref 获取最新的 subCursors 状态
      await window.electronAPI.saveSubCursors(subCursorsRef.current);
      console.log('[SaveState] Sub-cursors saved successfully');
      // 通知主进程保存已完成
      await window.electronAPI.stateSaved();
    });

    // 全局监听主窗口移动事件 - 更新所有运行中的 Cursor 窗口位置
    // 使用节流确保不会过于频繁
    let lastUpdateTime = 0;
    const THROTTLE_MS = 8; // ~120fps
    
    window.electronAPI.onWindowMoved(() => {
      const now = Date.now();
      if (now - lastUpdateTime < THROTTLE_MS) return;
      lastUpdateTime = now;
      
      // 更新所有运行中的 sub-cursor 窗口位置
      const currentSubCursors = subCursorsRef.current;
      const runningSubCursors = Object.keys(currentSubCursors).filter(id => currentSubCursors[id]?.isRunning);
      
      runningSubCursors.forEach(subCursorId => {
        const scEl = document.querySelector(`[data-sub-cursor-id="${subCursorId}"] .sub-cursor-content`);
        if (scEl) {
          const rect = scEl.getBoundingClientRect();
          window.electronAPI.resizeEmbeddedWindow(subCursorId, {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
        }
      });
    });

    return () => {
      window.electronAPI.removeAllListeners('cursor-closed');
      window.electronAPI.removeAllListeners('cursor-error');
      window.electronAPI.removeAllListeners('save-state-before-close');
      window.electronAPI.removeAllListeners('window-moved');
    };
  }, []); // 依赖数组为空，只在组件挂载时注册一次

  // 布局变化时保存
  const handleLayoutChange = useCallback(async (newLayout: WindowLayout) => {
    setLayout(newLayout);
    await window.electronAPI.saveLayout(newLayout);
  }, []);

  // Sub Cursor 配置变化时保存
  const handleSubCursorsChange = useCallback(async (newSubCursors: Record<string, SubCursorConfig>) => {
    setSubCursors(newSubCursors);
    await window.electronAPI.saveSubCursors(newSubCursors);
  }, []);

  // 更新单个 Sub Cursor
  const updateSubCursor = useCallback((subCursorId: string, config: Partial<SubCursorConfig>) => {
    handleSubCursorsChange({
      ...subCursors,
      [subCursorId]: { ...subCursors[subCursorId], id: subCursorId, ...config },
    });
  }, [subCursors, handleSubCursorsChange]);

  // 打开Cursor
  const openCursor = useCallback(async (subCursorId: string, bounds: { x: number; y: number; width: number; height: number }) => {
    const sc = subCursors[subCursorId];
    log('Opening Cursor for sub-cursor:', subCursorId, 'with bounds:', bounds);
    const result = await window.electronAPI.openCursor(subCursorId, sc?.folderPath, bounds);
    
    if (result.success) {
      updateSubCursor(subCursorId, { isRunning: true, cursorPid: result.pid });
    } else {
      console.error('Failed to open Cursor:', result.error);
    }
  }, [subCursors, updateSubCursor]);

  // 关闭Cursor
  const closeCursor = useCallback(async (subCursorId: string) => {
    await window.electronAPI.closeCursor(subCursorId);
    updateSubCursor(subCursorId, { isRunning: false, cursorPid: undefined });
  }, [updateSubCursor]);

  // 选择文件夹
  const selectFolder = useCallback(async (subCursorId: string) => {
    const folderPath = await window.electronAPI.selectFolder();
    if (folderPath) {
      // 检查是否有其他 sub-cursor 已使用该文件夹
      const existingSubCursor = Object.entries(subCursors).find(
        ([id, config]) => id !== subCursorId && config.folderPath === folderPath
      );
      
      if (existingSubCursor) {
        const [existingId, existingConfig] = existingSubCursor;
        const existingName = existingConfig.label || existingId;
        const shouldCopy = window.confirm(
          `Sub Cursor "${existingName}" 已打开此文件夹。\n\n是否复制其窗口配置？`
        );
        
        if (shouldCopy) {
          // 复制配置（包括文件夹路径）
          updateSubCursor(subCursorId, { 
            folderPath,
            label: existingConfig.label ? `${existingConfig.label} (副本)` : undefined,
          });
        } else {
          // 仅设置文件夹路径
          updateSubCursor(subCursorId, { folderPath });
        }
      } else {
        updateSubCursor(subCursorId, { folderPath });
      }
    }
  }, [subCursors, updateSubCursor]);

  // 清除文件夹选择
  const clearFolder = useCallback((subCursorId: string) => {
    updateSubCursor(subCursorId, { folderPath: undefined });
  }, [updateSubCursor]);

  // 添加新 Sub Cursor
  const addSubCursor = useCallback(() => {
    const subCursorIds = getAllSubCursorIds(layout);
    const maxId = subCursorIds.reduce((max, id) => {
      const num = parseInt(id.replace('sub-cursor-', ''), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);
    const newSubCursorId = `sub-cursor-${maxId + 1}`;

    // 在最后一个位置添加新 Sub Cursor
    const newLayout: WindowLayout = {
      direction: 'column',
      first: layout,
      second: newSubCursorId,
      splitPercentage: 75,
    };

    handleLayoutChange(newLayout);
  }, [layout, handleLayoutChange]);

  // 删除 Sub Cursor
  const removeSubCursor = useCallback((subCursorId: string) => {
    const newLayout = removeSubCursorFromLayout(layout, subCursorId);
    if (newLayout) {
      handleLayoutChange(newLayout);
      // 同时删除配置
      const newSubCursors = { ...subCursors };
      delete newSubCursors[subCursorId];
      handleSubCursorsChange(newSubCursors);
    }
  }, [layout, subCursors, handleLayoutChange, handleSubCursorsChange]);

  // 拆分 Sub Cursor
  const splitSubCursor = useCallback((subCursorId: string, direction: 'up' | 'down' | 'left' | 'right') => {
    // 计算新 Sub Cursor ID
    const subCursorIds = getAllSubCursorIds(layout);
    const maxId = subCursorIds.reduce((max, id) => {
      const num = parseInt(id.replace('sub-cursor-', ''), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);
    const newSubCursorId = `sub-cursor-${maxId + 1}`;

    // 根据方向创建新的分割布局
    const splitDirection = (direction === 'left' || direction === 'right') ? 'row' : 'column';
    const isFirstPosition = (direction === 'up' || direction === 'left');
    
    const newSplit: WindowLayout = {
      direction: splitDirection,
      first: isFirstPosition ? newSubCursorId : subCursorId,
      second: isFirstPosition ? subCursorId : newSubCursorId,
      splitPercentage: 50,
    };

    // 替换布局中的 subCursorId
    const replaceInLayout = (l: WindowLayout): WindowLayout => {
      if (typeof l === 'string') {
        return l === subCursorId ? newSplit : l;
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
    Object.keys(subCursors).forEach(subCursorId => {
      if (subCursors[subCursorId]?.isRunning) {
        window.electronAPI.closeCursor(subCursorId);
      }
    });
    handleLayoutChange(DEFAULT_LAYOUT);
    handleSubCursorsChange({});
  }, [subCursors, handleLayoutChange, handleSubCursorsChange]);

  // 预设布局
  const applyPresetLayout = useCallback((preset: 'single' | 'dual-h' | 'dual-v' | 'quad' | 'triple' | 'six' | 'eight') => {
    let newLayout: WindowLayout;
    
    switch (preset) {
      case 'single':
        newLayout = 'sub-cursor-1';
        break;
      case 'dual-h':
        newLayout = {
          direction: 'row',
          first: 'sub-cursor-1',
          second: 'sub-cursor-2',
          splitPercentage: 50,
        };
        break;
      case 'dual-v':
        newLayout = {
          direction: 'column',
          first: 'sub-cursor-1',
          second: 'sub-cursor-2',
          splitPercentage: 50,
        };
        break;
      case 'quad':
        newLayout = {
          direction: 'row',
          first: {
            direction: 'column',
            first: 'sub-cursor-1',
            second: 'sub-cursor-3',
            splitPercentage: 50,
          },
          second: {
            direction: 'column',
            first: 'sub-cursor-2',
            second: 'sub-cursor-4',
            splitPercentage: 50,
          },
          splitPercentage: 50,
        };
        break;
      case 'triple':
        newLayout = {
          direction: 'row',
          first: 'sub-cursor-1',
          second: {
            direction: 'column',
            first: 'sub-cursor-2',
            second: 'sub-cursor-3',
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
            first: 'sub-cursor-1',
            second: {
              direction: 'row',
              first: 'sub-cursor-2',
              second: 'sub-cursor-3',
              splitPercentage: 50,
            },
            splitPercentage: 33,
          },
          second: {
            direction: 'row',
            first: 'sub-cursor-4',
            second: {
              direction: 'row',
              first: 'sub-cursor-5',
              second: 'sub-cursor-6',
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
              first: 'sub-cursor-1',
              second: 'sub-cursor-2',
              splitPercentage: 50,
            },
            second: {
              direction: 'row',
              first: 'sub-cursor-3',
              second: 'sub-cursor-4',
              splitPercentage: 50,
            },
            splitPercentage: 50,
          },
          second: {
            direction: 'row',
            first: {
              direction: 'row',
              first: 'sub-cursor-5',
              second: 'sub-cursor-6',
              splitPercentage: 50,
            },
            second: {
              direction: 'row',
              first: 'sub-cursor-7',
              second: 'sub-cursor-8',
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
    const currentSubCursorIds = getAllSubCursorIds(layout);
    const newSubCursorIds = getAllSubCursorIds(newLayout);
    const runningSubCursors = currentSubCursorIds.filter(id => subCursors[id]?.isRunning);
    const subCursorsWillBeLost = runningSubCursors.filter(id => !newSubCursorIds.includes(id));
    
    // 如果有运行中的 Cursor 会被丢弃，提示用户
    if (subCursorsWillBeLost.length > 0) {
      const names = subCursorsWillBeLost.map(id => subCursors[id]?.label || id).join(', ');
      const confirmed = window.confirm(
        `切换布局将关闭 ${subCursorsWillBeLost.length} 个运行中的 Cursor 窗口：\n${names}\n\n确定要继续吗？`
      );
      if (!confirmed) {
        return;
      }
      // 关闭将被丢弃的 Cursor
      subCursorsWillBeLost.forEach(subCursorId => {
        window.electronAPI.closeCursor(subCursorId);
      });
    }
    
    handleLayoutChange(newLayout);
  }, [handleLayoutChange, layout, subCursors]);

  // 加载收藏的布局（必须在条件返回之前定义 hooks）
  const loadSavedLayout = useCallback((savedLayout: WindowLayout, savedSubCursors: Record<string, SubCursorConfig>) => {
    // 先关闭所有运行中的 Cursor
    Object.keys(subCursors).forEach(subCursorId => {
      if (subCursors[subCursorId]?.isRunning) {
        window.electronAPI.closeCursor(subCursorId);
      }
    });
    
    // 加载新布局
    setLayout(savedLayout);
    setSubCursors(savedSubCursors);
    window.electronAPI.saveLayout(savedLayout);
    window.electronAPI.saveSubCursors(savedSubCursors);
  }, [subCursors]);

  // 切换 sub-cursor 最大化状态
  const toggleMaximizeSubCursor = useCallback(async (subCursorId: string) => {
    if (maximizedSubCursorId === subCursorId) {
      // 已经最大化，则还原
      setMaximizedSubCursorId(null);
      // 延迟显示所有嵌入窗口并更新位置（等待布局更新）
      setTimeout(async () => {
        await window.electronAPI.showAllEmbeddedWindows();
        // 更新所有运行中的 sub-cursor 窗口位置
        Object.keys(subCursors).forEach(id => {
          if (subCursors[id]?.isRunning) {
            const scEl = document.querySelector(`[data-sub-cursor-id="${id}"] .sub-cursor-content`);
            if (scEl) {
              const rect = scEl.getBoundingClientRect();
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
      // 最大化此 sub-cursor
      // 先隐藏所有嵌入窗口
      await window.electronAPI.hideAllEmbeddedWindows();
      setMaximizedSubCursorId(subCursorId);
      // 然后延迟更新最大化 sub-cursor 的窗口位置并显示
      setTimeout(async () => {
        if (subCursors[subCursorId]?.isRunning) {
          // 重新调整当前 sub-cursor 窗口的位置
          const scEl = document.querySelector(`[data-sub-cursor-id="${subCursorId}"] .sub-cursor-content`);
          if (scEl) {
            const rect = scEl.getBoundingClientRect();
            await window.electronAPI.resizeEmbeddedWindow(subCursorId, {
              x: Math.round(rect.left),
              y: Math.round(rect.top),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            });
            // 只显示当前 sub-cursor 的嵌入窗口
            await window.electronAPI.showEmbeddedWindow(subCursorId);
          }
        }
      }, 100);
    }
  }, [maximizedSubCursorId, subCursors]);

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
        onAddSubCursor={addSubCursor}
        onResetLayout={resetLayout}
        onApplyPreset={applyPresetLayout}
        onOpenSettings={() => setShowSettings(true)}
        currentLayout={layout}
        currentSubCursors={subCursors}
        onLoadLayout={loadSavedLayout}
      />
      
      <div className="layout-container">
        <SplitLayout
          layout={layout}
          subCursors={subCursors}
          onLayoutChange={handleLayoutChange}
          onOpenCursor={openCursor}
          onCloseCursor={closeCursor}
          onSelectFolder={selectFolder}
          onClearFolder={clearFolder}
          onRemoveSubCursor={removeSubCursor}
          onUpdateSubCursor={updateSubCursor}
          onSplitSubCursor={splitSubCursor}
          maximizedSubCursorId={maximizedSubCursorId}
          onToggleMaximize={toggleMaximizeSubCursor}
        />
      </div>

      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

// 辅助函数：获取所有 Sub Cursor ID
function getAllSubCursorIds(layout: WindowLayout): string[] {
  if (typeof layout === 'string') {
    return [layout];
  }
  return [...getAllSubCursorIds(layout.first), ...getAllSubCursorIds(layout.second)];
}

// 辅助函数：从布局中删除 Sub Cursor
function removeSubCursorFromLayout(layout: WindowLayout, subCursorId: string): WindowLayout | null {
  if (typeof layout === 'string') {
    return layout === subCursorId ? null : layout;
  }

  if (layout.first === subCursorId) {
    return layout.second;
  }
  if (layout.second === subCursorId) {
    return layout.first;
  }

  const newFirst = removeSubCursorFromLayout(layout.first, subCursorId);
  const newSecond = removeSubCursorFromLayout(layout.second, subCursorId);

  if (newFirst === null) return newSecond;
  if (newSecond === null) return newFirst;

  return {
    ...layout,
    first: newFirst,
    second: newSecond,
  };
}

export default App;
