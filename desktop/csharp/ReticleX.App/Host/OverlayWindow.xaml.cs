using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
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
        var (x, y) = options.TopLeftFor(monitor.Left, monitor.Top, monitor.Width, monitor.Height);
        ScreenInterop.Place(Handle, x, y, OverlayOptions.CanvasSize, OverlayOptions.CanvasSize);

        if (Math.Abs(_scale - monitor.Scale) > 0.001)
        {
            _scale = monitor.Scale;
            Redraw();
        }
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
