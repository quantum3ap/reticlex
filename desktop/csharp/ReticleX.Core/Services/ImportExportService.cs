using System.Text.Json;
using System.Text.Json.Nodes;
using ReticleX.Core.Interop;
using ReticleX.Core.Models;

namespace ReticleX.Core.Services;

/// <summary>The outcome of reading a file someone handed the application.</summary>
public sealed record ImportResult(
    bool Ok,
    string? ErrorKey = null,
    string? Detail = null,
    IReadOnlyList<CrosshairDocument>? Documents = null,
    IReadOnlyList<string>? Warnings = null)
{
    public static ImportResult Failure(string errorKey, string? detail = null) =>
        new(false, errorKey, detail);

    public static ImportResult Success(
        IReadOnlyList<CrosshairDocument> documents, IReadOnlyList<string> warnings) =>
        new(true, null, null, documents, warnings);
}

/// <summary>
/// Reads and writes the nested, human-editable exchange format.
/// </summary>
/// <remarks>
/// The front end has its own reader for files the user picks from inside the
/// application. This one exists for the paths the UI never sees: a .json opened
/// from Explorer or passed on the command line. It is written to the same rules
/// — never throw for content reasons, always return something the caller can
/// turn into a translated message.
/// </remarks>
public sealed class ImportExportService
{
    public const string DocumentFormat = "reticlex-crosshair";
    public const string PresetPackFormat = "reticlex-preset-pack";
    public const int FormatVersion = 1;

    private const int MaxCharacters = 4_000_000;
    private const int MaxDocuments = 500;

    private static readonly string[] CapStyles = ["flat", "round", "tapered"];
    private static readonly string[] DotShapes = ["square", "round"];

    public ImportResult Parse(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return ImportResult.Failure("import.errorEmpty");
        if (text.Length > MaxCharacters) return ImportResult.Failure("import.errorTooLarge");

        JsonNode? root;
        try
        {
            root = JsonNode.Parse(text, documentOptions: new JsonDocumentOptions
            {
                AllowTrailingCommas = true,
                CommentHandling = JsonCommentHandling.Skip,
            });
        }
        catch (JsonException error)
        {
            return ImportResult.Failure("import.errorJson", Shorten(error.Message));
        }

        var warnings = new List<string>();
        var documents = new List<CrosshairDocument>();

        switch (root)
        {
            case JsonArray array:
                if (array.Count == 0) return ImportResult.Failure("import.errorEmpty");
                if (array.Count > MaxDocuments) return ImportResult.Failure("import.errorTooMany");
                for (var i = 0; i < array.Count; i++)
                {
                    documents.Add(ReadOne(array[i] as JsonObject, $"Imported {i + 1}", warnings));
                }
                break;

            case JsonObject obj when obj["presets"] is JsonArray presets:
                if (presets.Count == 0) return ImportResult.Failure("import.errorEmpty");
                if (presets.Count > MaxDocuments) return ImportResult.Failure("import.errorTooMany");
                for (var i = 0; i < presets.Count; i++)
                {
                    var document = ReadOne(presets[i] as JsonObject, $"Imported {i + 1}", warnings);
                    document.Kind = "preset";
                    documents.Add(document);
                }
                break;

            case JsonObject obj:
                var format = obj["format"]?.GetValue<string>();
                if (format is not null && format != DocumentFormat && format != PresetPackFormat)
                {
                    return ImportResult.Failure("import.errorFormat", Shorten(format, 60));
                }
                if (obj["version"] is JsonValue version
                    && version.TryGetValue<int>(out var number)
                    && number > FormatVersion)
                {
                    return ImportResult.Failure("import.errorVersion", number.ToString());
                }
                if (obj["crosshair"] is null && obj["horizontal"] is null && obj["h_length"] is null)
                {
                    return ImportResult.Failure("import.errorShape");
                }
                documents.Add(ReadOne(obj, "Imported crosshair", warnings));
                break;

            default:
                return ImportResult.Failure("import.errorShape");
        }

        return ImportResult.Success(documents, warnings.Distinct().ToList());
    }

    public ImportResult ParseFile(string path)
    {
        try
        {
            var info = new FileInfo(path);
            if (!info.Exists) return ImportResult.Failure("import.errorRead", "not found");
            if (info.Length > MaxCharacters) return ImportResult.Failure("import.errorTooLarge");
            return Parse(File.ReadAllText(path));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException
                                      or NotSupportedException or ArgumentException)
        {
            return ImportResult.Failure("import.errorRead", Shorten(error.Message));
        }
    }

    private static CrosshairDocument ReadOne(
        JsonObject? entry, string fallbackName, List<string> warnings)
    {
        var source = entry?["crosshair"] as JsonObject ?? entry;
        var config = ReadConfig(source, warnings);

        if (NativeCore.IsAvailable)
        {
            if (NativeCore.Normalize(ref config) > 0) warnings.Add("clamped");
            if (NativeCore.Validate(config) == CoreStatus.Empty) warnings.Add("empty");
        }

        var now = DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
        var kind = entry?["kind"]?.GetValue<string>() == "preset" ? "preset" : "crosshair";

        return new CrosshairDocument
        {
            Id = CrosshairDocument.NewId(kind == "preset" ? "ps" : "cx"),
            Kind = kind,
            Name = entry?["name"]?.GetValue<string>() ?? fallbackName,
            Description = entry?["description"]?.GetValue<string>() ?? string.Empty,
            CreatedAt = now,
            UpdatedAt = now,
            Config = config,
        }.Sanitize();
    }

    private static CrosshairConfig ReadConfig(JsonObject? source, List<string> warnings)
    {
        var config = CrosshairConfig.CreateDefault();
        if (source is null)
        {
            warnings.Add("missingCrosshair");
            return config;
        }

        // A flat object needs no translation; it is what the host stores.
        if (source["h_length"] is not null || source["color_r"] is not null)
        {
            for (var i = 0; i < CrosshairConfig.FieldCount; i++)
            {
                if (source[CrosshairConfig.FieldNames[i]] is JsonValue value
                    && value.TryGetValue<double>(out var number))
                {
                    config.SetField(i, number);
                }
            }
            return config;
        }

        config.Scale = Number(source["scale"], config.Scale);
        config.Rotation = Number(source["rotation"], config.Rotation);
        config.Opacity = Number(source["opacity"], config.Opacity);
        ReadColor(source["color"], warnings, ref config.ColorR, ref config.ColorG, ref config.ColorB);

        if (source["horizontal"] is JsonObject h)
        {
            config.HEnabled = Flag(h["enabled"], config.HEnabled);
            config.HLength = Number(h["length"], config.HLength);
            config.HThickness = Number(h["thickness"], config.HThickness);
            config.HGap = Number(h["gap"], config.HGap);
        }

        if (source["vertical"] is JsonObject v)
        {
            config.VEnabled = Flag(v["enabled"], config.VEnabled);
            config.VLength = Number(v["length"], config.VLength);
            config.VThickness = Number(v["thickness"], config.VThickness);
            config.VGap = Number(v["gap"], config.VGap);
        }

        if (source["arms"] is JsonObject arms)
        {
            config.ShowLeft = Flag(arms["left"], config.ShowLeft);
            config.ShowRight = Flag(arms["right"], config.ShowRight);
            config.ShowTop = Flag(arms["top"], config.ShowTop);
            config.ShowBottom = Flag(arms["bottom"], config.ShowBottom);
            config.TShape = Flag(arms["tShape"], config.TShape);
            config.CapStyle = Enumerated(arms["capStyle"], CapStyles, config.CapStyle);
        }

        if (source["outline"] is JsonObject outline)
        {
            config.OutlineEnabled = Flag(outline["enabled"], config.OutlineEnabled);
            config.OutlineThickness = Number(outline["thickness"], config.OutlineThickness);
            config.OutlineOpacity = Number(outline["opacity"], config.OutlineOpacity);
            ReadColor(outline["color"], warnings,
                ref config.OutlineColorR, ref config.OutlineColorG, ref config.OutlineColorB);
        }

        if (source["dot"] is JsonObject dot)
        {
            config.DotEnabled = Flag(dot["enabled"], config.DotEnabled);
            config.DotSize = Number(dot["size"], config.DotSize);
            config.DotOpacity = Number(dot["opacity"], config.DotOpacity);
            config.DotInheritColor = Flag(dot["inheritColor"], config.DotInheritColor);
            config.DotShape = Enumerated(dot["shape"], DotShapes, config.DotShape);
            ReadColor(dot["color"], warnings,
                ref config.DotColorR, ref config.DotColorG, ref config.DotColorB);
        }

        if (source["dynamic"] is JsonObject dynamic)
        {
            config.DynamicEnabled = Flag(dynamic["enabled"], config.DynamicEnabled);
            config.DynamicSpread = Number(dynamic["spread"], config.DynamicSpread);
            config.DynamicGapBoost = Number(dynamic["gapBoost"], config.DynamicGapBoost);
        }

        return config;
    }

    /// <summary>Serialises a document into the nested exchange format.</summary>
    public static JsonObject ToExchangeFormat(CrosshairDocument document, string appVersion)
    {
        var c = document.Config;
        return new JsonObject
        {
            ["format"] = DocumentFormat,
            ["version"] = FormatVersion,
            ["name"] = document.Name,
            ["description"] = document.Description,
            ["createdAt"] = document.CreatedAt,
            ["updatedAt"] = document.UpdatedAt,
            ["exportedAt"] = DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
            ["app"] = new JsonObject { ["name"] = "ReticleX", ["version"] = appVersion },
            ["crosshair"] = new JsonObject
            {
                ["scale"] = c.Scale,
                ["rotation"] = c.Rotation,
                ["opacity"] = c.Opacity,
                ["color"] = Hex(c.ColorR, c.ColorG, c.ColorB),
                ["horizontal"] = new JsonObject
                {
                    ["enabled"] = c.HEnabled != 0,
                    ["length"] = c.HLength,
                    ["thickness"] = c.HThickness,
                    ["gap"] = c.HGap,
                },
                ["vertical"] = new JsonObject
                {
                    ["enabled"] = c.VEnabled != 0,
                    ["length"] = c.VLength,
                    ["thickness"] = c.VThickness,
                    ["gap"] = c.VGap,
                },
                ["arms"] = new JsonObject
                {
                    ["left"] = c.ShowLeft != 0,
                    ["right"] = c.ShowRight != 0,
                    ["top"] = c.ShowTop != 0,
                    ["bottom"] = c.ShowBottom != 0,
                    ["tShape"] = c.TShape != 0,
                    ["capStyle"] = CapStyles[Math.Clamp(c.CapStyle, 0, CapStyles.Length - 1)],
                },
                ["outline"] = new JsonObject
                {
                    ["enabled"] = c.OutlineEnabled != 0,
                    ["thickness"] = c.OutlineThickness,
                    ["opacity"] = c.OutlineOpacity,
                    ["color"] = Hex(c.OutlineColorR, c.OutlineColorG, c.OutlineColorB),
                },
                ["dot"] = new JsonObject
                {
                    ["enabled"] = c.DotEnabled != 0,
                    ["size"] = c.DotSize,
                    ["opacity"] = c.DotOpacity,
                    ["inheritColor"] = c.DotInheritColor != 0,
                    ["shape"] = DotShapes[Math.Clamp(c.DotShape, 0, DotShapes.Length - 1)],
                    ["color"] = Hex(c.DotColorR, c.DotColorG, c.DotColorB),
                },
                ["dynamic"] = new JsonObject
                {
                    ["enabled"] = c.DynamicEnabled != 0,
                    ["spread"] = c.DynamicSpread,
                    ["gapBoost"] = c.DynamicGapBoost,
                },
            },
        };
    }

    private static float Number(JsonNode? node, float fallback)
    {
        if (node is not JsonValue value || !value.TryGetValue<double>(out var number)) return fallback;
        if (!double.IsFinite(number)) return fallback;
        // Clamp before narrowing: 1e308 is a finite double but an infinite float.
        return (float)Math.Clamp(number, float.MinValue, float.MaxValue);
    }

    private static int Flag(JsonNode? node, int fallback)
    {
        if (node is not JsonValue value) return fallback;
        if (value.TryGetValue<bool>(out var flag)) return flag ? 1 : 0;
        if (value.TryGetValue<double>(out var number)) return number != 0 ? 1 : 0;
        return fallback;
    }

    private static int Enumerated(JsonNode? node, string[] names, int fallback)
    {
        if (node is not JsonValue value) return fallback;
        if (value.TryGetValue<string>(out var text))
        {
            var index = Array.IndexOf(names, text.ToLowerInvariant());
            if (index >= 0) return index;
        }
        if (value.TryGetValue<int>(out var number) && number >= 0 && number < names.Length)
        {
            return number;
        }
        return fallback;
    }

    private static void ReadColor(
        JsonNode? node, List<string> warnings, ref float r, ref float g, ref float b)
    {
        if (node is null) return;
        if (node is not JsonValue value || !value.TryGetValue<string>(out var text))
        {
            warnings.Add("invalidColor");
            return;
        }
        if (!TryParseHex(text, out var parsed))
        {
            warnings.Add("invalidColor");
            return;
        }
        r = ((parsed >> 16) & 0xFF) / 255f;
        g = ((parsed >> 8) & 0xFF) / 255f;
        b = (parsed & 0xFF) / 255f;
    }

    /// <summary>Parses "#RGB" or "#RRGGBB", with or without the hash.</summary>
    public static bool TryParseHex(string? text, out uint value)
    {
        value = 0;
        if (string.IsNullOrWhiteSpace(text)) return false;
        var body = text.Trim().TrimStart('#');

        if (body.Length == 3)
        {
            Span<char> expanded = stackalloc char[6];
            for (var i = 0; i < 3; i++)
            {
                expanded[i * 2] = body[i];
                expanded[i * 2 + 1] = body[i];
            }
            body = new string(expanded);
        }

        if (body.Length != 6) return false;
        return uint.TryParse(body, System.Globalization.NumberStyles.HexNumber,
            System.Globalization.CultureInfo.InvariantCulture, out value);
    }

    /// <summary>Formats three 0..1 channels as "#RRGGBB".</summary>
    public static string Hex(float r, float g, float b)
    {
        static int Channel(float v) => (int)Math.Round(Math.Clamp(v, 0f, 1f) * 255f);
        return $"#{Channel(r):X2}{Channel(g):X2}{Channel(b):X2}";
    }

    private static string Shorten(string value, int max = 160) =>
        value.Length <= max ? value : value[..max];
}
