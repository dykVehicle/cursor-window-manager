import React, { useState, useEffect } from 'react';

interface SettingsModalProps {
  onClose: () => void;
}

function SettingsModal({ onClose }: SettingsModalProps) {
  const [cursorPath, setCursorPath] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [pathValid, setPathValid] = useState<boolean | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const result = await window.electronAPI.detectCursorPath();
        setCursorPath(result.path);
        setPathValid(result.exists);
      } catch (error) {
        console.error('Failed to load settings:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, []);

  // 验证路径
  const validatePath = async (path: string) => {
    if (!path) {
      setPathValid(null);
      return;
    }
    setIsValidating(true);
    try {
      const valid = await window.electronAPI.validateCursorPath(path);
      setPathValid(valid);
    } catch {
      setPathValid(false);
    } finally {
      setIsValidating(false);
    }
  };

  // 路径改变时验证
  useEffect(() => {
    const timer = setTimeout(() => {
      validatePath(cursorPath);
    }, 500);
    return () => clearTimeout(timer);
  }, [cursorPath]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await window.electronAPI.setCursorPath(cursorPath);
      onClose();
    } catch (error) {
      console.error('Failed to save settings:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleBrowse = async () => {
    const result = await window.electronAPI.selectCursorFile();
    if (result) {
      setCursorPath(result);
    }
  };

  const handleAutoDetect = async () => {
    setIsValidating(true);
    try {
      const result = await window.electronAPI.detectCursorPath();
      setCursorPath(result.path);
      setPathValid(result.exists);
    } catch (error) {
      console.error('Failed to detect Cursor path:', error);
    } finally {
      setIsValidating(false);
    }
  };

  const handleReset = async () => {
    if (confirm('确定要重置所有配置吗？这将清除所有保存的布局和设置。')) {
      await window.electronAPI.resetConfig();
      window.location.reload();
    }
  };

  // 点击背景关闭
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">设置</h2>
          <button className="icon-button" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="modal-body">
          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>
              加载中...
            </div>
          ) : (
            <>
              <div className="setting-item">
                <label className="setting-label">Cursor 可执行文件路径</label>
                <div className="setting-input-group">
                  <input
                    type="text"
                    className="setting-input"
                    value={cursorPath}
                    onChange={(e) => setCursorPath(e.target.value)}
                    placeholder="输入 Cursor 可执行文件的路径"
                    style={{
                      borderColor: pathValid === true ? 'var(--accent-primary)' : 
                                   pathValid === false ? 'var(--accent-red)' : undefined
                    }}
                  />
                  <button className="btn-secondary" onClick={handleBrowse}>
                    浏览
                  </button>
                  <button className="btn-secondary" onClick={handleAutoDetect} disabled={isValidating}>
                    {isValidating ? '检测中...' : '自动检测'}
                  </button>
                </div>
                
                {/* 路径状态 */}
                <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {pathValid === true && (
                    <>
                      <CheckIcon />
                      <span style={{ color: 'var(--accent-primary)', fontSize: '12px' }}>
                        ✓ 路径有效，Cursor 已找到
                      </span>
                    </>
                  )}
                  {pathValid === false && (
                    <>
                      <span style={{ color: 'var(--accent-red)', fontSize: '12px' }}>
                        ✗ 路径无效，找不到 Cursor
                      </span>
                    </>
                  )}
                  {pathValid === null && cursorPath && (
                    <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                      验证中...
                    </span>
                  )}
                </div>
                
                <p className="setting-description">
                  指定 Cursor 编辑器的可执行文件位置。点击"自动检测"尝试自动查找。
                  <br />
                  Windows 默认: %LOCALAPPDATA%\Programs\cursor\Cursor.exe
                  <br />
                  Linux 默认: /usr/bin/cursor 或 ~/.local/bin/cursor
                </p>
              </div>

              <div className="setting-item">
                <label className="setting-label">调试日志</label>
                <button className="btn-secondary" onClick={() => window.electronAPI.openLogFolder()} style={{ marginTop: '8px' }}>
                  📁 打开日志文件夹
                </button>
                <p className="setting-description">
                  日志文件包含详细的运行信息，用于调试问题。
                </p>
              </div>

              <div className="setting-item">
                <label className="setting-label">重置配置</label>
                <button className="btn-secondary" onClick={handleReset} style={{ marginTop: '8px' }}>
                  <ResetIcon />
                  重置所有配置
                </button>
                <p className="setting-description">
                  清除所有保存的布局和设置，恢复到默认状态。
                </p>
              </div>

              <div className="setting-item">
                <label className="setting-label">关于</label>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                  <p><strong>Multi Cursor</strong> v1.0.0</p>
                  <p style={{ marginTop: '4px' }}>
                    一个 Cursor 多窗口管理工具，支持自由切分窗格和保存布局。
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={isSaving || isLoading}>
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
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

function ResetIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" width="16" height="16">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export default SettingsModal;
