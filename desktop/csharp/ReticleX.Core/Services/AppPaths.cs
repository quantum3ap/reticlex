namespace ReticleX.Core.Services;

/// <summary>
/// Where ReticleX keeps its data.
/// </summary>
/// <remarks>
/// Everything lives under the per-user application data directory, so the
/// application never needs administrator rights and two accounts on the same
/// machine keep separate libraries. The root is injectable so tests can run
/// against a temporary directory.
/// </remarks>
public sealed class AppPaths
{
    public const string FolderName = "ReticleX";

    public AppPaths(string root)
    {
        Root = root;
        Crosshairs = Path.Combine(root, "crosshairs");
        Presets = Path.Combine(root, "presets");
        Thumbnails = Path.Combine(root, "thumbnails");
        Logs = Path.Combine(root, "logs");
        SettingsFile = Path.Combine(root, "settings.json");
        LogFile = Path.Combine(Logs, "reticlex.log");
    }

    /// <summary>%APPDATA%\ReticleX on Windows; the platform equivalent elsewhere.</summary>
    public static AppPaths ForCurrentUser()
    {
        var appData = Environment.GetFolderPath(
            Environment.SpecialFolder.ApplicationData,
            Environment.SpecialFolderOption.Create);

        // GetFolderPath can return an empty string on a locked-down profile.
        if (string.IsNullOrEmpty(appData))
        {
            appData = Path.Combine(Path.GetTempPath(), FolderName + "-data");
        }

        return new AppPaths(Path.Combine(appData, FolderName));
    }

    public string Root { get; }
    public string Crosshairs { get; }
    public string Presets { get; }
    public string Thumbnails { get; }
    public string Logs { get; }
    public string SettingsFile { get; }
    public string LogFile { get; }

    /// <summary>Creates every directory the application writes to.</summary>
    public void EnsureCreated()
    {
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(Crosshairs);
        Directory.CreateDirectory(Presets);
        Directory.CreateDirectory(Thumbnails);
        Directory.CreateDirectory(Logs);
    }

    public string CrosshairFile(string id) => Path.Combine(Crosshairs, id + ".json");
    public string PresetFile(string id) => Path.Combine(Presets, id + ".json");
    public string ThumbnailFile(string id) => Path.Combine(Thumbnails, id + ".png");
}
