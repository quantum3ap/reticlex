using System.Runtime.InteropServices;

namespace ReticleX.App.Host;

/// <summary>One connected display, in physical pixels.</summary>
/// <param name="DeviceName">Stable identifier such as <c>\\.\DISPLAY1</c>.</param>
/// <param name="Scale">DPI scale factor: 1.0 at 96 DPI, 1.5 at 150%.</param>
public sealed record MonitorInfo(
    string DeviceName,
    int Left,
    int Top,
    int Width,
    int Height,
    bool IsPrimary,
    double Scale);

/// <summary>
/// The Win32 surface the overlay needs: where the monitors are, how to make a
/// window click-through, and how to place it in physical pixels.
/// </summary>
/// <remarks>
/// The overlay is positioned through <c>SetWindowPos</c> rather than WPF's
/// Left/Top because those are device-independent units resolved against
/// whichever monitor the window currently sits on — which is exactly the value
/// being changed. Physical pixels sidestep the circularity, and the bitmap is
/// given a matching DPI so the reticle still lands on whole pixels.
/// </remarks>
internal static class ScreenInterop
{
    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TRANSPARENT = 0x00000020;
    private const int WS_EX_LAYERED = 0x00080000;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_NOACTIVATE = 0x08000000;

    private static readonly IntPtr HWND_TOPMOST = new(-1);
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_SHOWWINDOW = 0x0040;

    private const int MONITOR_DEFAULTTONEAREST = 2;

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left, Top, Right, Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MONITORINFOEXW
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string szDevice;
    }

    // The third parameter is an LPRECT. It is taken as a raw pointer rather than
    // "ref RECT" so the callback can stay a lambda; the bounds are read back
    // from GetMonitorInfoW anyway, which also reports the work area and flags.
    private delegate bool MonitorEnumProc(IntPtr monitor, IntPtr dc, IntPtr rect, IntPtr data);

    [DllImport("user32.dll")]
    private static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonitorEnumProc callback, IntPtr data);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool GetMonitorInfoW(IntPtr monitor, ref MONITORINFOEXW info);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, int flags);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetWindowLongW(IntPtr hwnd, int index);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int SetWindowLongW(IntPtr hwnd, int index, int value);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(
        IntPtr hwnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);

    [DllImport("shcore.dll")]
    private static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint dpiX, out uint dpiY);

    /// <summary>Every connected display, primary first.</summary>
    public static IReadOnlyList<MonitorInfo> Monitors()
    {
        var found = new List<MonitorInfo>();

        // Held in a local so the delegate cannot be collected while the
        // unmanaged side is still calling back into it.
        MonitorEnumProc callback = (monitor, _, _, _) =>
        {
            var info = new MONITORINFOEXW { cbSize = Marshal.SizeOf<MONITORINFOEXW>() };
            if (GetMonitorInfoW(monitor, ref info))
            {
                found.Add(Describe(monitor, info));
            }
            return true;
        };

        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, callback, IntPtr.Zero);
        GC.KeepAlive(callback);

        found.Sort((a, b) => b.IsPrimary.CompareTo(a.IsPrimary));
        return found;
    }

    /// <summary>The display a window is mostly on, or null if it has none yet.</summary>
    public static MonitorInfo? MonitorForWindow(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return null;
        var monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if (monitor == IntPtr.Zero) return null;

        var info = new MONITORINFOEXW { cbSize = Marshal.SizeOf<MONITORINFOEXW>() };
        return GetMonitorInfoW(monitor, ref info) ? Describe(monitor, info) : null;
    }

    private static MonitorInfo Describe(IntPtr handle, MONITORINFOEXW info)
    {
        var scale = 1.0;
        // MDT_EFFECTIVE_DPI. Present since Windows 8.1; the manifest requires
        // 8.1 or newer, but a failure here only costs crispness, not function.
        if (GetDpiForMonitor(handle, 0, out var dpiX, out _) == 0 && dpiX > 0)
        {
            scale = dpiX / 96.0;
        }

        return new MonitorInfo(
            DeviceName: info.szDevice,
            Left: info.rcMonitor.Left,
            Top: info.rcMonitor.Top,
            Width: info.rcMonitor.Right - info.rcMonitor.Left,
            Height: info.rcMonitor.Bottom - info.rcMonitor.Top,
            IsPrimary: (info.dwFlags & 1) != 0,
            Scale: scale);
    }

    /// <summary>
    /// Makes a window invisible to the mouse and absent from Alt-Tab, and stops
    /// it ever taking focus. This is what lets the reticle sit over a game
    /// without intercepting a single click.
    /// </summary>
    public static void MakeClickThrough(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return;
        var style = GetWindowLongW(hwnd, GWL_EXSTYLE);
        SetWindowLongW(hwnd, GWL_EXSTYLE,
            style | WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE);
    }

    /// <summary>Places a window in physical pixels, on top, without activating it.</summary>
    public static void Place(IntPtr hwnd, int x, int y, int width, int height)
    {
        if (hwnd == IntPtr.Zero) return;
        SetWindowPos(hwnd, HWND_TOPMOST, x, y, width, height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }
}
