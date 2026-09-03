using System.IO;
using System.Threading;
using System.Windows;
using System.Windows.Threading;
using ReticleX.Core.Services;

// WPF's implicit usings bring in System.Windows.Shapes.Path, which would make
// every file-system call here ambiguous.
using Path = System.IO.Path;

namespace ReticleX.App;

/// <summary>
/// Application entry point: single-instance guard, storage setup and the
/// last-resort exception handlers.
/// </summary>
public partial class App : Application
{
    private const string InstanceMutexName = @"Local\ReticleX.SingleInstance";

    private Mutex? _instanceMutex;

    public static AppPaths Paths { get; private set; } = null!;
    public static AppLog Log { get; private set; } = null!;
    public static LocalizationCatalog Strings { get; private set; } = new();

    /// <summary>Directory holding the web front end, catalogues and presets.</summary>
    public static string ContentRoot { get; private set; } = string.Empty;

    /// <summary>
    /// A file passed on the command line, if the app was launched by one.
    /// The window takes it once the page is ready; see <see cref="TakePendingFile"/>.
    /// </summary>
    private static string? _pendingFile;

    /// <summary>Returns the queued file and clears it, so it opens exactly once.</summary>
    public static string? TakePendingFile()
    {
        var path = _pendingFile;
        _pendingFile = null;
        return path;
    }

    protected override void OnStartup(StartupEventArgs e)
    {
        // A second launch would fight the first over the same data directory,
        // so hand focus back and exit instead.
        _instanceMutex = new Mutex(initiallyOwned: true, InstanceMutexName, out var isFirstInstance);
        if (!isFirstInstance)
        {
            NativeMethods.ActivateExistingInstance();
            Shutdown();
            return;
        }

        Paths = AppPaths.ForCurrentUser();
        Paths.EnsureCreated();
        Log = new AppLog(Paths.LogFile);

        ContentRoot = ResolveContentRoot();

        var settings = LoadSettingsForStartup();
        Strings.Load(
            Path.Combine(ContentRoot, "localization"),
            settings?.Locale ?? LocalizationCatalog.SystemLocale());

        if (e.Args.Length > 0 && File.Exists(e.Args[0]))
        {
            _pendingFile = e.Args[0];
        }

        DispatcherUnhandledException += OnDispatcherUnhandledException;
        AppDomain.CurrentDomain.UnhandledException += OnDomainUnhandledException;
        TaskScheduler.UnobservedTaskException += (_, args) =>
        {
            Log.Error("An unobserved task failed.", args.Exception);
            args.SetObserved();
        };

        Log.Info($"ReticleX starting. Data: {Paths.Root}; content: {ContentRoot}");
        base.OnStartup(e);

        // Created explicitly rather than through StartupUri so the
        // single-instance check above can exit before any window exists.
        var window = new MainWindow();
        MainWindow = window;
        window.Show();
    }

    /// <summary>
    /// Content sits in an "app" folder beside the executable once installed.
    /// During development the executable lives deep inside bin/, so the
    /// repository layout is accepted as a fallback.
    /// </summary>
    private static string ResolveContentRoot()
    {
        var beside = Path.Combine(AppContext.BaseDirectory, "app");
        if (Directory.Exists(Path.Combine(beside, "frontend"))) return beside;

        var probe = new DirectoryInfo(AppContext.BaseDirectory);
        for (var depth = 0; probe is not null && depth < 8; depth++)
        {
            if (Directory.Exists(Path.Combine(probe.FullName, "frontend"))
                && Directory.Exists(Path.Combine(probe.FullName, "localization")))
            {
                return probe.FullName;
            }
            probe = probe.Parent;
        }

        return beside;
    }

    private static ReticleX.Core.Models.AppSettings? LoadSettingsForStartup()
    {
        try
        {
            if (!File.Exists(Paths.SettingsFile)) return null;
            return ReticleX.Core.Models.AppSettings.FromJson(File.ReadAllText(Paths.SettingsFile));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            Log.Warn("Settings could not be read at start-up.", error);
            return null;
        }
    }

    private void OnDispatcherUnhandledException(
        object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        Log.Error("An unhandled error reached the dispatcher.", e.Exception);
        e.Handled = true;

        MessageBox.Show(
            $"{Strings.Get("error.title")}\n\n{e.Exception.Message}\n\n{Paths.LogFile}",
            "ReticleX",
            MessageBoxButton.OK,
            MessageBoxImage.Warning);
    }

    private void OnDomainUnhandledException(object sender, UnhandledExceptionEventArgs e)
    {
        Log.Error("An unhandled error reached the app domain.", e.ExceptionObject as Exception);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        Log?.Info("ReticleX exiting.");
        _instanceMutex?.Dispose();
        base.OnExit(e);
    }
}
