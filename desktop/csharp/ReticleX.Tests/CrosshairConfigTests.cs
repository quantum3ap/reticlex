using System.Runtime.InteropServices;
using System.Text.Json;
using ReticleX.Core.Models;
using ReticleX.Core.Serialization;
using ReticleX.Core.Services;
using Xunit;

namespace ReticleX.Tests;

public class CrosshairConfigTests
{
    [Fact]
    public void LayoutIsAFlatBlockOfFourByteFields()
    {
        // The struct crosses the P/Invoke boundary by memory layout alone, so
        // any padding would corrupt every call.
        Assert.Equal(CrosshairConfig.FieldCount * 4, Marshal.SizeOf<CrosshairConfig>());
        Assert.Equal(CrosshairConfig.FieldCount, CrosshairConfig.FieldNames.Length);
        Assert.Equal(CrosshairConfig.FieldCount, CrosshairConfig.FieldIsInteger.Length);
    }

    [Fact]
    public void FieldNamesAreUniqueAndUseTheSharedVocabulary()
    {
        Assert.Equal(
            CrosshairConfig.FieldNames.Length,
            CrosshairConfig.FieldNames.Distinct().Count());
        Assert.Equal("schema_version", CrosshairConfig.FieldNames[0]);
        Assert.Equal("dynamic_gap_boost", CrosshairConfig.FieldNames[^1]);
        Assert.All(CrosshairConfig.FieldNames, name => Assert.Matches("^[a-z][a-z0-9_]*$", name));
    }

    [Fact]
    public void EveryFieldRoundTripsThroughGetAndSet()
    {
        var config = CrosshairConfig.CreateDefault();
        for (var i = 0; i < CrosshairConfig.FieldCount; i++)
        {
            var value = CrosshairConfig.FieldIsInteger[i] ? 1 : 0.25 * (i + 1);
            config.SetField(i, value);
            Assert.Equal(value, config.GetField(i), precision: 5);
        }
    }

    [Fact]
    public void SetFieldRejectsNonFiniteInput()
    {
        var config = CrosshairConfig.CreateDefault();
        config.SetField(1, double.NaN);
        Assert.Equal(0, config.Scale);
        config.SetField(1, double.PositiveInfinity);
        Assert.Equal(0, config.Scale);
    }

    [Fact]
    public void FieldIndexOutOfRangeThrows()
    {
        var config = CrosshairConfig.CreateDefault();
        Assert.Throws<ArgumentOutOfRangeException>(() => config.SetField(-1, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => config.SetField(CrosshairConfig.FieldCount, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => config.GetField(999));
    }

    [Fact]
    public void DefaultsDrawAFourArmCross()
    {
        var config = CrosshairConfig.CreateDefault();
        Assert.Equal(1, config.SchemaVersion);
        Assert.Equal(1f, config.Scale);
        Assert.Equal(1, config.HEnabled);
        Assert.Equal(1, config.VEnabled);
        Assert.Equal(8f, config.HLength);
        Assert.Equal(0, config.DotEnabled);
    }

    [Fact]
    public void SerialisesAsAFlatObjectKeyedByFieldName()
    {
        var config = CrosshairConfig.CreateDefault();
        config.HGap = 7.5f;

        var json = JsonSerializer.Serialize(config, JsonStore.Options);
        using var document = JsonDocument.Parse(json);

        Assert.Equal(CrosshairConfig.FieldCount, document.RootElement.EnumerateObject().Count());
        Assert.Equal(7.5, document.RootElement.GetProperty("h_gap").GetDouble(), precision: 4);
        Assert.Equal(1, document.RootElement.GetProperty("h_enabled").GetInt32());
    }

    [Fact]
    public void DeserialisationRoundTripsExactly()
    {
        var original = CrosshairConfig.CreateDefault();
        original.Rotation = -37.5f;
        original.DotEnabled = 1;
        original.DotSize = 4.5f;
        original.CapStyle = (int)CapStyle.Tapered;

        var json = JsonSerializer.Serialize(original, JsonStore.Options);
        var restored = JsonSerializer.Deserialize<CrosshairConfig>(json, JsonStore.Options);

        Assert.Equal(original, restored);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("null")]
    [InlineData("{\"unknown_field\": 4}")]
    [InlineData("{\"h_gap\": \"twelve\"}")]
    [InlineData("{\"h_gap\": null}")]
    [InlineData("{\"h_gap\": {\"nested\": 1}}")]
    [InlineData("{\"h_gap\": [1,2,3]}")]
    public void UnusableFieldsFallBackToTheDefaultInsteadOfFailing(string json)
    {
        var config = JsonSerializer.Deserialize<CrosshairConfig>(json, JsonStore.Options);
        Assert.Equal(CrosshairConfig.CreateDefault().HGap, config.HGap);
        Assert.Equal(1, config.SchemaVersion);
    }

    [Fact]
    public void BooleanJsonIsAcceptedForFlagFields()
    {
        var config = JsonSerializer.Deserialize<CrosshairConfig>(
            "{\"dot_enabled\": true, \"outline_enabled\": false}", JsonStore.Options);
        Assert.Equal(1, config.DotEnabled);
        Assert.Equal(0, config.OutlineEnabled);
    }

    [Fact]
    public void ANonObjectConfigurationIsRejected()
    {
        Assert.Throws<JsonException>(() =>
            JsonSerializer.Deserialize<CrosshairConfig>("[1,2,3]", JsonStore.Options));
        Assert.Throws<JsonException>(() =>
            JsonSerializer.Deserialize<CrosshairConfig>("\"text\"", JsonStore.Options));
    }

    [Fact]
    public void ConverterIsReachableThroughTheAttributeOnTheDocument()
    {
        // The document declares the converter, so serialising the document must
        // produce the flat shape without any options plumbing.
        var document = new CrosshairDocument { Id = "cx_1", Name = "Test" };
        var json = JsonSerializer.Serialize(document, JsonStore.Options);
        Assert.Contains("\"h_length\"", json);
        Assert.DoesNotContain("\"HLength\"", json);

        var restored = JsonSerializer.Deserialize<CrosshairDocument>(json, JsonStore.Options);
        Assert.NotNull(restored);
        Assert.Equal(document.Config, restored!.Config);
    }

    [Fact]
    public void ConverterCanBeUsedDirectly()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new CrosshairConfigConverter());
        var config = JsonSerializer.Deserialize<CrosshairConfig>("{\"scale\": 2.5}", options);
        Assert.Equal(2.5f, config.Scale);
    }
}
