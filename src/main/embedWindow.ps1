# Windows Window Positioning Script
# No SetParent (to avoid Chromium input issues)
# Only remove borders and position window precisely
# Supports finding window by PID for precise matching

param(
    [Parameter(Mandatory=$true)]
    [string]$ChildWindowTitle,
    
    [Parameter(Mandatory=$true)]
    [long]$ParentHwnd,
    
    [Parameter(Mandatory=$true)]
    [int]$X,
    
    [Parameter(Mandatory=$true)]
    [int]$Y,
    
    [Parameter(Mandatory=$true)]
    [int]$Width,
    
    [Parameter(Mandatory=$true)]
    [int]$Height,
    
    [Parameter(Mandatory=$false)]
    [string]$ExcludeHwnds = "",
    
    [Parameter(Mandatory=$false)]
    [int]$TargetPid = 0
)

$code = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public class WindowHelper {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
    
    [DllImport("user32.dll", SetLastError = true)]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    
    [DllImport("user32.dll", SetLastError = true)]
    public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
    
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);
    
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }
    
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    public static extern IntPtr SetFocus(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    public static extern bool EnableWindow(IntPtr hWnd, bool bEnable);
    
    [DllImport("user32.dll")]
    public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
    
    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    
    public const int GWL_STYLE = -16;
    public const int GWL_EXSTYLE = -20;
    public const int GWLP_HWNDPARENT = -8;
    
    public const int WS_CAPTION = 0x00C00000;
    public const int WS_THICKFRAME = 0x00040000;
    public const int WS_BORDER = 0x00800000;
    public const int WS_SYSMENU = 0x00080000;
    public const int WS_MINIMIZEBOX = 0x00020000;
    public const int WS_MAXIMIZEBOX = 0x00010000;
    
    public const int WS_EX_APPWINDOW = 0x00040000;
    public const int WS_EX_TOOLWINDOW = 0x00000080;
    
    public const uint SWP_FRAMECHANGED = 0x0020;
    public const uint SWP_NOZORDER = 0x0004;
    public const uint SWP_NOMOVE = 0x0002;
    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_NOACTIVATE = 0x0010;
    
    public const int SW_SHOW = 5;
    public const int SW_SHOWNOACTIVATE = 4;
    
    private static List<IntPtr> windowList = new List<IntPtr>();
    private static string searchTitle = "";
    private static HashSet<long> excludeHwnds = new HashSet<long>();
    private static uint targetProcessId = 0;
    
    private static bool EnumWindowsCallback(IntPtr hWnd, IntPtr lParam) {
        long hwndValue = hWnd.ToInt64();
        if (excludeHwnds.Contains(hwndValue)) {
            return true;
        }
        
        if (IsWindowVisible(hWnd)) {
            StringBuilder sb = new StringBuilder(256);
            GetWindowText(hWnd, sb, 256);
            string title = sb.ToString();
            
            if (!string.IsNullOrEmpty(title) && title.Contains(searchTitle)) {
                StringBuilder classNameSb = new StringBuilder(256);
                GetClassName(hWnd, classNameSb, 256);
                string className = classNameSb.ToString();
                
                if (className == "Chrome_WidgetWin_1") {
                    windowList.Add(hWnd);
                }
            }
        }
        return true;
    }
    
    // Callback for finding window by PID
    private static bool EnumWindowsByPidCallback(IntPtr hWnd, IntPtr lParam) {
        long hwndValue = hWnd.ToInt64();
        if (excludeHwnds.Contains(hwndValue)) {
            return true;
        }
        
        if (IsWindowVisible(hWnd)) {
            uint processId;
            GetWindowThreadProcessId(hWnd, out processId);
            
            if (processId == targetProcessId) {
                StringBuilder sb = new StringBuilder(256);
                GetWindowText(hWnd, sb, 256);
                string title = sb.ToString();
                
                // Check if it's a Chromium window and title contains search term
                if (!string.IsNullOrEmpty(title) && title.Contains(searchTitle)) {
                    StringBuilder classNameSb = new StringBuilder(256);
                    GetClassName(hWnd, classNameSb, 256);
                    string className = classNameSb.ToString();
                    
                    if (className == "Chrome_WidgetWin_1") {
                        windowList.Add(hWnd);
                    }
                }
            }
        }
        return true;
    }
    
    // Find window by PID precisely
    public static IntPtr FindWindowByPid(uint pid, string titleContains, IntPtr parentToExclude, string excludeList) {
        windowList.Clear();
        searchTitle = titleContains;
        targetProcessId = pid;
        excludeHwnds.Clear();
        excludeHwnds.Add(parentToExclude.ToInt64());
        
        // Parse exclude list
        if (!string.IsNullOrEmpty(excludeList)) {
            foreach (string hwndStr in excludeList.Split(',')) {
                long hwnd;
                if (long.TryParse(hwndStr.Trim(), out hwnd)) {
                    excludeHwnds.Add(hwnd);
                }
            }
        }
        
        EnumWindows(EnumWindowsByPidCallback, IntPtr.Zero);
        if (windowList.Count > 0) {
            return windowList[0];
        }
        return IntPtr.Zero;
    }
    
    public static IntPtr FindWindowByTitle(string titleContains, IntPtr parentToExclude, string excludeList) {
        windowList.Clear();
        searchTitle = titleContains;
        excludeHwnds.Clear();
        excludeHwnds.Add(parentToExclude.ToInt64());
        
        // Parse exclude list
        if (!string.IsNullOrEmpty(excludeList)) {
            foreach (string hwndStr in excludeList.Split(',')) {
                long hwnd;
                if (long.TryParse(hwndStr.Trim(), out hwnd)) {
                    excludeHwnds.Add(hwnd);
                }
            }
        }
        
        EnumWindows(EnumWindowsCallback, IntPtr.Zero);
        if (windowList.Count > 0) {
            return windowList[0];
        }
        return IntPtr.Zero;
    }
    
    public static bool PositionWindow(IntPtr childHwnd, IntPtr parentHwnd, int x, int y, int width, int height) {
        if (childHwnd == IntPtr.Zero || parentHwnd == IntPtr.Zero) {
            return false;
        }
        
        if (childHwnd == parentHwnd) {
            return false;
        }
        
        // 1. Remove ALL borders and frame styles (aggressive removal for Chromium)
        int currentStyle = GetWindowLong(childHwnd, GWL_STYLE);
        // Remove: WS_CAPTION (title bar), WS_THICKFRAME (sizing border), WS_BORDER, 
        // WS_SYSMENU, WS_MINIMIZEBOX, WS_MAXIMIZEBOX, WS_DLGFRAME (dialog frame)
        int WS_DLGFRAME = 0x00400000;
        int WS_POPUP = unchecked((int)0x80000000);
        int newStyle = currentStyle & ~(WS_CAPTION | WS_THICKFRAME | WS_BORDER | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_DLGFRAME);
        // Add WS_POPUP for borderless behavior
        newStyle = newStyle | WS_POPUP;
        SetWindowLong(childHwnd, GWL_STYLE, newStyle);
        
        // 2. Set extended styles - remove window edge, client edge, static edge
        int currentExStyle = GetWindowLong(childHwnd, GWL_EXSTYLE);
        int WS_EX_WINDOWEDGE = 0x00000100;
        int WS_EX_CLIENTEDGE = 0x00000200;
        int WS_EX_STATICEDGE = 0x00020000;
        int WS_EX_DLGMODALFRAME = 0x00000001;
        int newExStyle = (currentExStyle & ~(WS_EX_APPWINDOW | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_STATICEDGE | WS_EX_DLGMODALFRAME)) | WS_EX_TOOLWINDOW;
        SetWindowLong(childHwnd, GWL_EXSTYLE, newExStyle);
        
        // 3. Set Owner (not Parent!) - so window will minimize with main window
        SetWindowLongPtr(childHwnd, GWLP_HWNDPARENT, parentHwnd);
        
        // 4. Apply style changes with redraw
        uint SWP_DRAWFRAME = 0x0020;
        SetWindowPos(childHwnd, IntPtr.Zero, 0, 0, 0, 0, 
            SWP_FRAMECHANGED | SWP_DRAWFRAME | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
        
        // 5. x and y are already screen coordinates (calculated by Electron's getContentBounds)
        // No need to use ClientToScreen anymore
        int screenX = x;
        int screenY = y;
        
        // 6. Move to correct position (screen coordinates) - use exact size
        MoveWindow(childHwnd, screenX, screenY, width, height, true);
        
        // 7. Force another SetWindowPos to ensure size is correct after style changes
        SetWindowPos(childHwnd, IntPtr.Zero, screenX, screenY, width, height, 
            SWP_NOZORDER | SWP_NOACTIVATE | SWP_DRAWFRAME);
        
        // 8. Show window (without activating)
        ShowWindow(childHwnd, SW_SHOWNOACTIVATE);
        
        // 9. Ensure window can receive input
        EnableWindow(childHwnd, true);
        
        return true;
    }
    
    public static void FocusWindow(IntPtr childHwnd) {
        if (childHwnd == IntPtr.Zero) return;
        EnableWindow(childHwnd, true);
        SetForegroundWindow(childHwnd);
        SetFocus(childHwnd);
    }
}
"@

try {
    Add-Type -TypeDefinition $code -ErrorAction Stop
} catch {
    if ($_.Exception.Message -notlike "*already exists*") {
        Write-Host "ERROR: Failed to add type: $($_.Exception.Message)"
        exit 1
    }
}

Write-Host "Looking for window: $ChildWindowTitle"
Write-Host "Excluding HWNDs: $ExcludeHwnds"
Write-Host "Target PID: $TargetPid"

$parentPtr = [IntPtr]$ParentHwnd
$childHwnd = [IntPtr]::Zero

# If PID is specified, search by PID first
if ($TargetPid -gt 0) {
    Write-Host "Searching by PID: $TargetPid"
    $childHwnd = [WindowHelper]::FindWindowByPid([uint32]$TargetPid, $ChildWindowTitle, $parentPtr, $ExcludeHwnds)
    
    if ($childHwnd -eq [IntPtr]::Zero) {
        Write-Host "No window found for PID $TargetPid, falling back to title search"
    } else {
        Write-Host "Found window by PID: $childHwnd"
    }
}

# If PID search failed or PID not specified, fall back to title search
if ($childHwnd -eq [IntPtr]::Zero) {
    $childHwnd = [WindowHelper]::FindWindowByTitle($ChildWindowTitle, $parentPtr, $ExcludeHwnds)
}

if ($childHwnd -eq [IntPtr]::Zero) {
    Write-Host "ERROR: Window not found"
    exit 1
}

if ($childHwnd.ToInt64() -eq $ParentHwnd) {
    Write-Host "ERROR: Found window is parent"
    exit 1
}

Write-Host "Found window: $childHwnd"
Write-Host "Parent HWND: $ParentHwnd"
Write-Host "Position: X=$X, Y=$Y, W=$Width, H=$Height"

$success = [WindowHelper]::PositionWindow($childHwnd, $parentPtr, $X, $Y, $Width, $Height)

if ($success) {
    Write-Host "SUCCESS: Window positioned (no SetParent, Owner only)"
    Write-Output $childHwnd.ToInt64()
    exit 0
} else {
    Write-Host "ERROR: Failed to position window"
    exit 1
}
