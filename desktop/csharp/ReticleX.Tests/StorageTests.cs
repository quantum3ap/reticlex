using System.Text.Json;
using ReticleX.Core.Models;
using ReticleX.Core.Services;
using Xunit;

namespace ReticleX.Tests;

public class StorageTests
{
    private static CrosshairDocument NewDocument(string name = "Test")
    {
        var config = CrosshairConfig.CreateDefault();
        config.HGap = 6.5f;
        return new CrosshairDocument
        {
            Id = CrosshairDocument.NewId("cx"),
            Name = name,
            Description = "A test reticle",
            CreatedAt = DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
            UpdatedAt = DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
            Config = config,
        };
    }

    [Fact]
    public void ADocumentSurvivesASaveAndReload()
    {
        using var workspace = new TempWorkspace();
        var saved = workspace.Library.SaveCrosshair(NewDocument("Persisted"));

        var loaded = workspace.Library.LoadCrosshairs();
        var single = Assert.Single(loaded);
        Assert.Equal("Persisted", single.Name);
        Assert.Equal(saved.Id, single.Id);
        Assert.Equal(6.5f, single.Config.HGap);
    }

    [Fact]
    public void ResavingUpdatesInPlaceRatherThanDuplicating()
    {
        using var workspace = new TempWorkspace();
        var saved = workspace.Library.SaveCrosshair(NewDocument("First"));
        saved.Name = "Second";
        workspace.Library.SaveCrosshair(saved);

        var loaded = workspace.Library.LoadCrosshairs();
        Assert.Single(loaded);
        Assert.Equal("Second", loaded[0].Name);
        Assert.Single(Directory.GetFiles(workspace.Paths.Crosshairs, "*.json"));
    }

    [Fact]
    public void CrosshairsAndPresetsAreKeptApart()
    {
        using var workspace = new TempWorkspace();
        workspace.Library.SaveCrosshair(NewDocument("A crosshair"));
        workspace.Library.SavePreset(NewDocument("A preset"));

        Assert.Single(workspace.Library.LoadCrosshairs());
        Assert.Single(workspace.Library.LoadPresets());
        Assert.Equal("crosshair", workspace.Library.LoadCrosshairs()[0].Kind);
        Assert.Equal("preset", workspace.Library.LoadPresets()[0].Kind);
    }

    [Fact]
    public void DeletingRemovesTheFile()
    {
        using var workspace = new TempWorkspace();
        var saved = workspace.Library.SaveCrosshair(NewDocument());
        workspace.Library.DeleteCrosshair(saved.Id);

        Assert.Empty(workspace.Library.LoadCrosshairs());
        Assert.Empty(Directory.GetFiles(workspace.Paths.Crosshairs, "*.json"));
    }

    [Fact]
    public void DeletingSomethingThatIsNotThereIsHarmless()
    {
        using var workspace = new TempWorkspace();
        workspace.Library.DeleteCrosshair("cx_never_existed");
        workspace.Library.DeletePreset("ps_never_existed");
    }

    [Fact]
    public void OneCorruptFileDoesNotHideTheRest()
    {
        using var workspace = new TempWorkspace();
        workspace.Library.SaveCrosshair(NewDocument("Good one"));
        File.WriteAllText(Path.Combine(workspace.Paths.Crosshairs, "broken.json"), "{ not json");

        var loaded = workspace.Library.LoadCrosshairs();

        Assert.Single(loaded);
        Assert.Equal("Good one", loaded[0].Name);
        // The unreadable file is moved aside rather than deleted.
        Assert.Empty(Directory.GetFiles(workspace.Paths.Crosshairs, "broken.json"));
        Assert.NotEmpty(Directory.GetFiles(workspace.Paths.Crosshairs, "*.corrupt"));
    }

    [Fact]
    public void AnImplausiblyLargeFileIsQuarantined()
    {
        using var workspace = new TempWorkspace();
        var path = Path.Combine(workspace.Paths.Crosshairs, "huge.json");
        File.WriteAllText(path, new string('x', (int)JsonStore.MaxDocumentBytes + 16));

        Assert.Empty(workspace.Library.LoadCrosshairs());
        Assert.False(File.Exists(path));
    }

    [Fact]
    public void AnEmptyFileIsSkippedWithoutQuarantine()
    {
        using var workspace = new TempWorkspace();
        File.WriteAllText(Path.Combine(workspace.Paths.Crosshairs, "empty.json"), "   ");
        Assert.Empty(workspace.Library.LoadCrosshairs());
    }

    [Fact]
    public void WritesAreAtomicAndLeaveNoTemporaryFile()
    {
        using var workspace = new TempWorkspace();
        var path = Path.Combine(workspace.Root, "sample.json");
        workspace.Store.WriteText(path, "{\"a\":1}");
        workspace.Store.WriteText(path, "{\"a\":2}");

        Assert.Equal("{\"a\":2}", File.ReadAllText(path));
        Assert.Empty(Directory.GetFiles(workspace.Root, "*.tmp"));
    }

    [Fact]
    public void WritingCreatesMissingDirectories()
    {
        using var workspace = new TempWorkspace();
        var path = Path.Combine(workspace.Root, "deep", "nested", "file.json");
        workspace.Store.WriteText(path, "{}");
        Assert.True(File.Exists(path));
    }

    [Fact]
    public void ClearingRemovesEveryUserDocument()
    {
        using var workspace = new TempWorkspace();
        workspace.Library.SaveCrosshair(NewDocument("One"));
        workspace.Library.SaveCrosshair(NewDocument("Two"));
        workspace.Library.SavePreset(NewDocument("Preset"));

        workspace.Library.Clear();

        Assert.Empty(workspace.Library.LoadCrosshairs());
        Assert.Empty(workspace.Library.LoadPresets());
        // The directories survive so the next save does not have to recreate them.
        Assert.True(Directory.Exists(workspace.Paths.Crosshairs));
    }

    [Fact]
    public void DocumentsComeBackNewestFirst()
    {
        using var workspace = new TempWorkspace();
        foreach (var name in new[] { "Oldest", "Middle", "Newest" })
        {
            var document = NewDocument(name);
            document.UpdatedAt = name switch
            {
                "Oldest" => "2020-01-01T00:00:00.000Z",
                "Middle" => "2022-01-01T00:00:00.000Z",
                _ => "2024-01-01T00:00:00.000Z",
            };
            workspace.Library.SaveCrosshair(document);
        }

        var loaded = workspace.Library.LoadCrosshairs();
        Assert.Equal(new[] { "Newest", "Middle", "Oldest" }, loaded.Select(d => d.Name));
    }

    [Fact]
    public void SavingStampsAnUpdateTimeWhenOneIsMissing()
    {
        using var workspace = new TempWorkspace();
        var document = NewDocument();
        document.UpdatedAt = string.Empty;
        var saved = workspace.Library.SaveCrosshair(document);
        Assert.False(string.IsNullOrWhiteSpace(saved.UpdatedAt));
    }

    [Fact]
    public void SettingsSurviveARestart()
    {
        using var workspace = new TempWorkspace();
        var settings = AppSettings.FromJson("""{"theme":"midnight","locale":"ja","uiScale":1.15}""");
        workspace.Store.WriteText(workspace.Paths.SettingsFile, settings.ToJson());

        var reloaded = AppSettings.FromJson(File.ReadAllText(workspace.Paths.SettingsFile));
        Assert.Equal("ja", reloaded.Locale);
        Assert.Equal("midnight", reloaded.Values["theme"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("{ broken")]
    [InlineData("[1,2,3]")]
    [InlineData("\"a string\"")]
    [InlineData("null")]
    public void CorruptSettingsFallBackToEmptyRatherThanThrowing(string json)
    {
        var settings = AppSettings.FromJson(json);
        Assert.Null(settings.Locale);
        Assert.False(settings.StartWithWindows);
        Assert.NotNull(settings.ToJson());
    }

    [Theory]
    [InlineData("""{"locale":7}""")]
    [InlineData("""{"locale":null}""")]
    [InlineData("""{"locale":{"code":"ar"}}""")]
    [InlineData("""{"locale":["ar"]}""")]
    [InlineData("""{"startWithWindows":"yes"}""")]
    public void MistypedPreferencesReadAsUnsetRatherThanThrowing(string json)
    {
        // These are read before the window exists, so a hand-edited file that
        // puts the wrong kind of value here must read as "not chosen" rather
        // than take the whole application down.
        var settings = AppSettings.FromJson(json);
        Assert.Null(settings.Locale);
        Assert.False(settings.StartWithWindows);
    }

    [Fact]
    public void SettingsBeyondTheSizeCapAreRefused()
    {
        var huge = "{\"pad\":\"" + new string('x', AppSettings.MaxBytes) + "\"}";
        Assert.Null(AppSettings.FromJson(huge).Locale);
    }

    [Fact]
    public void PathsStayInsideThePerUserDirectory()
    {
        var paths = AppPaths.ForCurrentUser();
        Assert.EndsWith(AppPaths.FolderName, paths.Root);
        Assert.StartsWith(paths.Root, paths.Crosshairs);
        Assert.StartsWith(paths.Root, paths.SettingsFile);
        Assert.Equal(Path.Combine(paths.Crosshairs, "abc.json"), paths.CrosshairFile("abc"));
    }
}
