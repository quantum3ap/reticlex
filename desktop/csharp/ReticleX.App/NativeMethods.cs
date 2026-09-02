using System.Runtime.InteropServices;
using System.Text;

namespace ReticleX.App;

/// <summary>
/// The few Win32 calls a borderless window still needs.
/// </summary>
/// <remarks>
/// WebView2 renders into its own child window, so anything that depends on
/// hit-testing the client area — dragging the window by its custom title bar
/// above all — has to be asked of the window manager directly rather than
/// handled in WPF.
/// </remarks>
internal static class NativeMethods
{
    private const int WM_NCLBUTTONDOWN = 0x00A1;
    private const int HTCAPTION = 2;
    private const int SW_RESTORE = 9;

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindow(string? lpClassName, string? lpWindowName);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    /// <summary>
    /// Starts a window move as though the user had grabbed a real title bar.
    /// Called while the pointer is still down over the front end's drag strip.
    /// </summary>
    public static void BeginDrag(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return;
        ReleaseCapture();
        SendMessage(hwnd, WM_NCLBUTTONDOWN, new IntPtr(HTCAPTION), IntPtr.Zero);
    }

    /// <summary>Brings an already-running ReticleX to the front.</summary>
    public static void ActivateExistingInstance()
    {
        var existing = FindWindow(null, "ReticleX");
        if (existing == IntPtr.Zero) return;
        if (IsIconic(existing)) ShowWindow(existing, SW_RESTORE);
        SetForegroundWindow(existing);
    }
}
