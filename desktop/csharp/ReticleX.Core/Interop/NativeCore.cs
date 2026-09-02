using System.Runtime.InteropServices;
using ReticleX.Core.Models;

namespace ReticleX.Core.Interop;

/// <summary>
/// P/Invoke surface for <c>reticlex_core</c>.
/// </summary>
/// <remarks>
/// The same library the front end loads as WebAssembly is loaded here as a
/// native DLL, which is what lets the host validate an imported file and
/// render a thumbnail with exactly the behaviour the preview showed.
/// Every entry point is total: none of them throw on hostile input, so callers
/// only have to check the returned status.
/// </remarks>
public static class NativeCore
{
    private const string Library = "reticlex_core";

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int rx_abi_version();

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int rx_config_schema();

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int rx_config_size();

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int rx_config_fields();

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int rx_shape_size();

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int rx_max_shapes();

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int rx_field_type_at(int index);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr rx_field_name_at(int index);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern void rx_config_defaults(ref CrosshairConfig config);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int rx_config_normalize(ref CrosshairConfig config);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int rx_config_validate(ref CrosshairConfig config);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern ulong rx_config_fingerprint(ref CrosshairConfig config);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int rx_randomize(ref CrosshairConfig config, uint seed, int fieldMask, int style);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int rx_rasterize(
        ref CrosshairConfig config, int width, int height, float zoom, byte[] outRgba);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int rx_rasterize_fit(
        ref CrosshairConfig config, int width, int height, float margin, byte[] outRgba, ref float outZoom);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern float rx_color_contrast(uint aHex, uint bHex);

    private static bool? _available;

    /// <summary>
    /// True when the native library loaded and reported the layout this
    /// assembly was compiled against. Checked once; the result is cached.
    /// </summary>
    public static bool IsAvailable
    {
        get
        {
            _available ??= Probe();
            return _available.Value;
        }
    }

    private static bool Probe()
    {
        try
        {
            VerifyLayout();
            return true;
        }
        catch (DllNotFoundException)
        {
            return false;
        }
        catch (EntryPointNotFoundException)
        {
            return false;
        }
        catch (BadImageFormatException)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
    }

    /// <summary>Native ABI version. Throws if the library cannot be loaded.</summary>
    public static int AbiVersion => rx_abi_version();

    /// <summary>Configuration schema version understood by the native core.</summary>
    public static int SchemaVersion => rx_config_schema();

    /// <summary>
    /// Confirms the native struct layout matches this assembly's.
    /// </summary>
    /// <exception cref="InvalidOperationException">
    /// Thrown when the DLL beside the executable was built from different
    /// sources; continuing would corrupt every call.
    /// </exception>
    public static void VerifyLayout()
    {
        if (rx_abi_version() != 1)
        {
            throw new InvalidOperationException(
                $"reticlex_core reports ABI {rx_abi_version()}, expected 1.");
        }

        var nativeSize = rx_config_size();
        var managedSize = Marshal.SizeOf<CrosshairConfig>();
        if (nativeSize != managedSize)
        {
            throw new InvalidOperationException(
                $"rx_config is {nativeSize} bytes, CrosshairConfig is {managedSize}.");
        }

        if (rx_config_fields() != CrosshairConfig.FieldCount)
        {
            throw new InvalidOperationException(
                $"rx_config has {rx_config_fields()} fields, expected {CrosshairConfig.FieldCount}.");
        }

        for (var i = 0; i < CrosshairConfig.FieldCount; i++)
        {
            var name = Marshal.PtrToStringAnsi(rx_field_name_at(i));
            if (name != CrosshairConfig.FieldNames[i])
            {
                throw new InvalidOperationException(
                    $"Field {i} is \"{name}\" natively but \"{CrosshairConfig.FieldNames[i]}\" here.");
            }

            var isInteger = rx_field_type_at(i) == 0;
            if (isInteger != CrosshairConfig.FieldIsInteger[i])
            {
                throw new InvalidOperationException($"Field \"{name}\" has the wrong type.");
            }
        }
    }

    /// <summary>Native shape stride, exposed for the layout tests.</summary>
    public static int ShapeSize => rx_shape_size();

    /// <summary>Maximum shapes the core will emit for one reticle.</summary>
    public static int MaxShapes => rx_max_shapes();

    public static CrosshairConfig Defaults()
    {
        var config = default(CrosshairConfig);
        rx_config_defaults(ref config);
        return config;
    }

    /// <summary>
    /// Clamps every field into range. Always succeeds, which is what makes it
    /// safe to run over a file someone hand-edited.
    /// </summary>
    /// <returns>How many fields had to be adjusted.</returns>
    public static int Normalize(ref CrosshairConfig config) => rx_config_normalize(ref config);

    /// <summary>Reports the first problem without modifying the input.</summary>
    public static CoreStatus Validate(CrosshairConfig config) =>
        (CoreStatus)rx_config_validate(ref config);

    /// <summary>Stable content hash; equal reticles hash equally.</summary>
    public static ulong Fingerprint(CrosshairConfig config) => rx_config_fingerprint(ref config);

    /// <summary>Mutates only the fields selected by <paramref name="fields"/>.</summary>
    public static CoreStatus Randomize(
        ref CrosshairConfig config, uint seed, RandomFields fields, RandomStyle style) =>
        (CoreStatus)rx_randomize(ref config, seed, (int)fields, (int)style);

    /// <summary>
    /// Renders into a fresh non-premultiplied RGBA buffer.
    /// </summary>
    public static byte[] Rasterize(CrosshairConfig config, int width, int height, float zoom)
    {
        ValidateDimensions(width, height);
        var pixels = new byte[width * height * 4];
        var status = (CoreStatus)rx_rasterize(ref config, width, height, zoom, pixels);
        if (status != CoreStatus.Ok)
        {
            throw new InvalidOperationException($"Rasterisation failed: {status}.");
        }
        return pixels;
    }

    /// <summary>Renders scaled to fit, reporting the zoom that was chosen.</summary>
    public static byte[] RasterizeFit(
        CrosshairConfig config, int width, int height, float margin, out float zoom)
    {
        ValidateDimensions(width, height);
        var pixels = new byte[width * height * 4];
        zoom = 0f;
        var status = (CoreStatus)rx_rasterize_fit(ref config, width, height, margin, pixels, ref zoom);
        if (status != CoreStatus.Ok)
        {
            throw new InvalidOperationException($"Rasterisation failed: {status}.");
        }
        return pixels;
    }

    /// <summary>WCAG contrast ratio between two 0xRRGGBB colours.</summary>
    public static float Contrast(uint a, uint b) => rx_color_contrast(a, b);

    private static void ValidateDimensions(int width, int height)
    {
        if (width <= 0 || height <= 0 || width > 1024 || height > 1024)
        {
            throw new ArgumentOutOfRangeException(
                nameof(width), $"{width}x{height} is outside the supported raster range.");
        }
    }
}
