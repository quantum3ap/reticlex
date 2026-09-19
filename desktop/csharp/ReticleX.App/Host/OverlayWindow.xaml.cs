using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using ReticleX.Core.Interop;
using ReticleX.Core.Models;

namespace ReticleX.App.Host;

/// <summary>
/// The reticle drawn over everything else.
/// </summary>
/// <remarks>
/// A transparent, click-through, always-on-top window that draws the current
/// crosshair and nothing else. It is a plain window sitting above other
/// windows: it does not attach to, read from, or alter any other process.
/// </remarks>
public partial class OverlayWindow : Window
{
    private readonly Action<string, Exception?>? _log;
    // Replaced with the real reticle before the window is ever shown; an
    // all-zero config simply draws nothing, which is the right thing to show
    // if that somehow does not happen.
    private CrosshairConfig _config;
    private double _scale = 1.0;

    /// <summary>
    /// Drives the pointer tracking when the overlay is set to follow it.
    /// Created on first use and stopped whenever it is not needed, so an
    /// overlay pinned to the centre of a monitor never runs a timer.
    /// </summary>
    private DispatcherTimer? _follow;
    private OverlayOptions _followOptions = OverlayOptions.Defaults();
    private MonitorInfo? _followMonitor;

    /// <summary>
    /// Where the window was last put, so a stationary pointer costs one
    /// GetCursorPos per tick and nothing else. int.MinValue means "unknown",
    /// which forces the next tick to place the window.
    /// </summary>
    private int _placedX = int.MinValue;
    private int _placedY = int.MinValue;

    /// <summary>
    /// How often the pointer is sampled. Sixty times a second matches the
    /// commonest display and is what the reticle can usefully be redrawn at;
    /// the window is only actually moved when the position has changed.
    /// </summary>
    private static readonly TimeSpan FollowInterval = TimeSpan.FromMilliseconds(16);

    public OverlayWindow(Action<string, Exception?>? log = null)
    {
        _log = log;
        InitializeComponent();
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        // Only once a handle exists can the window be told to ignore the mouse.
        ScreenInterop.MakeClickThrough(Handle);
    }

    public IntPtr Handle => new WindowInteropHelper(this).Handle;

    /// <summary>Renders a new configuration, keeping the current placement.</summary>
    public void SetConfig(CrosshairConfig config)
    {
        _config = config;
        Redraw();
    }

    /// <summary>
    /// Moves the window onto <paramref name="monitor"/> and re-renders at that
    /// monitor's pixel density.
    /// </summary>
    public void PlaceOn(MonitorInfo monitor, OverlayOptions options)
    {
        StopFollowing();

        var (x, y) = options.TopLeftFor(monitor.Left, monitor.Top, monitor.Width, monitor.Height);
        ScreenInterop.Place(Handle, x, y, OverlayOptions.CanvasSize, OverlayOptions.CanvasSize);
        UseScale(monitor.Scale);
    }

    /// <summary>
    /// Puts the reticle under the mouse pointer and keeps it there.
    /// </summary>
    /// <remarks>
    /// The position is polled rather than hooked. A low-level mouse hook would
    /// give a tighter result, but it is also the mechanism spyware uses and
    /// the mechanism anti-cheat software looks for, and ReticleX installs
    /// neither. Polling reads the position Windows already publishes and
    /// touches no other process. The cost is up to one interval of lag behind
    /// the hardware pointer, which the system draws itself.
    /// </remarks>
    public void FollowCursor(OverlayOptions options)
    {
        _followOptions = options;

        // Place once before the first tick, so switching the setting on does
        // not leave the reticle at the old spot for a frame.
        MoveToCursor();

        _follow ??= CreateFollowTimer();
        _follow.Start();
    }

    private DispatcherTimer CreateFollowTimer()
    {
        // Render priority, not Input: this must keep running while a game has
        // focus and nothing is being delivered to us.
        var timer = new DispatcherTimer(DispatcherPriority.Render, Dispatcher)
        {
            Interval = FollowInterval,
        };
        timer.Tick += (_, _) => MoveToCursor();
        return timer;
    }

    private void StopFollowing()
    {
        _follow?.Stop();
        _followMonitor = null;
        // The next placement must happen even if it lands on the same pixel.
        _placedX = int.MinValue;
        _placedY = int.MinValue;
    }

    private void MoveToCursor()
    {
        // There is no window to move until Show has made one. The controller
        // positions before and after Show, and recording a position the first
        // call could not actually apply would make the second call skip it.
        var handle = Handle;
        if (handle == IntPtr.Zero) return;

        var cursor = ScreenInterop.CursorPosition();
        // Windows declines on a locked or secure desktop. Leaving the reticle
        // where it is beats dropping it in a corner.
        if (cursor is not { } point) return;

        var (x, y) = _followOptions.TopLeftForCursor(point.X, point.Y);
        if (x == _placedX && y == _placedY) return;

        _placedX = x;
        _placedY = y;
        ScreenInterop.Place(handle, x, y, OverlayOptions.CanvasSize, OverlayOptions.CanvasSize);
        TrackScaleAt(point.X, point.Y);
    }

    /// <summary>
    /// Re-renders at the new density when the pointer crosses onto a display
    /// scaled differently. The monitor is only looked up when the pointer
    /// leaves the one already known, so the common case is a rectangle test.
    /// </summary>
    private void TrackScaleAt(int x, int y)
    {
        if (_followMonitor is { } known
            && x >= known.Left && x < known.Left + known.Width
            && y >= known.Top && y < known.Top + known.Height)
        {
            return;
        }

        var monitor = ScreenInterop.MonitorForPoint(x, y);
        if (monitor is null) return;

        _followMonitor = monitor;
        UseScale(monitor.Scale);
    }

    private void UseScale(double scale)
    {
        if (Math.Abs(_scale - scale) <= 0.001) return;
        _scale = scale;
        Redraw();
    }

    protected override void OnClosed(EventArgs e)
    {
        // A dispatcher timer outlives the window that started it, and this one
        // would go on moving a destroyed handle sixty times a second.
        StopFollowing();
        _follow = null;
        base.OnClosed(e);
    }

    private void Redraw()
    {
        if (!NativeCore.IsAvailable)
        {
            Reticle.Source = null;
            return;
        }

        try
        {
            const int size = OverlayOptions.CanvasSize;
            // Zoom 1: the reticle appears at exactly the size it was designed
            // at, one configuration pixel to one screen pixel.
            var rgba = NativeCore.Rasterize(_config, size, size, 1f);
            Reticle.Source = ToBitmap(rgba, size, size, _scale);
        }
        catch (Exception error)
        {
            _log?.Invoke("The overlay could not render the reticle.", error);
            Reticle.Source = null;
        }
    }

    /// <summary>
    /// Converts the core's straight-alpha RGBA into the premultiplied BGRA that
    /// WPF composites, tagging it with the monitor's DPI so an unscaled draw
    /// lands one bitmap pixel on one screen pixel.
    /// </summary>
    private static BitmapSource ToBitmap(byte[] rgba, int width, int height, double scale)
    {
        var bgra = new byte[rgba.Length];
        for (var i = 0; i < rgba.Length; i += 4)
        {
            var alpha = rgba[i + 3];
            bgra[i + 0] = (byte)(rgba[i + 2] * alpha / 255);
            bgra[i + 1] = (byte)(rgba[i + 1] * alpha / 255);
            bgra[i + 2] = (byte)(rgba[i + 0] * alpha / 255);
            bgra[i + 3] = alpha;
        }

        var dpi = 96.0 * (scale > 0.1 ? scale : 1.0);
        var bitmap = BitmapSource.Create(
            width, height, dpi, dpi, PixelFormats.Pbgra32, null, bgra, width * 4);
        bitmap.Freeze();
        return bitmap;
    }
}
