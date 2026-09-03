using System.Runtime.InteropServices;
using System.Windows.Interop;
using ReticleX.Core.Models;

namespace ReticleX.App.Host;

/// <summary>
/// Registers one system-wide hotkey and reports when it is pressed.
/// </summary>
/// <remarks>
/// A global hotkey needs a window to deliver WM_HOTKEY to, but not a visible
/// one, so this owns a message-only window of its own. Keeping it separate
/// from the main window means the hotkey keeps working while the interface is
/// minimised, which is the whole point of it — the user is in a game, not
/// looking at ReticleX.
///
/// This registers a key with Windows and listens for it. It does not read the
/// keyboard: keystrokes that are not the registered combination never reach
/// this process at all.
/// </remarks>
public sealed class HotkeyService : IDisposable
{
    private const int WM_HOTKEY = 0x0312;
    private const int HWND_MESSAGE = -3;
    private const int HotkeyId = 0xB19;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint virtualKey);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hwnd, int id);

    private readonly Action _onPressed;
    private readonly Action<string, Exception?>? _log;
    private HwndSource? _source;
    private bool _registered;

    public HotkeyService(Action onPressed, Action<string, Exception?>? log = null)
    {
        _onPressed = onPressed;
        _log = log;
    }

    /// <summary>The binding currently registered, or null when none is.</summary>
    public HotkeyBinding? Current { get; private set; }

    /// <summary>
    /// Registers <paramref name="binding"/>, replacing whatever was registered
    /// before. Returns false when Windows refuses it — almost always because
    /// another application already owns that combination.
    /// </summary>
    public bool Apply(HotkeyBinding? binding)
    {
        Release();
        if (binding is null) return false;

        var source = EnsureSource();
        if (source is null) return false;

        if (!RegisterHotKey(source.Handle, HotkeyId, (uint)binding.Modifiers, binding.VirtualKey))
        {
            var error = Marshal.GetLastWin32Error();
            _log?.Invoke($"Windows refused the hotkey {binding.Text} (error {error}).", null);
            return false;
        }

        _registered = true;
        Current = binding;
        return true;
    }

    /// <summary>Gives up the hotkey, leaving the combination to other applications.</summary>
    public void Release()
    {
        if (_registered && _source is not null)
        {
            UnregisterHotKey(_source.Handle, HotkeyId);
        }
        _registered = false;
        Current = null;
    }

    private HwndSource? EnsureSource()
    {
        if (_source is not null) return _source;

        try
        {
            var parameters = new HwndSourceParameters("ReticleX.Hotkey")
            {
                // A message-only window: never shown, never in the task bar,
                // and cheap enough that it costs nothing to keep alive.
                ParentWindow = new IntPtr(HWND_MESSAGE),
                Width = 0,
                Height = 0,
            };
            _source = new HwndSource(parameters);
            _source.AddHook(OnMessage);
            return _source;
        }
        catch (Exception error)
        {
            _log?.Invoke("Could not create the hotkey window.", error);
            return null;
        }
    }

    private IntPtr OnMessage(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (message != WM_HOTKEY || wParam.ToInt32() != HotkeyId) return IntPtr.Zero;

        handled = true;
        try
        {
            _onPressed();
        }
        catch (Exception error)
        {
            _log?.Invoke("The hotkey handler failed.", error);
        }
        return IntPtr.Zero;
    }

    public void Dispose()
    {
        Release();
        _source?.RemoveHook(OnMessage);
        _source?.Dispose();
        _source = null;
    }
}
