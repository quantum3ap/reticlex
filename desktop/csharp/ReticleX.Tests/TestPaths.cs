using ReticleX.Core.Services;

namespace ReticleX.Tests;

/// <summary>
/// A throwaway data directory per test, so nothing touches the real profile
/// and tests never see each other's files.
/// </summary>
public sealed class TempWorkspace : IDisposable
{
    public TempWorkspace()
    {
        Root = Path.Combine(Path.GetTempPath(), "reticlex-tests", Guid.NewGuid().ToString("N"));
        Paths = new AppPaths(Root);
        Paths.EnsureCreated();
        Store = new JsonStore();
        Library = new CrosshairLibrary(Paths, Store);
    }

    public string Root { get; }
    public AppPaths Paths { get; }
    public JsonStore Store { get; }
    public CrosshairLibrary Library { get; }

    public void Dispose()
    {
        try
        {
            if (Directory.Exists(Root)) Directory.Delete(Root, recursive: true);
        }
        catch (IOException)
        {
            // A leftover temporary directory is not worth failing a test over.
        }
    }
}

/// <summary>Locates repository content the tests read.</summary>
public static class TestContent
{
    /// <summary>
    /// The copied localization folder beside the test binary, falling back to
    /// the repository when running from a source checkout.
    /// </summary>
    public static string LocalizationDirectory => Resolve("localization");

    public static string PresetsDirectory => Resolve("presets");

    private static string Resolve(string folder)
    {
        var beside = Path.Combine(AppContext.BaseDirectory, folder);
        if (Directory.Exists(beside)) return beside;

        var probe = new DirectoryInfo(AppContext.BaseDirectory);
        for (var depth = 0; probe is not null && depth < 10; depth++)
        {
            var candidate = Path.Combine(probe.FullName, folder);
            if (Directory.Exists(candidate) && File.Exists(Path.Combine(probe.FullName, "README.md")))
            {
                return candidate;
            }
            probe = probe.Parent;
        }
        return beside;
    }
}
