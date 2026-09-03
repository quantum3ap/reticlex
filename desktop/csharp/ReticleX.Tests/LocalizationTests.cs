using System.Text.Json;
using ReticleX.Core.Services;
using Xunit;

namespace ReticleX.Tests;

public class LocalizationTests
{
    [Fact]
    public void EveryAdvertisedLanguageShipsACatalogue()
    {
        foreach (var locale in LocalizationCatalog.SupportedLocales)
        {
            var path = Path.Combine(TestContent.LocalizationDirectory, $"{locale}.json");
            Assert.True(File.Exists(path), $"{locale}.json is missing");
        }
    }

    [Fact]
    public void EveryCatalogueCoversTheEnglishKeys()
    {
        var english = ReadCatalogue("en");
        Assert.True(english.Count > 300, $"English has only {english.Count} keys");

        foreach (var locale in LocalizationCatalog.SupportedLocales)
        {
            var catalogue = ReadCatalogue(locale);
            var missing = english.Keys.Where(key => !catalogue.ContainsKey(key)).ToList();
            Assert.True(missing.Count == 0, $"{locale} is missing: {string.Join(", ", missing.Take(5))}");

            var extra = catalogue.Keys.Where(key => !english.ContainsKey(key)).ToList();
            Assert.True(extra.Count == 0, $"{locale} has extra keys: {string.Join(", ", extra.Take(5))}");

            foreach (var (key, value) in catalogue)
            {
                Assert.False(string.IsNullOrWhiteSpace(value), $"{locale}:{key} is empty");
            }
        }
    }

    [Fact]
    public void PlaceholdersMatchAcrossLanguages()
    {
        var english = ReadCatalogue("en");
        foreach (var locale in LocalizationCatalog.SupportedLocales.Where(l => l != "en"))
        {
            var catalogue = ReadCatalogue(locale);
            foreach (var (key, template) in english)
            {
                Assert.Equal(Placeholders(template), Placeholders(catalogue[key]));
            }
        }
    }

    [Fact]
    public void LoadsACatalogueAndFallsBackToEnglish()
    {
        var catalog = new LocalizationCatalog();
        catalog.Load(TestContent.LocalizationDirectory, "de");

        Assert.Equal("de", catalog.Locale);
        Assert.False(catalog.IsRightToLeft);
        Assert.NotEqual("nav.home", catalog.Get("nav.home"));
        Assert.True(catalog.Count > 300);
    }

    [Fact]
    public void ArabicIsMarkedRightToLeft()
    {
        var catalog = new LocalizationCatalog();
        catalog.Load(TestContent.LocalizationDirectory, "ar");
        Assert.True(catalog.IsRightToLeft);
        Assert.Equal("rtl", catalog.Get("meta.dir"));
    }

    [Fact]
    public void SubstitutesPlaceholders()
    {
        var catalog = new LocalizationCatalog();
        catalog.Load(TestContent.LocalizationDirectory, "en");
        var text = catalog.Get("toast.savedAs", new Dictionary<string, string> { ["name"] = "Mine" });
        Assert.Contains("Mine", text);
        Assert.DoesNotContain("{name}", text);
    }

    [Fact]
    public void AnUnknownKeyReturnsTheKey()
    {
        var catalog = new LocalizationCatalog();
        catalog.Load(TestContent.LocalizationDirectory, "en");
        Assert.Equal("no.such.key", catalog.Get("no.such.key"));
    }

    [Fact]
    public void AMissingDirectoryDegradesToRawKeys()
    {
        var catalog = new LocalizationCatalog();
        catalog.Load(Path.Combine(Path.GetTempPath(), "reticlex-no-such-folder"), "fr");
        Assert.Equal("nav.home", catalog.Get("nav.home"));
        Assert.Equal(0, catalog.Count);
    }

    [Theory]
    [InlineData("pt-BR", "pt")]
    [InlineData("zh-Hans-CN", "zh")]
    [InlineData("ar-SA", "ar")]
    [InlineData("EN-GB", "en")]
    [InlineData("de_DE", "de")]
    [InlineData("sv-SE", "en")]
    [InlineData("", "en")]
    [InlineData(null, "en")]
    public void RegionalTagsMapOntoShippedCatalogues(string? tag, string expected)
    {
        Assert.Equal(expected, LocalizationCatalog.Resolve(tag));
    }

    [Fact]
    public void EveryBuiltInPresetIsNamedInEveryLanguage()
    {
        using var presets = JsonDocument.Parse(
            File.ReadAllText(Path.Combine(TestContent.PresetsDirectory, "builtin.json")));
        var ids = presets.RootElement.GetProperty("presets")
            .EnumerateArray()
            .Select(preset => preset.GetProperty("id").GetString()!)
            .ToList();

        Assert.True(ids.Count >= 8, $"only {ids.Count} built-in presets");

        foreach (var locale in LocalizationCatalog.SupportedLocales)
        {
            var catalogue = ReadCatalogue(locale);
            foreach (var id in ids)
            {
                Assert.True(catalogue.ContainsKey($"preset.{id}.name"), $"{locale} lacks a name for {id}");
                Assert.True(
                    catalogue.ContainsKey($"preset.{id}.description"),
                    $"{locale} lacks a description for {id}");
            }
        }
    }

    private static Dictionary<string, string> ReadCatalogue(string locale)
    {
        var path = Path.Combine(TestContent.LocalizationDirectory, $"{locale}.json");
        using var document = JsonDocument.Parse(File.ReadAllText(path));
        return document.RootElement.EnumerateObject()
            .ToDictionary(property => property.Name, property => property.Value.GetString() ?? string.Empty);
    }

    private static string Placeholders(string value)
    {
        var matches = System.Text.RegularExpressions.Regex.Matches(value, @"\{(\w+)\}");
        return string.Join(",", matches.Select(match => match.Groups[1].Value).OrderBy(name => name));
    }
}
