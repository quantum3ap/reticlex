using ReticleX.Core.Interop;
using ReticleX.Core.Models;

namespace ReticleX.Core.Services;

/// <summary>
/// Keeps a rendered PNG next to every saved crosshair.
/// </summary>
/// <remarks>
/// The thumbnails are what makes the Home page paint instantly on a cold start:
/// the front end can show them while the WebAssembly core is still warming up,
/// and the shell can use them for jump lists or a future overlay without
/// starting a browser at all. They are rendered by the native rasteriser, so
/// they match the on-screen preview pixel for pixel.
/// </remarks>
public sealed class ThumbnailService
{
    public const int Size = 160;
    private const float Margin = 14f;

    private readonly AppPaths _paths;
    private readonly Action<string, Exception?>? _log;

    public ThumbnailService(AppPaths paths, Action<string, Exception?>? log = null)
    {
        _paths = paths;
        _log = log;
    }

    /// <summary>
    /// Renders and stores one thumbnail. Failure is never fatal: a missing
    /// thumbnail costs a placeholder, not a save.
    /// </summary>
    public bool Write(CrosshairDocument document)
    {
        if (!NativeCore.IsAvailable) return false;

        try
        {
            var pixels = NativeCore.RasterizeFit(document.Config, Size, Size, Margin, out _);
            PngWriter.WriteFile(_paths.ThumbnailFile(document.Id), pixels, Size, Size);
            return true;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException
                                      or InvalidOperationException or ArgumentException)
        {
            _log?.Invoke($"Could not write a thumbnail for {document.Id}.", error);
            return false;
        }
    }
}
