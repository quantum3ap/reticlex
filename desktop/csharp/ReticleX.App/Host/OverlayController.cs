using System.Windows;
using ReticleX.Core.Interop;
using ReticleX.Core.Models;

namespace ReticleX.App.Host;

/// <summary>
/// Owns the on-screen overlay: its window, its placement, and the hotkey that
/// toggles it.
/// </summary>
/// <remarks>
/// The window is created lazily and destroyed when the overlay is switched
/// off, so a user who never turns it on pays nothing for it. Everything here
/// runs on the UI thread; the hotkey arrives there already, because the
/// message-only window that receives it belongs to the same dispatcher.
/// </remarks>
public sealed class OverlayController : IDisposable
{
    private readonly Action<string, Exception?>? _log;
    private readonly HotkeyService _hotkey;
    private OverlayWindow? _window;
    private CrosshairConfig _config;
    private bool _hasConfig;
    private bool _hotkeyRegistered;

    public OverlayController(Action<string, Exception?>? log = null)
    {
        _log = log;
        _hotkey = new HotkeyService(() => Toggle(), log);
    }

    /// <summary>Raised whenever the overlay turns on or off by any route.</summary>
    public event Action<OverlayOptions>? Changed;

    public OverlayOptions Options { get; private set; } = OverlayOptions.Defaults();

    /// <summary>True when the platform can host an overlay at all.</summary>
    public bool Supported => NativeCore.IsAvailable;

    /// <summary>False when Windows refused the chosen hotkey to another owner.</summary>
    public bool HotkeyRegistered => _hotkeyRegistered;

    /// <summary>
    /// Applies a change requested by the interface. This is also how stored
    /// preferences are restored at start-up: the front end owns settings.json,
    /// so it replays them once the page has booted.
    /// </summary>
    public OverlayOptions Update(OverlayOptions options) => Apply(options.Sanitized(), notify: false);

    /// <summary>Pushes a new reticle into an overlay that is already showing.</summary>
    public void SetConfig(CrosshairConfig config)
    {
        _config = config;
        _hasConfig = true;
        _window?.SetConfig(config);
    }

    /// <summary>Flips the overlay, which is what the global hotkey does.</summary>
    public void Toggle()
    {
        Apply(Options.With(enabled: !Options.Enabled), notify: true);
    }

    /// <summary>Every connected display, for the monitor picker.</summary>
    public IReadOnlyList<MonitorInfo> Monitors()
    {
        try
        {
            return ScreenInterop.Monitors();
        }
        catch (Exception error)
        {
            _log?.Invoke("The displays could not be enumerated.", error);
            return Array.Empty<MonitorInfo>();
        }
    }

    private OverlayOptions Apply(OverlayOptions options, bool notify)
    {
        var wasEnabled = Options.Enabled;
        Options = options;

        SyncHotkey(options.Hotkey);

        if (options.Enabled && Supported) Show();
        else Hide();

        if (notify || wasEnabled != options.Enabled) Changed?.Invoke(Options);
        return Options;
    }

    private void SyncHotkey(string text)
    {
        var binding = HotkeyBinding.TryParse(text);
        if (binding is not null && binding.Text == _hotkey.Current?.Text) return;
        _hotkeyRegistered = _hotkey.Apply(binding);
    }

    private void Show()
    {
        try
        {
            _window ??= CreateWindow();
            if (_hasConfig) _window.SetConfig(_config);

            var monitor = ResolveMonitor();
            if (monitor is not null) _window.PlaceOn(monitor, Options);

            if (!_window.IsVisible) _window.Show();
            // Re-assert placement after Show: WPF may have moved the window
            // onto whichever monitor it thought was appropriate.
            if (monitor is not null) _window.PlaceOn(monitor, Options);
        }
        catch (Exception error)
        {
            _log?.Invoke("The overlay could not be shown.", error);
            Hide();
            Options = Options.With(enabled: false);
        }
    }

    private OverlayWindow CreateWindow()
    {
        var window = new OverlayWindow(_log);
        // Nothing about the overlay should keep the application alive, and
        // closing it from elsewhere must not leave a stale reference behind.
        window.Closed += (_, _) => _window = null;
        return window;
    }

    private void Hide()
    {
        if (_window is null) return;
        try
        {
            _window.Close();
        }
        catch (Exception error)
        {
            _log?.Invoke("The overlay could not be closed cleanly.", error);
        }
        _window = null;
    }

    /// <summary>
    /// The configured monitor, or the one holding the main window, or the
    /// primary. A display that has been unplugged falls through to the next.
    /// </summary>
    private MonitorInfo? ResolveMonitor()
    {
        var monitors = Monitors();
        if (monitors.Count == 0) return null;

        if (!string.IsNullOrEmpty(Options.Monitor))
        {
            foreach (var monitor in monitors)
            {
                if (string.Equals(monitor.DeviceName, Options.Monitor, StringComparison.Ordinal))
                {
                    return monitor;
                }
            }
        }

        var main = Application.Current?.MainWindow;
        if (main is not null)
        {
            var handle = new System.Windows.Interop.WindowInteropHelper(main).Handle;
            var current = ScreenInterop.MonitorForWindow(handle);
            if (current is not null) return current;
        }

        return monitors[0];
    }

    public void Dispose()
    {
        Hide();
        _hotkey.Dispose();
    }
}
