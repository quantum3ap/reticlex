using System.Globalization;
using System.Text.Json;

namespace ReticleX.Core.Services;

/// <summary>
/// The host's copy of the translation catalogues.
/// </summary>
/// <remarks>
/// The front end owns almost all of the interface text, but the shell needs a
/// few strings before a web view exists at all — most importantly the message
/// shown when WebView2 is missing, which is precisely the case where the front
/// end cannot speak for itself. Reading the same JSON files keeps those
/// messages in the user's language without a second set of resources.
/// </remarks>
public sealed class LocalizationCatalog
{
    public static readonly string[] SupportedLocales =
        ["en", "ar", "es", "fr", "de", "pt", "tr", "ru", "zh", "ja"];

    public const string DefaultLocale = "en";

    private readonly Dictionary<string, string> _strings = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _fallback = new(StringComparer.Ordinal);

    public string Locale { get; private set; } = DefaultLocale;

    /// <summary>Right-to-left is currently Arabic only; kept as a lookup for clarity.</summary>
    public bool IsRightToLeft => Locale == "ar";

    /// <summary>
    /// Maps a culture such as "pt-BR" or "zh-Hans-CN" onto a shipped catalogue.
    /// </summary>
    public static string Resolve(string? tag)
    {
        if (string.IsNullOrWhiteSpace(tag)) return DefaultLocale;
        var lower = tag.Trim().ToLowerInvariant();
        if (SupportedLocales.Contains(lower)) return lower;

        var primary = lower.Split('-', '_')[0];
        return SupportedLocales.Contains(primary) ? primary : DefaultLocale;
    }

    /// <summary>The Windows UI language, mapped onto a shipped catalogue.</summary>
    public static string SystemLocale()
    {
        try
        {
            return Resolve(CultureInfo.CurrentUICulture.Name);
        }
        catch (CultureNotFoundException)
        {
            return DefaultLocale;
        }
    }

    /// <summary>
    /// Loads a catalogue, keeping English resident as a fallback.
    /// Missing or unreadable files leave the catalogue empty rather than
    /// throwing; <see cref="Get"/> then returns the key.
    /// </summary>
    public void Load(string directory, string locale)
    {
        Locale = Resolve(locale);
        _strings.Clear();
        _fallback.Clear();

        ReadInto(Path.Combine(directory, $"{DefaultLocale}.json"), _fallback);
        if (Locale == DefaultLocale)
        {
            foreach (var pair in _fallback) _strings[pair.Key] = pair.Value;
            return;
        }
        ReadInto(Path.Combine(directory, $"{Locale}.json"), _strings);
    }

    private static void ReadInto(string path, Dictionary<string, string> target)
    {
        try
        {
            if (!File.Exists(path)) return;
            using var document = JsonDocument.Parse(File.ReadAllText(path));
            if (document.RootElement.ValueKind != JsonValueKind.Object) return;
            foreach (var property in document.RootElement.EnumerateObject())
            {
                if (property.Value.ValueKind == JsonValueKind.String)
                {
                    target[property.Name] = property.Value.GetString() ?? string.Empty;
                }
            }
        }
        catch (Exception error) when (error is JsonException or IOException
                                      or UnauthorizedAccessException)
        {
            // A damaged catalogue degrades to English or to raw keys; it must
            // never prevent the window from opening.
        }
    }

    /// <summary>Looks up a key, substituting {placeholders}.</summary>
    public string Get(string key, IReadOnlyDictionary<string, string>? parameters = null)
    {
        if (!_strings.TryGetValue(key, out var template)
            && !_fallback.TryGetValue(key, out template))
        {
            return key;
        }

        if (parameters is null || parameters.Count == 0) return template;

        foreach (var pair in parameters)
        {
            template = template.Replace($"{{{pair.Key}}}", pair.Value, StringComparison.Ordinal);
        }
        return template;
    }

    public int Count => _strings.Count;
}
