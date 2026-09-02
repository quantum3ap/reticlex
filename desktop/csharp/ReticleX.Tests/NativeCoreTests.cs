using ReticleX.Core.Interop;
using ReticleX.Core.Models;
using ReticleX.Core.Services;
using Xunit;

namespace ReticleX.Tests;

/// <summary>
/// Exercises the real native library.
/// </summary>
/// <remarks>
/// These are the tests that prove the managed struct and the C struct still
/// agree, so they need the real library rather than a stand-in. Build it
/// first: the CI workflow does, and scripts/build-native.ps1 does locally.
/// </remarks>
public class NativeCoreTests
{
    private static void RequireNativeCore()
    {
        Assert.True(
            NativeCore.IsAvailable,
            "reticlex_core was not found beside the test binary. Build it with "
            + "scripts/build-native.ps1 (or scripts/build-core.sh) and pass "
            + "-p:ReticleXNativeLibrary=<path> when building the tests.");
    }

    [Fact]
    public void ManagedAndNativeLayoutsAgree()
    {
        RequireNativeCore();
        // Throws with a precise message if any field name, type or offset moved.
        NativeCore.VerifyLayout();
        Assert.Equal(1, NativeCore.AbiVersion);
        Assert.Equal(1, NativeCore.SchemaVersion);
        Assert.Equal(48, NativeCore.ShapeSize);
        Assert.Equal(32, NativeCore.MaxShapes);
    }

    [Fact]
    public void NativeDefaultsMatchTheManagedFallback()
    {
        RequireNativeCore();
        var native = NativeCore.Defaults();
        var managed = CrosshairConfig.CreateDefault();

        // The managed copy exists so the host still works without the DLL; it
        // has to describe the same reticle.
        Assert.Equal(managed.Scale, native.Scale);
        Assert.Equal(managed.HLength, native.HLength);
        Assert.Equal(managed.HGap, native.HGap);
        Assert.Equal((double)managed.OutlineOpacity, native.OutlineOpacity, precision: 5);
        Assert.Equal((double)managed.ColorG, native.ColorG, precision: 5);
        Assert.Equal(CoreStatus.Ok, NativeCore.Validate(managed));
    }

    [Fact]
    public void NormalizeRepairsHostileValues()
    {
        RequireNativeCore();
        var config = CrosshairConfig.CreateDefault();
        config.Scale = 9999f;
        config.HLength = -40f;
        config.CapStyle = 77;
        config.DotEnabled = 5;

        var adjusted = NativeCore.Normalize(ref config);

        Assert.True(adjusted >= 4, $"expected several repairs, got {adjusted}");
        Assert.Equal(4f, config.Scale);
        Assert.Equal(0f, config.HLength);
        Assert.Equal(2, config.CapStyle);
        Assert.Equal(1, config.DotEnabled);
    }

    [Fact]
    public void NormalizeIsIdempotent()
    {
        RequireNativeCore();
        var config = CrosshairConfig.CreateDefault();
        config.Rotation = 900f;
        config.HThickness = 0.01f;
        NativeCore.Normalize(ref config);
        var once = config;
        Assert.Equal(0, NativeCore.Normalize(ref config));
        Assert.Equal(once, config);
    }

    [Fact]
    public void ValidateDistinguishesBrokenFromInvisible()
    {
        RequireNativeCore();
        var config = CrosshairConfig.CreateDefault();
        Assert.Equal(CoreStatus.Ok, NativeCore.Validate(config));

        config.SchemaVersion = 42;
        Assert.Equal(CoreStatus.Schema, NativeCore.Validate(config));

        config = CrosshairConfig.CreateDefault();
        config.HGap = 900f;
        Assert.Equal(CoreStatus.Range, NativeCore.Validate(config));

        config = CrosshairConfig.CreateDefault();
        config.HEnabled = 0;
        config.VEnabled = 0;
        config.DotEnabled = 0;
        Assert.Equal(CoreStatus.Empty, NativeCore.Validate(config));
    }

    [Fact]
    public void FingerprintsTrackContent()
    {
        RequireNativeCore();
        var a = CrosshairConfig.CreateDefault();
        var b = CrosshairConfig.CreateDefault();
        Assert.Equal(NativeCore.Fingerprint(a), NativeCore.Fingerprint(b));

        b.HLength += 1f;
        Assert.NotEqual(NativeCore.Fingerprint(a), NativeCore.Fingerprint(b));

        // A truthy flag and a canonical one describe the same reticle.
        var truthy = CrosshairConfig.CreateDefault();
        truthy.DotInheritColor = 7;
        Assert.Equal(NativeCore.Fingerprint(CrosshairConfig.CreateDefault()), NativeCore.Fingerprint(truthy));
    }

    [Fact]
    public void RandomizerIsReproducibleAndAlwaysUsable()
    {
        RequireNativeCore();
        var first = CrosshairConfig.CreateDefault();
        var second = CrosshairConfig.CreateDefault();
        NativeCore.Randomize(ref first, 4242, RandomFields.All, RandomStyle.Any);
        NativeCore.Randomize(ref second, 4242, RandomFields.All, RandomStyle.Any);
        Assert.Equal(first, second);

        for (uint seed = 1; seed <= 200; seed++)
        {
            var config = CrosshairConfig.CreateDefault();
            Assert.Equal(CoreStatus.Ok, NativeCore.Randomize(ref config, seed, RandomFields.All, RandomStyle.Any));
            Assert.Equal(CoreStatus.Ok, NativeCore.Validate(config));
        }
    }

    [Fact]
    public void RandomizerLeavesUnselectedFieldsAlone()
    {
        RequireNativeCore();
        var config = CrosshairConfig.CreateDefault();
        config.HLength = 13f;
        config.HGap = 9f;

        NativeCore.Randomize(ref config, 77, RandomFields.Color, RandomStyle.Classic);

        Assert.Equal(13f, config.HLength);
        Assert.Equal(9f, config.HGap);
    }

    [Fact]
    public void RasterisesAnImageWithAnEmptyGap()
    {
        RequireNativeCore();
        var config = CrosshairConfig.CreateDefault();
        config.OutlineEnabled = 0;
        config.HGap = 6f;
        config.HLength = 12f;

        var pixels = NativeCore.Rasterize(config, 64, 64, 2f);

        Assert.Equal(64 * 64 * 4, pixels.Length);
        Assert.Equal(0, Alpha(pixels, 64, 32, 32));
        Assert.True(Alpha(pixels, 64, 52, 32) > 200, "the arm should be opaque");
        Assert.Equal(0, Alpha(pixels, 64, 1, 1));
    }

    [Fact]
    public void RasteriseFitScalesToTheBuffer()
    {
        RequireNativeCore();
        var small = CrosshairConfig.CreateDefault();
        small.HLength = 3f;
        small.VLength = 3f;
        NativeCore.RasterizeFit(small, 64, 64, 6f, out var smallZoom);

        var large = CrosshairConfig.CreateDefault();
        large.HLength = 90f;
        large.VLength = 90f;
        var pixels = NativeCore.RasterizeFit(large, 64, 64, 6f, out var largeZoom);

        Assert.True(smallZoom > largeZoom);
        for (var x = 0; x < 64; x++)
        {
            Assert.Equal(0, Alpha(pixels, 64, x, 0));
        }
    }

    [Theory]
    [InlineData(0, 64)]
    [InlineData(64, 0)]
    [InlineData(2048, 64)]
    public void RasteriseRejectsImpossibleSizes(int width, int height)
    {
        RequireNativeCore();
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            NativeCore.Rasterize(CrosshairConfig.CreateDefault(), width, height, 1f));
    }

    [Fact]
    public void ContrastMatchesTheWcagAnchors()
    {
        RequireNativeCore();
        Assert.Equal(21d, NativeCore.Contrast(0x000000, 0xFFFFFF), precision: 1);
        Assert.Equal(1d, NativeCore.Contrast(0x777777, 0x777777), precision: 3);
    }

    [Fact]
    public void ThumbnailsAreWrittenAsRealPngs()
    {
        RequireNativeCore();
        using var workspace = new TempWorkspace();
        var thumbnails = new ThumbnailService(workspace.Paths);
        var document = new CrosshairDocument
        {
            Id = "cx_thumb",
            Config = CrosshairConfig.CreateDefault(),
        };

        Assert.True(thumbnails.Write(document));

        var path = workspace.Paths.ThumbnailFile("cx_thumb");
        Assert.True(File.Exists(path));
        var bytes = File.ReadAllBytes(path);
        Assert.Equal(0x89, bytes[0]);
        Assert.Equal((byte)'P', bytes[1]);
        Assert.True(bytes.Length > 100);
    }

    [Fact]
    public void SavingThroughTheLibraryNormalisesTheStoredConfiguration()
    {
        RequireNativeCore();
        using var workspace = new TempWorkspace();
        var config = CrosshairConfig.CreateDefault();
        config.Scale = 1e9f;
        config.HGap = -20f;

        workspace.Library.SaveCrosshair(new CrosshairDocument { Id = "cx_repair", Config = config });

        var loaded = Assert.Single(workspace.Library.LoadCrosshairs());
        Assert.Equal(4f, loaded.Config.Scale);
        Assert.Equal(0f, loaded.Config.HGap);
    }

    private static byte Alpha(byte[] pixels, int width, int x, int y) => pixels[(y * width + x) * 4 + 3];
}
