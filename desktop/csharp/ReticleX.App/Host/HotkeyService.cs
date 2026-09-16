using System.Runtime.InteropServices;
using System.Windows.Interop;
using ReticleX.Core.Models;

namespace ReticleX.App.Host;

/// <summary>
/// Registers system-wide hotkeys by slot and reports which one was pressed.
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

    /// <summary>Ids handed to Windows. A slot is an offset from this.</summary>
    private const int FirstHotkeyId = 0xB19;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint virtualKey);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hwnd, int id);

    private readonly Action<int> _onPressed;
    private readonly Action<string, Exception?>? _log;
    private readonly Dictionary<int, HotkeyBinding> _bindings = new();
    private HwndSource? _source;

    /// <param name="onPressed">Called with the slot whose combination was pressed.</param>
    public HotkeyService(Action<int> onPressed, Action<string, Exception?>? log = null)
    {
        _onPressed = onPressed;
        _log = log;
    }

    /// <summary>The binding registered in a slot, or null when none is.</summary>
    public HotkeyBinding? Current(int slot) =>
        _bindings.TryGetValue(slot, out var binding) ? binding : null;

    /// <summary>
    /// Registers <paramref name="binding"/> in <paramref name="slot"/>,
    /// replacing whatever was there. Returns false when Windows refuses it —
    /// almost always because another application already owns that
    /// combination, and sometimes because another slot here does.
    /// </summary>
    public bool Apply(int slot, HotkeyBinding? binding)
    {
        Release(slot);
        if (binding is null) return false;

        var source = EnsureSource();
        if (source is null) return false;

        if (!RegisterHotKey(source.Handle, FirstHotkeyId + slot, (uint)binding.Modifiers, binding.VirtualKey))
        {
            var error = Marshal.GetLastWin32Error();
            _log?.Invoke($"Windows refused the hotkey {binding.Text} (error {error}).", null);
            return false;
        }

        _bindings[slot] = binding;
        return true;
    }

    /// <summary>Gives up one slot, leaving the combination to other applications.</summary>
    public void Release(int slot)
    {
        if (_bindings.Remove(slot) && _source is not null)
        {
            UnregisterHotKey(_source.Handle, FirstHotkeyId + slot);
        }
    }

    /// <summary>Gives up every slot.</summary>
    public void ReleaseAll()
    {
        foreach (var slot in _bindings.Keys.ToArray()) Release(slot);
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
        if (message != WM_HOTKEY) return IntPtr.Zero;

        var slot = wParam.ToInt32() - FirstHotkeyId;
        if (!_bindings.ContainsKey(slot)) return IntPtr.Zero;

        handled = true;
        try
        {
            _onPressed(slot);
        }
        catch (Exception error)
        {
            _log?.Invoke("The hotkey handler failed.", error);
        }
        return IntPtr.Zero;
    }

    public void Dispose()
    {
        ReleaseAll();
        _source?.RemoveHook(OnMessage);
        _source?.Dispose();
        _source = null;
    }
}
