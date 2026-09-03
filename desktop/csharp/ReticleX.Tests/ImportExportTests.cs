using System.Text.Json.Nodes;
using ReticleX.Core.Models;
using ReticleX.Core.Services;
using Xunit;

namespace ReticleX.Tests;

public class ImportExportTests
{
    private readonly ImportExportService _service = new();

    private static CrosshairDocument SampleDocument()
    {
        var config = CrosshairConfig.CreateDefault();
        config.HLength = 14f;
        config.HGap = 5f;
        config.Rotation = 22f;
        config.DotEnabled = 1;
        config.DotShape = (int)DotShape.Round;
        config.CapStyle = (int)CapStyle.Tapered;
        config.ColorR = 1f;
        config.ColorG = 0.2f;
        config.ColorB = 0.4f;

        return new CrosshairDocument
        {
            Id = "cx_sample",
            Name = "Sample",
            Description = "Round trip",
            CreatedAt = "2024-01-01T00:00:00.000Z",
            UpdatedAt = "2024-01-02T00:00:00.000Z",
            Config = config,
        };
    }

    [Fact]
    public void ExportThenImportPreservesTheReticle()
    {
        var original = SampleDocument();
        var exported = ImportExportService.ToExchangeFormat(original, "1.0.0").ToJsonString();

        var result = _service.Parse(exported);

        Assert.True(result.Ok, result.ErrorKey);
        var imported = Assert.Single(result.Documents!);
        Assert.Equal("Sample", imported.Name);
        Assert.Equal(original.Config.HLength, imported.Config.HLength);
        Assert.Equal(original.Config.Rotation, imported.Config.Rotation);
        Assert.Equal(original.Config.CapStyle, imported.Config.CapStyle);
        Assert.Equal(original.Config.DotShape, imported.Config.DotShape);
        // Colours round-trip through 8-bit hex, so compare at that resolution.
        Assert.Equal(
            ImportExportService.Hex(original.Config.ColorR, original.Config.ColorG, original.Config.ColorB),
            ImportExportService.Hex(imported.Config.ColorR, imported.Config.ColorG, imported.Config.ColorB));
    }

    [Fact]
    public void ExportUsesTheDocumentedShape()
    {
        var json = ImportExportService.ToExchangeFormat(SampleDocument(), "9.9.9");
        Assert.Equal(ImportExportService.DocumentFormat, json["format"]!.GetValue<string>());
        Assert.Equal(1, json["version"]!.GetValue<int>());
        Assert.Equal("9.9.9", json["app"]!["version"]!.GetValue<string>());

        var crosshair = json["crosshair"]!.AsObject();
        Assert.True(crosshair.ContainsKey("horizontal"));
        Assert.True(crosshair.ContainsKey("outline"));
        Assert.Equal("tapered", crosshair["arms"]!["capStyle"]!.GetValue<string>());
        Assert.Equal("round", crosshair["dot"]!["shape"]!.GetValue<string>());
        Assert.Matches("^#[0-9A-F]{6}$", crosshair["color"]!.GetValue<string>());
    }

    [Fact]
    public void ImportsAPresetPack()
    {
        var pack = new JsonObject
        {
            ["format"] = ImportExportService.PresetPackFormat,
            ["version"] = 1,
            ["presets"] = new JsonArray(
                ImportExportService.ToExchangeFormat(SampleDocument(), "1.0.0"),
                ImportExportService.ToExchangeFormat(SampleDocument(), "1.0.0")),
        };

        var result = _service.Parse(pack.ToJsonString());

        Assert.True(result.Ok);
        Assert.Equal(2, result.Documents!.Count);
        Assert.All(result.Documents!, document => Assert.Equal("preset", document.Kind));
    }

    [Fact]
    public void ImportsABareArray()
    {
        var array = new JsonArray(
            ImportExportService.ToExchangeFormat(SampleDocument(), "1.0.0"),
            new JsonObject { ["name"] = "Minimal" });

        var result = _service.Parse(array.ToJsonString());

        Assert.True(result.Ok);
        Assert.Equal(2, result.Documents!.Count);
        Assert.Equal("Minimal", result.Documents![1].Name);
    }

    [Fact]
    public void ReadsAFlatConfigurationWithoutTranslatingIt()
    {
        var result = _service.Parse("""{"h_length": 21, "color_r": 1, "dot_enabled": 1}""");
        Assert.True(result.Ok);
        Assert.Equal(21f, result.Documents![0].Config.HLength);
        Assert.Equal(1, result.Documents![0].Config.DotEnabled);
    }

    [Theory]
    [InlineData("", "import.errorEmpty")]
    [InlineData("    ", "import.errorEmpty")]
    [InlineData("{ not json", "import.errorJson")]
    [InlineData("\"just a string\"", "import.errorShape")]
    [InlineData("42", "import.errorShape")]
    [InlineData("{\"unrelated\": true}", "import.errorShape")]
    [InlineData("[]", "import.errorEmpty")]
    public void MalformedInputFailsWithATranslatableReason(string input, string expected)
    {
        var result = _service.Parse(input);
        Assert.False(result.Ok);
        Assert.Equal(expected, result.ErrorKey);
        Assert.Null(result.Documents);
    }

    [Fact]
    public void AnUnknownFormatIsRefused()
    {
        var json = new JsonObject
        {
            ["format"] = "somebody-elses-format",
            ["crosshair"] = new JsonObject { ["scale"] = 1 },
        };
        var result = _service.Parse(json.ToJsonString());
        Assert.False(result.Ok);
        Assert.Equal("import.errorFormat", result.ErrorKey);
    }

    [Fact]
    public void AFutureVersionIsRefused()
    {
        var json = new JsonObject
        {
            ["format"] = ImportExportService.DocumentFormat,
            ["version"] = 99,
            ["crosshair"] = new JsonObject { ["scale"] = 1 },
        };
        var result = _service.Parse(json.ToJsonString());
        Assert.False(result.Ok);
        Assert.Equal("import.errorVersion", result.ErrorKey);
    }

    [Fact]
    public void OversizedPayloadsAreRefusedBeforeParsing()
    {
        Assert.Equal("import.errorTooLarge", _service.Parse(new string('x', 4_000_001)).ErrorKey);

        var many = new JsonArray();
        for (var i = 0; i < 501; i++) many.Add(new JsonObject { ["name"] = $"n{i}" });
        Assert.Equal("import.errorTooMany", _service.Parse(many.ToJsonString()).ErrorKey);
    }

    [Fact]
    public void AnUnreadableColourIsReportedAndReplaced()
    {
        var json = """{"crosshair": {"color": "definitely not a colour"}}""";
        var result = _service.Parse(json);
        Assert.True(result.Ok);
        Assert.Contains("invalidColor", result.Warnings!);
        Assert.Equal(CrosshairConfig.CreateDefault().ColorG, result.Documents![0].Config.ColorG);
    }

    [Theory]
    [InlineData("#0f8", 0x00FF88u)]
    [InlineData("#00FF88", 0x00FF88u)]
    [InlineData("00ff88", 0x00FF88u)]
    [InlineData("  #FFF  ", 0xFFFFFFu)]
    public void HexParsingAcceptsTheUsualNotations(string input, uint expected)
    {
        Assert.True(ImportExportService.TryParseHex(input, out var value));
        Assert.Equal(expected, value);
    }

    [Theory]
    [InlineData("#gggggg")]
    [InlineData("#12345")]
    [InlineData("rebeccapurple")]
    [InlineData("")]
    [InlineData(null)]
    public void HexParsingRejectsEverythingElse(string? input)
    {
        Assert.False(ImportExportService.TryParseHex(input, out _));
    }

    [Fact]
    public void HexFormattingClampsOutOfGamutChannels()
    {
        Assert.Equal("#00FF80", ImportExportService.Hex(-1f, 2f, 0.5f));
        Assert.Equal("#000000", ImportExportService.Hex(0f, 0f, 0f));
        Assert.Equal("#FFFFFF", ImportExportService.Hex(1f, 1f, 1f));
    }

    [Theory]
    [InlineData("""{"crosshair": {"horizontal": null, "dot": 42, "arms": "nope"}}""")]
    [InlineData("""{"crosshair": {"scale": {"nested": true}}}""")]
    [InlineData("""{"h_length": "NaN", "color_r": null}""")]
    [InlineData("""{"crosshair": {"horizontal": {"length": 1e308}}}""")]
    [InlineData("""{"crosshair": {"arms": {"capStyle": 999}}}""")]
    public void AdversarialStructuresNeverThrow(string json)
    {
        var result = _service.Parse(json);
        if (!result.Ok)
        {
            Assert.StartsWith("import.", result.ErrorKey);
            return;
        }
        foreach (var document in result.Documents!)
        {
            Assert.True(float.IsFinite(document.Config.HLength));
            Assert.True(float.IsFinite(document.Config.Scale));
        }
    }

    [Fact]
    public void ReadingAMissingFileFailsCleanly()
    {
        var result = _service.ParseFile(Path.Combine(Path.GetTempPath(), "reticlex-not-here.json"));
        Assert.False(result.Ok);
        Assert.Equal("import.errorRead", result.ErrorKey);
    }

    [Fact]
    public void ReadingARealFileWorks()
    {
        using var workspace = new TempWorkspace();
        var path = Path.Combine(workspace.Root, "exported.json");
        File.WriteAllText(path, ImportExportService.ToExchangeFormat(SampleDocument(), "1.0.0").ToJsonString());

        var result = _service.ParseFile(path);

        Assert.True(result.Ok);
        Assert.Equal("Sample", result.Documents![0].Name);
    }

    [Fact]
    public void ImportedDocumentsGetFreshIdentities()
    {
        var exported = ImportExportService.ToExchangeFormat(SampleDocument(), "1.0.0").ToJsonString();
        var first = _service.Parse(exported).Documents![0];
        var second = _service.Parse(exported).Documents![0];
        Assert.NotEqual(first.Id, second.Id);
        Assert.NotEqual("cx_sample", first.Id);
    }
}
