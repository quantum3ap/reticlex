using System.Runtime.InteropServices;
using System.Text.Json.Serialization;
using ReticleX.Core.Serialization;

namespace ReticleX.Core.Models;

/// <summary>
/// The managed mirror of <c>rx_config</c>.
/// </summary>
/// <remarks>
/// Field order and sizes are the ABI contract with the native core. Every
/// member is four bytes wide and sequentially laid out, so the struct can be
/// passed straight across the P/Invoke boundary with no marshalling; the layout
/// is asserted against the native library at start-up by
/// <see cref="Interop.NativeCore.VerifyLayout"/>.
///
/// The members are fields rather than properties for that reason, and
/// System.Text.Json ignores fields by default, so the converter declared here
/// is what gives the struct a stable JSON shape wherever it is serialised.
/// </remarks>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
[JsonConverter(typeof(CrosshairConfigConverter))]
public struct CrosshairConfig
{
    public int SchemaVersion;

    public float Scale;
    public float Rotation;
    public float Opacity;
    public float ColorR;
    public float ColorG;
    public float ColorB;

    public int HEnabled;
    public float HLength;
    public float HThickness;
    public float HGap;

    public int VEnabled;
    public float VLength;
    public float VThickness;
    public float VGap;

    public int ShowLeft;
    public int ShowRight;
    public int ShowTop;
    public int ShowBottom;
    public int TShape;
    public int CapStyle;

    public int OutlineEnabled;
    public float OutlineThickness;
    public float OutlineOpacity;
    public float OutlineColorR;
    public float OutlineColorG;
    public float OutlineColorB;

    public int DotEnabled;
    public float DotSize;
    public float DotOpacity;
    public int DotInheritColor;
    public int DotShape;
    public float DotColorR;
    public float DotColorG;
    public float DotColorB;

    public int DynamicEnabled;
    public float DynamicSpread;
    public float DynamicGapBoost;

    /// <summary>Number of four-byte members; mirrors <c>RX_CONFIG_FIELDS</c>.</summary>
    public const int FieldCount = 38;

    /// <summary>
    /// The ABI field names, in memory order. These are also the property names
    /// used on the wire and in the library files, so the JavaScript front end,
    /// the host and the native core all agree on one vocabulary.
    /// </summary>
    public static readonly string[] FieldNames =
    [
        "schema_version",
        "scale", "rotation", "opacity",
        "color_r", "color_g", "color_b",
        "h_enabled", "h_length", "h_thickness", "h_gap",
        "v_enabled", "v_length", "v_thickness", "v_gap",
        "show_left", "show_right", "show_top", "show_bottom", "t_shape", "cap_style",
        "outline_enabled", "outline_thickness", "outline_opacity",
        "outline_color_r", "outline_color_g", "outline_color_b",
        "dot_enabled", "dot_size", "dot_opacity", "dot_inherit_color", "dot_shape",
        "dot_color_r", "dot_color_g", "dot_color_b",
        "dynamic_enabled", "dynamic_spread", "dynamic_gap_boost",
    ];

    /// <summary>True where the field at that index is an <c>int</c>.</summary>
    public static readonly bool[] FieldIsInteger =
    [
        true,
        false, false, false,
        false, false, false,
        true, false, false, false,
        true, false, false, false,
        true, true, true, true, true, true,
        true, false, false,
        false, false, false,
        true, false, false, true, true,
        false, false, false,
        true, false, false,
    ];

    /// <summary>Reads a field by ABI index, as a double for uniform handling.</summary>
    public readonly double GetField(int index) => index switch
    {
        0 => SchemaVersion,
        1 => Scale, 2 => Rotation, 3 => Opacity,
        4 => ColorR, 5 => ColorG, 6 => ColorB,
        7 => HEnabled, 8 => HLength, 9 => HThickness, 10 => HGap,
        11 => VEnabled, 12 => VLength, 13 => VThickness, 14 => VGap,
        15 => ShowLeft, 16 => ShowRight, 17 => ShowTop, 18 => ShowBottom,
        19 => TShape, 20 => CapStyle,
        21 => OutlineEnabled, 22 => OutlineThickness, 23 => OutlineOpacity,
        24 => OutlineColorR, 25 => OutlineColorG, 26 => OutlineColorB,
        27 => DotEnabled, 28 => DotSize, 29 => DotOpacity,
        30 => DotInheritColor, 31 => DotShape,
        32 => DotColorR, 33 => DotColorG, 34 => DotColorB,
        35 => DynamicEnabled, 36 => DynamicSpread, 37 => DynamicGapBoost,
        _ => throw new ArgumentOutOfRangeException(nameof(index)),
    };

    /// <summary>Writes a field by ABI index. Non-finite input becomes zero.</summary>
    public void SetField(int index, double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value)) value = 0;
        var asInt = (int)Math.Clamp(Math.Round(value), int.MinValue, int.MaxValue);
        // A JSON number can exceed the float range; clamping keeps the field
        // finite so the core can then clamp it to its documented limit.
        var asFloat = (float)Math.Clamp(value, float.MinValue, float.MaxValue);

        switch (index)
        {
            case 0: SchemaVersion = asInt; break;
            case 1: Scale = asFloat; break;
            case 2: Rotation = asFloat; break;
            case 3: Opacity = asFloat; break;
            case 4: ColorR = asFloat; break;
            case 5: ColorG = asFloat; break;
            case 6: ColorB = asFloat; break;
            case 7: HEnabled = asInt; break;
            case 8: HLength = asFloat; break;
            case 9: HThickness = asFloat; break;
            case 10: HGap = asFloat; break;
            case 11: VEnabled = asInt; break;
            case 12: VLength = asFloat; break;
            case 13: VThickness = asFloat; break;
            case 14: VGap = asFloat; break;
            case 15: ShowLeft = asInt; break;
            case 16: ShowRight = asInt; break;
            case 17: ShowTop = asInt; break;
            case 18: ShowBottom = asInt; break;
            case 19: TShape = asInt; break;
            case 20: CapStyle = asInt; break;
            case 21: OutlineEnabled = asInt; break;
            case 22: OutlineThickness = asFloat; break;
            case 23: OutlineOpacity = asFloat; break;
            case 24: OutlineColorR = asFloat; break;
            case 25: OutlineColorG = asFloat; break;
            case 26: OutlineColorB = asFloat; break;
            case 27: DotEnabled = asInt; break;
            case 28: DotSize = asFloat; break;
            case 29: DotOpacity = asFloat; break;
            case 30: DotInheritColor = asInt; break;
            case 31: DotShape = asInt; break;
            case 32: DotColorR = asFloat; break;
            case 33: DotColorG = asFloat; break;
            case 34: DotColorB = asFloat; break;
            case 35: DynamicEnabled = asInt; break;
            case 36: DynamicSpread = asFloat; break;
            case 37: DynamicGapBoost = asFloat; break;
            default: throw new ArgumentOutOfRangeException(nameof(index));
        }
    }

    /// <summary>
    /// The built-in default reticle, used when the native core is unavailable
    /// and as the starting point for a repair.
    /// </summary>
    public static CrosshairConfig CreateDefault() => new()
    {
        SchemaVersion = 1,
        Scale = 1f,
        Rotation = 0f,
        Opacity = 1f,
        ColorR = 0f, ColorG = 1f, ColorB = 136f / 255f,
        HEnabled = 1, HLength = 8f, HThickness = 2f, HGap = 4f,
        VEnabled = 1, VLength = 8f, VThickness = 2f, VGap = 4f,
        ShowLeft = 1, ShowRight = 1, ShowTop = 1, ShowBottom = 1,
        TShape = 0, CapStyle = 0,
        OutlineEnabled = 1, OutlineThickness = 1f, OutlineOpacity = 0.85f,
        OutlineColorR = 0f, OutlineColorG = 0f, OutlineColorB = 0f,
        DotEnabled = 0, DotSize = 3f, DotOpacity = 1f,
        DotInheritColor = 1, DotShape = 0,
        DotColorR = 0f, DotColorG = 1f, DotColorB = 136f / 255f,
        DynamicEnabled = 0, DynamicSpread = 0f, DynamicGapBoost = 8f,
    };
}

/// <summary>Cap treatment for the four arms; mirrors <c>rx_cap_style</c>.</summary>
public enum CapStyle
{
    Flat = 0,
    Round = 1,
    Tapered = 2,
}

/// <summary>Centre dot silhouette; mirrors <c>rx_dot_shape</c>.</summary>
public enum DotShape
{
    Square = 0,
    Round = 1,
}

/// <summary>Status codes returned by the native core; mirrors <c>rx_status</c>.</summary>
public enum CoreStatus
{
    Ok = 0,
    NullArgument = 1,
    Schema = 2,
    NotFinite = 3,
    Range = 4,
    Empty = 5,
    Capacity = 6,
    Dimensions = 7,
}

/// <summary>Bit flags selecting what the randomizer may change.</summary>
[Flags]
public enum RandomFields
{
    None = 0,
    Color = 1 << 0,
    Size = 1 << 1,
    Gap = 1 << 2,
    Thickness = 1 << 3,
    Dot = 1 << 4,
    Outline = 1 << 5,
    Shape = 1 << 6,
    Opacity = 1 << 7,
    Rotation = 1 << 8,
    All = 0x1FF,
}

/// <summary>Style archetypes the randomizer biases towards.</summary>
public enum RandomStyle
{
    Any = 0,
    Precision = 1,
    Classic = 2,
    Minimal = 3,
    Bold = 4,
}
