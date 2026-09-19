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

    /// <summary>
    /// Steps the overlay to the next assigned profile. Empty means unset,
    /// which is the default: a second global hotkey is worth having only if
    /// someone has actually filled in the slots it moves between.
    /// </summary>
    public string CycleHotkey { get; init; } = string.Empty;

    /// <summary>
    /// Draws the reticle at the mouse pointer instead of at the centre of a
    /// monitor. Off by default, which is the placement every other setting
    /// here is written around.
    /// </summary>
    /// <remarks>
    /// This only changes where the overlay window is put. Nothing reads or
    /// moves the pointer: the position is asked for, the window follows it.
    /// </remarks>
    public bool FollowCursor { get; init; }

    public static OverlayOptions Defaults() => new();

    /// <summary>Clamps every field into a range the overlay can actually use.</summary>
    public OverlayOptions Sanitized() => new()
    {
        Enabled = Enabled,
        FollowCursor = FollowCursor,
        Monitor = string.IsNullOrWhiteSpace(Monitor) ? string.Empty : Monitor.Trim(),
        OffsetX = Math.Clamp(OffsetX, -MaxOffset, MaxOffset),
        OffsetY = Math.Clamp(OffsetY, -MaxOffset, MaxOffset),
        Hotkey = HotkeyBinding.Resolve(Hotkey).Text,
        CycleHotkey = string.IsNullOrWhiteSpace(CycleHotkey)
            ? string.Empty
            : HotkeyBinding.Resolve(CycleHotkey).Text,
    };

    public OverlayOptions With(
        bool? enabled = null,
        string? monitor = null,
        int? offsetX = null,
        int? offsetY = null,
        string? hotkey = null,
        string? cycleHotkey = null,
        bool? followCursor = null) => new OverlayOptions
        {
            Enabled = enabled ?? Enabled,
            FollowCursor = followCursor ?? FollowCursor,
            Monitor = monitor ?? Monitor,
            OffsetX = offsetX ?? OffsetX,
            OffsetY = offsetY ?? OffsetY,
            Hotkey = hotkey ?? Hotkey,
            CycleHotkey = cycleHotkey ?? CycleHotkey,
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

    /// <summary>
    /// Top-left corner, in physical pixels, that centres the canvas on the
    /// pointer and then applies the user's offset.
    /// </summary>
    /// <remarks>
    /// The result is deliberately not clamped to any monitor. Near a screen
    /// edge the canvas hangs off it, which is correct: the reticle belongs at
    /// the pointer, and a layered window partly outside the desktop is
    /// perfectly ordinary. Clamping would drag the reticle off the pointer
    /// exactly where aiming into a corner matters.
    /// </remarks>
    public (int X, int Y) TopLeftForCursor(int cursorX, int cursorY) =>
        (cursorX - (CanvasSize / 2) + OffsetX, cursorY - (CanvasSize / 2) + OffsetY);
}
