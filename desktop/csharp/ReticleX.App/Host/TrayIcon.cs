using System.Runtime.InteropServices;
using System.Windows.Interop;

namespace ReticleX.App.Host;

/// <summary>
/// The notification-area icon: a button for the overlay that is reachable while
/// a game has focus.
/// </summary>
/// <remarks>
/// A left click toggles the overlay, a right click opens a small menu. This is
/// what makes the overlay usable without learning a shortcut: minimise
/// ReticleX, play, and the icon is still one click away.
///
/// Built on Shell_NotifyIcon directly rather than by pulling Windows Forms into
/// a WPF application for one control. The callback window is the same hidden
/// pattern the hotkey uses.
/// </remarks>
public sealed class TrayIcon : IDisposable
{
    private const int WM_APP = 0x8000;
    private const int CallbackMessage = WM_APP + 17;
    private const int IconId = 1;

    private const int NIM_ADD = 0, NIM_MODIFY = 1, NIM_DELETE = 2, NIM_SETVERSION = 4;
    private const int NIF_MESSAGE = 0x01, NIF_ICON = 0x02, NIF_TIP = 0x04, NIF_SHOWTIP = 0x80;
    private const int NOTIFYICON_VERSION_4 = 4;

    private const int WM_LBUTTONUP = 0x0202;
    private const int WM_RBUTTONUP = 0x0205;
    private const int WM_CONTEXTMENU = 0x007B;
    private const int NIN_SELECT = 0x0400;
    private const int WM_NULL = 0x0000;
    private const int WM_COMMAND = 0x0111;

    private const int MF_STRING = 0x0000, MF_CHECKED = 0x0008, MF_SEPARATOR = 0x0800;
    private const int TPM_RIGHTBUTTON = 0x0002, TPM_RETURNCMD = 0x0100;

    private const int CmdToggleOverlay = 1;
    private const int CmdOpen = 2;
    private const int CmdExit = 3;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NOTIFYICONDATAW
    {
        public int cbSize;
        public IntPtr hWnd;
        public int uID;
        public int uFlags;
        public int uCallbackMessage;
        public IntPtr hIcon;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string szTip;

        public int dwState;
        public int dwStateMask;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string szInfo;

        public int uVersion;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
        public string szInfoTitle;

        public int dwInfoFlags;
        public Guid guidItem;
        public IntPtr hBalloonIcon;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X, Y; }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern bool Shell_NotifyIconW(int message, ref NOTIFYICONDATAW data);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr ExtractIconW(IntPtr instance, string exeFileName, int iconIndex);

    [DllImport("user32.dll")]
    private static extern IntPtr LoadIconW(IntPtr instance, IntPtr iconName);

    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr icon);

    [DllImport("user32.dll")]
    private static extern IntPtr CreatePopupMenu();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool AppendMenuW(IntPtr menu, int flags, int id, string? item);

    [DllImport("user32.dll")]
    private static extern bool DestroyMenu(IntPtr menu);

    [DllImport("user32.dll")]
    private static extern int TrackPopupMenu(
        IntPtr menu, int flags, int x, int y, int reserved, IntPtr hwnd, IntPtr rect);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT point);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern bool PostMessageW(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int RegisterWindowMessageW(string message);

    private readonly Action _onToggleOverlay;
    private readonly Action _onOpen;
    private readonly Action _onExit;
    private readonly Action<string, Exception?>? _log;

    private readonly int _taskbarCreated =
        RegisterWindowMessageW("TaskbarCreated");

    private HwndSource? _source;
    private IntPtr _icon;
    private bool _added;

    private string _tooltip = "ReticleX";
    private string _toggleLabel = "Show the overlay";
    private string _openLabel = "Open ReticleX";
    private string _exitLabel = "Exit";
    private bool _overlayOn;

    public TrayIcon(
        Action onToggleOverlay,
        Action onOpen,
        Action onExit,
        Action<string, Exception?>? log = null)
    {
        _onToggleOverlay = onToggleOverlay;
        _onOpen = onOpen;
        _onExit = onExit;
        _log = log;
    }

    /// <summary>Puts the icon in the notification area. Safe to call twice.</summary>
    public void Show()
    {
        if (_added) return;
        var source = EnsureSource();
        if (source is null) return;

        _icon = LoadAppIcon();
        var data = Describe(source.Handle);
        if (!Shell_NotifyIconW(NIM_ADD, ref data))
        {
            _log?.Invoke($"The tray icon could not be added (error {Marshal.GetLastWin32Error()}).", null);
            return;
        }

        // Version 4 gives richer callbacks and correct tooltip placement.
        var version = new NOTIFYICONDATAW
        {
            cbSize = Marshal.SizeOf<NOTIFYICONDATAW>(),
            hWnd = source.Handle,
            uID = IconId,
            uVersion = NOTIFYICON_VERSION_4,
            szTip = string.Empty,
            szInfo = string.Empty,
            szInfoTitle = string.Empty,
        };
        Shell_NotifyIconW(NIM_SETVERSION, ref version);
        _added = true;
    }

    /// <summary>
    /// Updates what the icon says. The menu labels come from the front end so
    /// the tray speaks the same language as the rest of the application.
    /// </summary>
    public void SetState(bool overlayOn, string tooltip, string toggleLabel, string openLabel, string exitLabel)
    {
        _overlayOn = overlayOn;
        if (!string.IsNullOrWhiteSpace(tooltip)) _tooltip = Trim(tooltip, 127);
        if (!string.IsNullOrWhiteSpace(toggleLabel)) _toggleLabel = Trim(toggleLabel, 80);
        if (!string.IsNullOrWhiteSpace(openLabel)) _openLabel = Trim(openLabel, 80);
        if (!string.IsNullOrWhiteSpace(exitLabel)) _exitLabel = Trim(exitLabel, 80);

        if (!_added || _source is null) return;
        var data = Describe(_source.Handle);
        Shell_NotifyIconW(NIM_MODIFY, ref data);
    }

    private static string Trim(string value, int max) =>
        value.Length <= max ? value : value[..max];

    private NOTIFYICONDATAW Describe(IntPtr hwnd) => new()
    {
        cbSize = Marshal.SizeOf<NOTIFYICONDATAW>(),
        hWnd = hwnd,
        uID = IconId,
        uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP | NIF_SHOWTIP,
        uCallbackMessage = CallbackMessage,
        hIcon = _icon,
        szTip = _tooltip,
        szInfo = string.Empty,
        szInfoTitle = string.Empty,
    };

    private IntPtr LoadAppIcon()
    {
        try
        {
            var path = Environment.ProcessPath;
            if (!string.IsNullOrEmpty(path))
            {
                var icon = ExtractIconW(IntPtr.Zero, path, 0);
                // ExtractIcon returns 1 rather than 0 when the file holds no icon.
                if (icon != IntPtr.Zero && icon != new IntPtr(1)) return icon;
            }
        }
        catch (Exception error)
        {
            _log?.Invoke("The application icon could not be read for the tray.", error);
        }
        return LoadIconW(IntPtr.Zero, new IntPtr(32512));   // IDI_APPLICATION
    }

    private HwndSource? EnsureSource()
    {
        if (_source is not null) return _source;
        try
        {
            // Not message-only: Explorer's TaskbarCreated broadcast does not
            // reach HWND_MESSAGE windows, and without it the icon would never
            // come back after Explorer restarts.
            var parameters = new HwndSourceParameters("ReticleX.Tray")
            {
                Width = 0,
                Height = 0,
                WindowStyle = 0,
            };
            _source = new HwndSource(parameters);
            _source.AddHook(OnMessage);
            return _source;
        }
        catch (Exception error)
        {
            _log?.Invoke("The tray window could not be created.", error);
            return null;
        }
    }

    private IntPtr OnMessage(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (message == _taskbarCreated && _taskbarCreated != 0)
        {
            // Explorer restarted and forgot every icon; put ours back.
            _added = false;
            Show();
            return IntPtr.Zero;
        }

        if (message == WM_COMMAND)
        {
            Invoke((int)(wParam.ToInt64() & 0xFFFF));
            handled = true;
            return IntPtr.Zero;
        }

        if (message != CallbackMessage) return IntPtr.Zero;

        // Under version 4 the event lives in the low word of lParam.
        var evt = (int)(lParam.ToInt64() & 0xFFFF);
        switch (evt)
        {
            case NIN_SELECT:
            case WM_LBUTTONUP:
                handled = true;
                Invoke(CmdToggleOverlay);
                break;
            case WM_CONTEXTMENU:
            case WM_RBUTTONUP:
                handled = true;
                ShowMenu(hwnd);
                break;
        }
        return IntPtr.Zero;
    }

    private void ShowMenu(IntPtr hwnd)
    {
        var menu = CreatePopupMenu();
        if (menu == IntPtr.Zero) return;

        try
        {
            AppendMenuW(menu, MF_STRING | (_overlayOn ? MF_CHECKED : 0), CmdToggleOverlay, _toggleLabel);
            AppendMenuW(menu, MF_SEPARATOR, 0, null);
            AppendMenuW(menu, MF_STRING, CmdOpen, _openLabel);
            AppendMenuW(menu, MF_STRING, CmdExit, _exitLabel);

            if (!GetCursorPos(out var point)) return;

            // Both calls are the documented dance for a menu owned by a hidden
            // window: without them it stays open after a click elsewhere.
            SetForegroundWindow(hwnd);
            var chosen = TrackPopupMenu(
                menu, TPM_RIGHTBUTTON | TPM_RETURNCMD, point.X, point.Y, 0, hwnd, IntPtr.Zero);
            PostMessageW(hwnd, WM_NULL, IntPtr.Zero, IntPtr.Zero);

            if (chosen != 0) Invoke(chosen);
        }
        catch (Exception error)
        {
            _log?.Invoke("The tray menu failed.", error);
        }
        finally
        {
            DestroyMenu(menu);
        }
    }

    private void Invoke(int command)
    {
        try
        {
            switch (command)
            {
                case CmdToggleOverlay: _onToggleOverlay(); break;
                case CmdOpen: _onOpen(); break;
                case CmdExit: _onExit(); break;
            }
        }
        catch (Exception error)
        {
            _log?.Invoke($"The tray command {command} failed.", error);
        }
    }

    public void Dispose()
    {
        if (_added && _source is not null)
        {
            var data = Describe(_source.Handle);
            Shell_NotifyIconW(NIM_DELETE, ref data);
            _added = false;
        }
        if (_icon != IntPtr.Zero)
        {
            DestroyIcon(_icon);
            _icon = IntPtr.Zero;
        }
        _source?.RemoveHook(OnMessage);
        _source?.Dispose();
        _source = null;
    }
}
