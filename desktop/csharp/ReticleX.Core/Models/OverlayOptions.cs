namespace ReticleX.Core.Models;

/// <summary>
/// Where and how the on-screen overlay draws.
/// </summary>
/// <remarks>
/// Kept beside the other models rather than in the shell so the rules about
/// what is a usable placement can be tested without a display attached. The
/// values arrive from the front end and from settings.json, both of which can
/// be edited by hand, so nothing here trusts its input.
/// </remarks>
public sealed class OverlayOptions
{
    /// <summary>
    /// How far the reticle may be nudged from the centre of a monitor, in
    /// physical pixels. Generous enough to reach the edge of an ultrawide,
    /// bounded so a bad value cannot park the overlay off-screen.
    /// </summary>
    public const int MaxOffset = 4000;

    /// <summary>Side of the square the overlay draws into, in physical pixels.</summary>
    public const int CanvasSize = 640;

    public bool Enabled { get; init; }

    /// <summary>
    /// The monitor's device name, or an empty string for "wherever the main
    /// window is". A name that no longer matches a connected display falls
    /// back to the same behaviour rather than failing.
    /// </summary>
    public string Monitor { get; init; } = string.Empty;

    public int OffsetX { get; init; }

    public int OffsetY { get; init; }

    public string Hotkey { get; init; } = HotkeyBinding.Default;

    public static OverlayOptions Defaults() => new();

    /// <summary>Clamps every field into a range the overlay can actually use.</summary>
    public OverlayOptions Sanitized() => new()
    {
        Enabled = Enabled,
        Monitor = string.IsNullOrWhiteSpace(Monitor) ? string.Empty : Monitor.Trim(),
        OffsetX = Math.Clamp(OffsetX, -MaxOffset, MaxOffset),
        OffsetY = Math.Clamp(OffsetY, -MaxOffset, MaxOffset),
        Hotkey = HotkeyBinding.Resolve(Hotkey).Text,
    };

    public OverlayOptions With(
        bool? enabled = null,
        string? monitor = null,
        int? offsetX = null,
        int? offsetY = null,
        string? hotkey = null) => new OverlayOptions
        {
            Enabled = enabled ?? Enabled,
            Monitor = monitor ?? Monitor,
            OffsetX = offsetX ?? OffsetX,
            OffsetY = offsetY ?? OffsetY,
            Hotkey = hotkey ?? Hotkey,
        }.Sanitized();

    /// <summary>
    /// Top-left corner, in physical pixels, that centres the canvas on the
    /// given monitor bounds and then applies the user's offset.
    /// </summary>
    public (int X, int Y) TopLeftFor(int monitorLeft, int monitorTop, int monitorWidth, int monitorHeight)
    {
        var centreX = monitorLeft + (monitorWidth / 2);
        var centreY = monitorTop + (monitorHeight / 2);
        return (centreX - (CanvasSize / 2) + OffsetX, centreY - (CanvasSize / 2) + OffsetY);
    }
}
