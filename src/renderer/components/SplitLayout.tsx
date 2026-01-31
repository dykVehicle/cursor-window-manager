import React, { useCallback, useRef, useState, useEffect } from 'react';
import { WindowLayout, PaneConfig } from '../types';
import Pane from './Pane';

interface SplitLayoutProps {
  layout: WindowLayout;
  panes: Record<string, PaneConfig>;
  onLayoutChange: (layout: WindowLayout) => void;
  onOpenCursor: (paneId: string, bounds: { x: number; y: number; width: number; height: number }) => void;
  onCloseCursor: (paneId: string) => void;
  onSelectFolder: (paneId: string) => void;
  onClearFolder: (paneId: string) => void;
  onRemovePane: (paneId: string) => void;
  onUpdatePane: (paneId: string, config: Partial<PaneConfig>) => void;
  onSplitPane?: (paneId: string, direction: 'up' | 'down' | 'left' | 'right') => void;
  maximizedPaneId?: string | null;
  onToggleMaximize?: (paneId: string) => void;
}

interface SplitContainerProps extends SplitLayoutProps {
  parentLayout?: WindowLayout;
  position?: 'first' | 'second';
  onUpdateSplit?: (percentage: number) => void;
  onSplitPane?: (paneId: string, direction: 'up' | 'down' | 'left' | 'right') => void;
}

function SplitLayout(props: SplitLayoutProps) {
  const { layout, onSplitPane, maximizedPaneId, onToggleMaximize } = props;

  // 如果有 pane 被最大化，只渲染那个 pane
  if (maximizedPaneId) {
    return (
      <div className="split-pane maximized" style={{ flex: 1 }}>
        <Pane
          paneId={maximizedPaneId}
          config={props.panes[maximizedPaneId] || { id: maximizedPaneId }}
          onOpenCursor={(bounds) => props.onOpenCursor(maximizedPaneId, bounds)}
          onCloseCursor={() => props.onCloseCursor(maximizedPaneId)}
          onSelectFolder={() => props.onSelectFolder(maximizedPaneId)}
          onClearFolder={() => props.onClearFolder(maximizedPaneId)}
          onRemove={() => props.onRemovePane(maximizedPaneId)}
          onUpdateLabel={(label) => props.onUpdatePane(maximizedPaneId, { label })}
          onSplit={onSplitPane ? (dir) => onSplitPane(maximizedPaneId, dir) : undefined}
          isMaximized={true}
          onToggleMaximize={onToggleMaximize ? () => onToggleMaximize(maximizedPaneId) : undefined}
        />
      </div>
    );
  }

  // 如果是单个窗格
  if (typeof layout === 'string') {
    return (
      <div className="split-pane" style={{ flex: 1 }}>
        <Pane
          paneId={layout}
          config={props.panes[layout] || { id: layout }}
          onOpenCursor={(bounds) => props.onOpenCursor(layout, bounds)}
          onCloseCursor={() => props.onCloseCursor(layout)}
          onSelectFolder={() => props.onSelectFolder(layout)}
          onClearFolder={() => props.onClearFolder(layout)}
          onRemove={() => props.onRemovePane(layout)}
          onUpdateLabel={(label) => props.onUpdatePane(layout, { label })}
          onSplit={onSplitPane ? (dir) => onSplitPane(layout, dir) : undefined}
          isMaximized={false}
          onToggleMaximize={onToggleMaximize ? () => onToggleMaximize(layout) : undefined}
        />
      </div>
    );
  }

  // 嵌套分割布局
  return (
    <SplitContainer {...props} />
  );
}

function SplitContainer({
  layout,
  panes,
  onLayoutChange,
  onOpenCursor,
  onCloseCursor,
  onSelectFolder,
  onClearFolder,
  onRemovePane,
  onUpdatePane,
  onSplitPane,
  maximizedPaneId,
  onToggleMaximize,
}: SplitContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [splitPercentage, setSplitPercentage] = useState(50);

  // 如果是字符串，直接渲染Pane
  if (typeof layout === 'string') {
    return (
      <div className="split-pane" style={{ flex: 1 }}>
        <Pane
          paneId={layout}
          config={panes[layout] || { id: layout }}
          onOpenCursor={(bounds) => onOpenCursor(layout, bounds)}
          onCloseCursor={() => onCloseCursor(layout)}
          onSelectFolder={() => onSelectFolder(layout)}
          onClearFolder={() => onClearFolder(layout)}
          onRemove={() => onRemovePane(layout)}
          onUpdateLabel={(label) => onUpdatePane(layout, { label })}
          onSplit={onSplitPane ? (dir) => onSplitPane(layout, dir) : undefined}
          isMaximized={false}
          onToggleMaximize={onToggleMaximize ? () => onToggleMaximize(layout) : undefined}
        />
      </div>
    );
  }

  const { direction, first, second } = layout;
  const isHorizontal = direction === 'row';
  const currentPercentage = layout.splitPercentage ?? splitPercentage;

  // 初始化分割比例
  useEffect(() => {
    if (layout.splitPercentage !== undefined) {
      setSplitPercentage(layout.splitPercentage);
    }
  }, [layout.splitPercentage]);

  // 处理分割线拖动
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);

    const startPos = isHorizontal ? e.clientX : e.clientY;
    const container = containerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const containerSize = isHorizontal ? containerRect.width : containerRect.height;
    const startOffset = isHorizontal ? containerRect.left : containerRect.top;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const currentPos = isHorizontal ? moveEvent.clientX : moveEvent.clientY;
      const newPercentage = ((currentPos - startOffset) / containerSize) * 100;
      
      // 限制在10%-90%之间
      const clampedPercentage = Math.min(90, Math.max(10, newPercentage));
      setSplitPercentage(clampedPercentage);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      // 保存新的分割比例
      const newLayout: WindowLayout = {
        ...layout,
        splitPercentage,
      };
      onLayoutChange(newLayout);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [isHorizontal, layout, onLayoutChange, splitPercentage]);

  // 更新第一部分的布局
  const handleFirstLayoutChange = useCallback((newFirst: WindowLayout) => {
    onLayoutChange({
      ...layout,
      first: newFirst,
    });
  }, [layout, onLayoutChange]);

  // 更新第二部分的布局
  const handleSecondLayoutChange = useCallback((newSecond: WindowLayout) => {
    onLayoutChange({
      ...layout,
      second: newSecond,
    });
  }, [layout, onLayoutChange]);

  return (
    <div
      ref={containerRef}
      className={`split-container ${isHorizontal ? 'horizontal' : 'vertical'}`}
      style={{ userSelect: isDragging ? 'none' : 'auto' }}
    >
      {/* 第一部分 */}
      <div
        className="split-pane"
        style={{ flex: `0 0 ${currentPercentage}%` }}
      >
        <SplitLayout
          layout={first}
          panes={panes}
          onLayoutChange={handleFirstLayoutChange}
          onOpenCursor={onOpenCursor}
          onCloseCursor={onCloseCursor}
          onSelectFolder={onSelectFolder}
          onClearFolder={onClearFolder}
          onRemovePane={onRemovePane}
          onUpdatePane={onUpdatePane}
          onSplitPane={onSplitPane}
          maximizedPaneId={maximizedPaneId}
          onToggleMaximize={onToggleMaximize}
        />
      </div>

      {/* 分割线 */}
      <div
        className={`split-handle ${isHorizontal ? 'horizontal' : 'vertical'} ${isDragging ? 'dragging' : ''}`}
        onMouseDown={handleMouseDown}
      />

      {/* 第二部分 */}
      <div
        className="split-pane"
        style={{ flex: `0 0 ${100 - currentPercentage}%` }}
      >
        <SplitLayout
          layout={second}
          panes={panes}
          onLayoutChange={handleSecondLayoutChange}
          onOpenCursor={onOpenCursor}
          onCloseCursor={onCloseCursor}
          onSelectFolder={onSelectFolder}
          onClearFolder={onClearFolder}
          onRemovePane={onRemovePane}
          onUpdatePane={onUpdatePane}
          onSplitPane={onSplitPane}
          maximizedPaneId={maximizedPaneId}
          onToggleMaximize={onToggleMaximize}
        />
      </div>
    </div>
  );
}

export default SplitLayout;
