using System.Text.Json.Serialization;

namespace ReticleX.Core.Models;

/// <summary>
/// A saved crosshair or preset, exactly as it is written to disk.
/// </summary>
/// <remarks>
/// This is the storage record, not the exchange format: the configuration is
/// stored flat, in the core's own field vocabulary, so loading a library file
/// is a straight deserialisation with nothing to translate. The nested,
/// human-editable shape is only used for import and export
/// (see <see cref="Services.ImportExportService"/>).
/// </remarks>
public sealed class CrosshairDocument
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    /// <summary>Either "crosshair" or "preset".</summary>
    [JsonPropertyName("kind")]
    public string Kind { get; set; } = "crosshair";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "Untitled";

    [JsonPropertyName("description")]
    public string Description { get; set; } = string.Empty;

    [JsonPropertyName("createdAt")]
    public string CreatedAt { get; set; } = string.Empty;

    [JsonPropertyName("updatedAt")]
    public string UpdatedAt { get; set; } = string.Empty;

    [JsonPropertyName("config")]
    public CrosshairConfig Config { get; set; } = CrosshairConfig.CreateDefault();

    public bool IsPreset => string.Equals(Kind, "preset", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Strips anything a record read from disk must not carry: over-long text,
    /// an unusable identifier, or a timestamp that is not a date.
    /// </summary>
    public CrosshairDocument Sanitize()
    {
        Id = SafeId(Id);
        Kind = IsPreset ? "preset" : "crosshair";
        Name = Truncate(string.IsNullOrWhiteSpace(Name) ? "Untitled" : Name.Trim(), 80);
        Description = Truncate(Description ?? string.Empty, 240);
        CreatedAt = SafeTimestamp(CreatedAt);
        UpdatedAt = SafeTimestamp(UpdatedAt);
        return this;
    }

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..max];

    /// <summary>
    /// Identifiers become filenames, so anything outside a conservative set is
    /// replaced rather than trusted.
    /// </summary>
    public static string SafeId(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return NewId("cx");
        Span<char> buffer = stackalloc char[Math.Min(id.Length, 64)];
        var length = 0;
        foreach (var c in id)
        {
            if (length == buffer.Length) break;
            var ok = c is >= 'a' and <= 'z' or >= 'A' and <= 'Z' or >= '0' and <= '9' or '_' or '-';
            buffer[length++] = ok ? c : '_';
        }
        var cleaned = new string(buffer[..length]).Trim('_', '-');
        return cleaned.Length > 0 ? cleaned : NewId("cx");
    }

    public static string NewId(string prefix)
    {
        var stamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString("x");
        var random = Guid.NewGuid().ToString("N")[..8];
        return $"{prefix}_{stamp}_{random}";
    }

    private static string SafeTimestamp(string? value)
    {
        if (DateTimeOffset.TryParse(value, out var parsed))
        {
            return parsed.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
        }
        return DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
    }
}
