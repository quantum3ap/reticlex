using System.Text.Json;
using System.Text.Json.Nodes;

namespace ReticleX.Core.Models;

/// <summary>
/// Application preferences as stored in settings.json.
/// </summary>
/// <remarks>
/// The front end owns the shape of this object, so the host keeps it as an
/// opaque JSON node rather than a mirrored class: adding a preference should
/// not require a change on both sides. What the host does own is the handful of
/// values it needs itself (the language for pre-UI dialogs, and the
/// start-with-Windows flag) plus the guarantee that the file is valid JSON of a
/// sane size.
/// </remarks>
public sealed class AppSettings
{
    /// <summary>Anything larger than this is treated as corrupt.</summary>
    public const int MaxBytes = 8 * 1024 * 1024;

    public JsonObject Values { get; private set; } = new();

    public static AppSettings Empty() => new();

    public static AppSettings FromJson(string? json)
    {
        var settings = new AppSettings();
        if (string.IsNullOrWhiteSpace(json) || json.Length > MaxBytes) return settings;

        try
        {
            if (JsonNode.Parse(json) is JsonObject parsed)
            {
                settings.Values = parsed;
            }
        }
        catch (JsonException)
        {
            // A corrupt settings file must never stop the application; the
            // caller quarantines it and we carry on with defaults.
        }
        return settings;
    }

    public string ToJson() => Values.ToJsonString(new JsonSerializerOptions { WriteIndented = true });

    /// <summary>The chosen language, or null when the user has not picked one.</summary>
    public string? Locale =>
        Values.TryGetPropertyValue("locale", out var node) ? node?.GetValue<string>() : null;

    public bool StartWithWindows =>
        Values.TryGetPropertyValue("startWithWindows", out var node)
        && node is JsonValue value
        && value.TryGetValue<bool>(out var flag)
        && flag;

    public void Set(string key, JsonNode? value) => Values[key] = value;
}
