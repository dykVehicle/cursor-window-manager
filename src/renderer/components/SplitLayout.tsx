import React, { useCallback, useRef, useState, useEffect } from 'react';
import { WindowLayout, SubCursorConfig } from '../types';
import SubCursor from './SubCursor';

interface SplitLayoutProps {
  layout: WindowLayout;
  subCursors: Record<string, SubCursorConfig>;
  onLayoutChange: (layout: WindowLayout) => void;
  onOpenCursor: (subCursorId: string, bounds: { x: number; y: number; width: number; height: number }) => void;
  onCloseCursor: (subCursorId: string) => void;
  onSelectFolder: (subCursorId: string) => void;
  onClearFolder: (subCursorId: string) => void;
  onRemoveSubCursor: (subCursorId: string) => void;
  onUpdateSubCursor: (subCursorId: string, config: Partial<SubCursorConfig>) => void;
  onSplitSubCursor?: (subCursorId: string, direction: 'up' | 'down' | 'left' | 'right') => void;
  maximizedSubCursorId?: string | null;
  onToggleMaximize?: (subCursorId: string) => void;
}

interface SplitContainerProps extends SplitLayoutProps {
  parentLayout?: WindowLayout;
  position?: 'first' | 'second';
  onUpdateSplit?: (percentage: number) => void;
  onSplitSubCursor?: (subCursorId: string, direction: 'up' | 'down' | 'left' | 'right') => void;
}

function SplitLayout(props: SplitLayoutProps) {
  const { layout, onSplitSubCursor, maximizedSubCursorId, onToggleMaximize } = props;

  // 如果有 sub-cursor 被最大化，只渲染那个 sub-cursor
  if (maximizedSubCursorId) {
    return (
      <div className="split-pane maximized" style={{ flex: 1 }}>
        <SubCursor
          subCursorId={maximizedSubCursorId}
          config={props.subCursors[maximizedSubCursorId] || { id: maximizedSubCursorId }}
          onOpenCursor={(bounds) => props.onOpenCursor(maximizedSubCursorId, bounds)}
          onCloseCursor={() => props.onCloseCursor(maximizedSubCursorId)}
          onSelectFolder={() => props.onSelectFolder(maximizedSubCursorId)}
          onClearFolder={() => props.onClearFolder(maximizedSubCursorId)}
          onRemove={() => props.onRemoveSubCursor(maximizedSubCursorId)}
          onUpdateLabel={(label) => props.onUpdateSubCursor(maximizedSubCursorId, { label })}
          onSplit={onSplitSubCursor ? (dir) => onSplitSubCursor(maximizedSubCursorId, dir) : undefined}
          isMaximized={true}
          onToggleMaximize={onToggleMaximize ? () => onToggleMaximize(maximizedSubCursorId) : undefined}
        />
      </div>
    );
  }

  // 如果是单个 sub-cursor
  if (typeof layout === 'string') {
    return (
      <div className="split-pane" style={{ flex: 1 }}>
        <SubCursor
          subCursorId={layout}
          config={props.subCursors[layout] || { id: layout }}
          onOpenCursor={(bounds) => props.onOpenCursor(layout, bounds)}
          onCloseCursor={() => props.onCloseCursor(layout)}
          onSelectFolder={() => props.onSelectFolder(layout)}
          onClearFolder={() => props.onClearFolder(layout)}
          onRemove={() => props.onRemoveSubCursor(layout)}
          onUpdateLabel={(label) => props.onUpdateSubCursor(layout, { label })}
          onSplit={onSplitSubCursor ? (dir) => onSplitSubCursor(layout, dir) : undefined}
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
  subCursors,
  onLayoutChange,
  onOpenCursor,
  onCloseCursor,
  onSelectFolder,
  onClearFolder,
  onRemoveSubCursor,
  onUpdateSubCursor,
  onSplitSubCursor,
  maximizedSubCursorId,
  onToggleMaximize,
}: SplitContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [splitPercentage, setSplitPercentage] = useState(50);

  // 如果是字符串，直接渲染 SubCursor
  if (typeof layout === 'string') {
    return (
      <div className="split-pane" style={{ flex: 1 }}>
        <SubCursor
          subCursorId={layout}
          config={subCursors[layout] || { id: layout }}
          onOpenCursor={(bounds) => onOpenCursor(layout, bounds)}
          onCloseCursor={() => onCloseCursor(layout)}
          onSelectFolder={() => onSelectFolder(layout)}
          onClearFolder={() => onClearFolder(layout)}
          onRemove={() => onRemoveSubCursor(layout)}
          onUpdateLabel={(label) => onUpdateSubCursor(layout, { label })}
          onSplit={onSplitSubCursor ? (dir) => onSplitSubCursor(layout, dir) : undefined}
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
          subCursors={subCursors}
          onLayoutChange={handleFirstLayoutChange}
          onOpenCursor={onOpenCursor}
          onCloseCursor={onCloseCursor}
          onSelectFolder={onSelectFolder}
          onClearFolder={onClearFolder}
          onRemoveSubCursor={onRemoveSubCursor}
          onUpdateSubCursor={onUpdateSubCursor}
          onSplitSubCursor={onSplitSubCursor}
          maximizedSubCursorId={maximizedSubCursorId}
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
          subCursors={subCursors}
          onLayoutChange={handleSecondLayoutChange}
          onOpenCursor={onOpenCursor}
          onCloseCursor={onCloseCursor}
          onSelectFolder={onSelectFolder}
          onClearFolder={onClearFolder}
          onRemoveSubCursor={onRemoveSubCursor}
          onUpdateSubCursor={onUpdateSubCursor}
          onSplitSubCursor={onSplitSubCursor}
          maximizedSubCursorId={maximizedSubCursorId}
          onToggleMaximize={onToggleMaximize}
        />
      </div>
    </div>
  );
}

export default SplitLayout;
