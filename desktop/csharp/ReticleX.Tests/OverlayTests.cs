using ReticleX.Core.Models;
using Xunit;

namespace ReticleX.Tests;

public class HotkeyBindingTests
{
    [Theory]
    [InlineData("Ctrl+Shift+X", "Ctrl+Shift+X")]
    [InlineData("ctrl+shift+x", "Ctrl+Shift+X")]
    [InlineData("CONTROL + SHIFT + X", "Ctrl+Shift+X")]
    [InlineData("Shift+Ctrl+X", "Ctrl+Shift+X")]
    [InlineData("Alt+F9", "Alt+F9")]
    [InlineData("Win+Alt+Space", "Alt+Win+Space")]
    public void BindingsAreParsedIntoACanonicalForm(string input, string expected)
    {
        var binding = HotkeyBinding.TryParse(input);
        Assert.NotNull(binding);
        Assert.Equal(expected, binding.Text);
    }

    [Theory]
    [InlineData("Ctrl+Shift+X", 'X')]
    [InlineData("Ctrl+Shift+7", '7')]
    public void TheKeyBecomesItsVirtualKeyCode(string input, char expected)
    {
        Assert.Equal((uint)expected, HotkeyBinding.TryParse(input)!.VirtualKey);
    }

    [Theory]
    [InlineData("Ctrl+F1", 0x70u)]
    [InlineData("Ctrl+F12", 0x7Bu)]
    [InlineData("Ctrl+F24", 0x87u)]
    public void FunctionKeysCoverTheWholeRange(string input, uint expected)
    {
        Assert.Equal(expected, HotkeyBinding.TryParse(input)!.VirtualKey);
    }

    [Fact]
    public void ModifiersMapToTheValuesRegisterHotKeyExpects()
    {
        var binding = HotkeyBinding.TryParse("Ctrl+Alt+Shift+Win+X")!;
        Assert.Equal(
            HotkeyModifiers.Control | HotkeyModifiers.Alt
            | HotkeyModifiers.Shift | HotkeyModifiers.Windows,
            binding.Modifiers);
        Assert.Equal(0x000Fu, (uint)binding.Modifiers);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("X")]           // no modifier: Windows would swallow the key everywhere
    [InlineData("Ctrl")]        // modifier with nothing to press
    [InlineData("Ctrl+Shift")]
    [InlineData("Ctrl+X+Y")]    // two keys is a typo, not a chord
    [InlineData("Ctrl+F25")]
    [InlineData("Ctrl+F0")]
    [InlineData("Ctrl+Banana")]
    [InlineData("+++")]
    public void UnusableBindingsAreRefused(string? input)
    {
        Assert.Null(HotkeyBinding.TryParse(input));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("nonsense")]
    [InlineData("X")]
    public void ResolveFallsBackToTheDefault(string? input)
    {
        Assert.Equal(HotkeyBinding.Default, HotkeyBinding.Resolve(input).Text);
    }

    [Fact]
    public void ResolveKeepsAUsableBinding()
    {
        Assert.Equal("Alt+F10", HotkeyBinding.Resolve("alt+f10").Text);
    }
}

public class OverlayOptionsTests
{
    [Fact]
    public void DefaultsAreOffAndCentred()
    {
        var options = OverlayOptions.Defaults();
        Assert.False(options.Enabled);
        Assert.Equal(string.Empty, options.Monitor);
        Assert.Equal(0, options.OffsetX);
        Assert.Equal(0, options.OffsetY);
        Assert.Equal(HotkeyBinding.Default, options.Hotkey);
    }

    [Fact]
    public void OutOfRangeOffsetsAreClamped()
    {
        var options = new OverlayOptions { OffsetX = 999_999, OffsetY = -999_999 }.Sanitized();
        Assert.Equal(OverlayOptions.MaxOffset, options.OffsetX);
        Assert.Equal(-OverlayOptions.MaxOffset, options.OffsetY);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void AnEmptyMonitorMeansFollowTheWindow(string? monitor)
    {
        var options = new OverlayOptions { Monitor = monitor! }.Sanitized();
        Assert.Equal(string.Empty, options.Monitor);
    }

    [Fact]
    public void AnUnusableHotkeyIsReplacedRatherThanKept()
    {
        Assert.Equal(HotkeyBinding.Default, new OverlayOptions { Hotkey = "Q" }.Sanitized().Hotkey);
    }

    [Fact]
    public void WithChangesOnlyWhatItIsGiven()
    {
        var original = new OverlayOptions
        {
            Enabled = true,
            Monitor = @"\\.\DISPLAY2",
            OffsetX = 10,
            OffsetY = -20,
            Hotkey = "Alt+F9",
        };

        var updated = original.With(offsetX: 40);

        Assert.True(updated.Enabled);
        Assert.Equal(@"\\.\DISPLAY2", updated.Monitor);
        Assert.Equal(40, updated.OffsetX);
        Assert.Equal(-20, updated.OffsetY);
        Assert.Equal("Alt+F9", updated.Hotkey);
    }

    [Fact]
    public void WithSanitizesTheResult()
    {
        Assert.Equal(OverlayOptions.MaxOffset, OverlayOptions.Defaults().With(offsetY: 50_000).OffsetY);
    }

    [Fact]
    public void TheCanvasIsCentredOnTheMonitor()
    {
        var (x, y) = OverlayOptions.Defaults().TopLeftFor(0, 0, 1920, 1080);
        Assert.Equal(960 - (OverlayOptions.CanvasSize / 2), x);
        Assert.Equal(540 - (OverlayOptions.CanvasSize / 2), y);
    }

    [Fact]
    public void OffsetsMoveTheCanvasFromThatCentre()
    {
        var options = new OverlayOptions { OffsetX = 30, OffsetY = -45 }.Sanitized();
        var (x, y) = options.TopLeftFor(0, 0, 1920, 1080);
        Assert.Equal(960 - (OverlayOptions.CanvasSize / 2) + 30, x);
        Assert.Equal(540 - (OverlayOptions.CanvasSize / 2) - 45, y);
    }

    [Fact]
    public void ASecondMonitorIsPlacedInItsOwnCoordinateSpace()
    {
        // A display to the left of the primary has negative coordinates, which
        // is the case a naive width/2 calculation gets wrong.
        var (x, y) = OverlayOptions.Defaults().TopLeftFor(-2560, -200, 2560, 1440);
        Assert.Equal(-2560 + 1280 - (OverlayOptions.CanvasSize / 2), x);
        Assert.Equal(-200 + 720 - (OverlayOptions.CanvasSize / 2), y);
    }

    [Fact]
    public void FollowingTheCursorIsOffUntilItIsAskedFor()
    {
        Assert.False(OverlayOptions.Defaults().FollowCursor);
        Assert.True(OverlayOptions.Defaults().With(followCursor: true).FollowCursor);
    }

    [Fact]
    public void FollowingSurvivesSanitizingAndEveryOtherChange()
    {
        var options = new OverlayOptions { FollowCursor = true, OffsetX = 999_999 }.Sanitized();
        Assert.True(options.FollowCursor);
        Assert.True(options.With(offsetY: 12).FollowCursor);
        Assert.True(options.With(monitor: @"\\.\DISPLAY2").FollowCursor);
        Assert.False(options.With(followCursor: false).FollowCursor);
    }

    [Fact]
    public void TheCanvasIsCentredOnThePointer()
    {
        var (x, y) = OverlayOptions.Defaults().With(followCursor: true).TopLeftForCursor(1200, 800);
        Assert.Equal(1200 - (OverlayOptions.CanvasSize / 2), x);
        Assert.Equal(800 - (OverlayOptions.CanvasSize / 2), y);
    }

    [Fact]
    public void OffsetsMoveTheCanvasFromThePointerToo()
    {
        // Sitting the reticle just above the pointer is the reason the offsets
        // stay live while following, rather than being ignored.
        var options = new OverlayOptions { FollowCursor = true, OffsetX = 6, OffsetY = -18 }.Sanitized();
        var (x, y) = options.TopLeftForCursor(1200, 800);
        Assert.Equal(1200 - (OverlayOptions.CanvasSize / 2) + 6, x);
        Assert.Equal(800 - (OverlayOptions.CanvasSize / 2) - 18, y);
    }

    [Fact]
    public void APointerOnAMonitorLeftOfThePrimaryKeepsItsNegativeCoordinates()
    {
        var (x, y) = OverlayOptions.Defaults().TopLeftForCursor(-1400, -60);
        Assert.Equal(-1400 - (OverlayOptions.CanvasSize / 2), x);
        Assert.Equal(-60 - (OverlayOptions.CanvasSize / 2), y);
    }

    [Fact]
    public void ThePointerInACornerIsNotDraggedBackOnScreen()
    {
        // Half the canvas hangs off the desktop here, which is the point: the
        // reticle has to stay under the pointer when aiming into a corner.
        var (x, y) = OverlayOptions.Defaults().TopLeftForCursor(0, 0);
        Assert.Equal(-(OverlayOptions.CanvasSize / 2), x);
        Assert.Equal(-(OverlayOptions.CanvasSize / 2), y);
    }

    [Fact]
    public void TheTwoPlacementsAgreeWhenThePointerIsAtTheCentre()
    {
        // Switching the setting on with the pointer already in the middle of
        // the screen must not move the reticle.
        var options = new OverlayOptions { OffsetX = 7, OffsetY = -9 }.Sanitized();
        Assert.Equal(options.TopLeftFor(0, 0, 1920, 1080), options.TopLeftForCursor(960, 540));
    }
}
