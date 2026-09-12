using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;
using ReticleX.App.Host;
using ReticleX.Core.Interop;
using ReticleX.Core.Services;

// Disambiguate from System.Windows.Shapes.Path, an implicit using in WPF.
using Path = System.IO.Path;

namespace ReticleX.App;

/// <summary>
/// The application window: a borderless frame around the WebView2 that renders
/// the interface, plus the bridge that connects it to the host.
/// </summary>
public partial class MainWindow : Window
{
    private const string VirtualHost = "reticlex.invalid";
    private const string StartPage = "https://reticlex.invalid/frontend/index.html";
    private const string RuntimeDownloadUrl = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

    private readonly AppPaths _paths;
    private readonly JsonStore _store;
    private readonly CrosshairLibrary _library;
    private readonly ThumbnailService _thumbnails;
    private readonly OverlayController _overlay;
    private readonly TrayIcon _tray;

    private WebBridge? _bridge;
    private bool _initialising;

    private string _trayToggleLabel = "Show the overlay";
    private string _trayOpenLabel = "Open ReticleX";
    private string _trayExitLabel = "Exit";
    private string _trayName = "ReticleX";
    private string _trayOnSuffix = "overlay on";
    private string _trayOffSuffix = "overlay off";

    public static string AppVersion { get; } =
        Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.0.0";

    public MainWindow()
    {
        InitializeComponent();

        _paths = App.Paths;
        _store = new JsonStore((message, error) => App.Log.Warn(message, error));
        _library = new CrosshairLibrary(_paths, _store);
        _thumbnails = new ThumbnailService(_paths, (message, error) => App.Log.Warn(message, error));
        _overlay = new OverlayController((message, error) => App.Log.Warn(message, error));
        _tray = new TrayIcon(
            onToggleOverlay: () => _overlay.Toggle(),
            onOpen: RestoreAndFocus,
            onExit: Close,
            log: (message, error) => App.Log.Warn(message, error));
        // The icon follows the overlay however it was switched: button, tray or
        // shortcut all end up here.
        _overlay.Changed += options => _tray.SetState(
            options.Enabled, TrayTooltip(options.Enabled),
            _trayToggleLabel, _trayOpenLabel, _trayExitLabel);

        // Set here rather than in XAML: the property is a System.Drawing colour
        // and the markup converter for it is not dependable.
        WebView.DefaultBackgroundColor = System.Drawing.Color.FromArgb(0xFF, 0x08, 0x09, 0x0C);

        StateChanged += OnStateChanged;
        Loaded += async (_, _) => await InitialiseWebViewAsync();
        // The overlay is a second top-level window; closing the main one has to
        // take it down too, or the process would stay alive with nothing shown.
        Closed += (_, _) => { _tray.Dispose(); _overlay.Dispose(); };
    }

    // --- Start-up -----------------------------------------------------------

    private async Task InitialiseWebViewAsync()
    {
        if (_initialising) return;
        _initialising = true;

        try
        {
            if (NativeCore.IsAvailable)
            {
                App.Log.Info($"Native core loaded: ABI {NativeCore.AbiVersion}, schema {NativeCore.SchemaVersion}.");
            }
            else
            {
                // The front end has its own WebAssembly build of the same core,
                // so the interface still works; only host-side rendering is lost.
                App.Log.Warn("reticlex_core.dll was not loaded; thumbnails are disabled.");
            }

            var frontEnd = Path.Combine(App.ContentRoot, "frontend", "index.html");
            if (!File.Exists(frontEnd))
            {
                ShowFailure(
                    App.Strings.Get("error.title"),
                    App.Strings.Get("error.loadFailed"),
                    frontEnd,
                    offerRuntime: false);
                return;
            }

            // Keep the browser profile inside our own data directory rather than
            // scattering it through the user's profile.
            var profile = Path.Combine(_paths.Root, "webview");

            // The autoplay argument buys one thing: the start-up sound plays
            // without a click the user has no reason to make. It is not worth
            // the application over, and a profile already open under a
            // different command line will refuse it, so a refusal falls back
            // to a plain environment and a silent sequence.
            CoreWebView2Environment environment;
            try
            {
                environment = await CreateEnvironmentAsync(profile, AutoplayArgument);
            }
            catch (Exception error) when (error is not WebView2RuntimeNotFoundException)
            {
                App.Log.Warn(
                    $"WebView2 would not take the start-up audio argument, so the sequence "
                    + $"will be silent: {error.Message}");
                environment = await CreateEnvironmentAsync(profile, null);
            }

            await WebView.EnsureCoreWebView2Async(environment);
            ConfigureWebView();

            _bridge = new WebBridge(WebView, this, _paths, _store, _library, _thumbnails, _overlay);
            WebView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;

            WebView.CoreWebView2.Navigate(StartPage);
            WebView.Visibility = Visibility.Visible;
            FailurePanel.Visibility = Visibility.Collapsed;
        }
        catch (WebView2RuntimeNotFoundException error)
        {
            App.Log.Error("The WebView2 runtime is not installed.", error);
            ShowFailure(
                App.Strings.Get("error.coreFailed"),
                App.Strings.Get("error.coreFailedBody"),
                error.Message,
                offerRuntime: true);
        }
        catch (Exception error)
        {
            App.Log.Error("The web view could not be created.", error);
            ShowFailure(
                App.Strings.Get("error.title"),
                App.Strings.Get("error.loadFailed"),
                error.Message,
                offerRuntime: false);
        }
        finally
        {
            _initialising = false;
        }
    }

    private const string AutoplayArgument = "--autoplay-policy=no-user-gesture-required";

    private static Task<CoreWebView2Environment> CreateEnvironmentAsync(
        string userDataFolder, string? browserArguments)
    {
        var options = new CoreWebView2EnvironmentOptions { Language = App.Strings.Locale };
        if (browserArguments is not null)
        {
            options.AdditionalBrowserArguments = browserArguments;
        }

        return CoreWebView2Environment.CreateAsync(
            browserExecutableFolder: null,
            userDataFolder: userDataFolder,
            options: options);
    }

    private void ConfigureWebView()
    {
        var core = WebView.CoreWebView2;

        // Serve the shipped content from a virtual origin. Mapping the whole
        // content root (not just /frontend) is what lets the page reach
        // ../localization and ../presets with the same relative paths it uses
        // when opened directly in a browser during development.
        // DenyCors rather than Allow: the interface only ever fetches its own
        // origin, so nothing needs cross-origin access to these files.
        core.SetVirtualHostNameToFolderMapping(
            VirtualHost, App.ContentRoot, CoreWebView2HostResourceAccessKind.DenyCors);

        var settings = core.Settings;
        settings.AreDefaultContextMenusEnabled = false;
        settings.IsStatusBarEnabled = false;
        settings.IsSwipeNavigationEnabled = false;
        settings.AreBrowserAcceleratorKeysEnabled = false;
        settings.IsGeneralAutofillEnabled = false;
        settings.IsPasswordAutosaveEnabled = false;
        settings.IsZoomControlEnabled = false;
#if DEBUG
        settings.AreDevToolsEnabled = true;
#else
        settings.AreDevToolsEnabled = false;
#endif

        // The interface is local; nothing should ever navigate away from it or
        // open a second window.
        core.NewWindowRequested += (_, args) =>
        {
            args.Handled = true;
            if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri)
                && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
            {
                Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
            }
        };

        // The interface is local and self-contained; nothing should navigate
        // away from it. about:blank is allowed because WebView2 uses it while
        // initialising.
        core.NavigationStarting += (_, args) =>
        {
            var allowed = args.Uri.StartsWith($"https://{VirtualHost}/", StringComparison.OrdinalIgnoreCase)
                          || args.Uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase);
            if (!allowed)
            {
                App.Log.Warn($"Blocked a navigation to {args.Uri}.");
                args.Cancel = true;
            }
        };

        core.NavigationCompleted += (_, args) =>
        {
            if (!args.IsSuccess)
            {
                App.Log.Error($"Navigation failed: {args.WebErrorStatus}.");
                return;
            }
            EmitWindowState();
            OpenPendingFile();
        };

        core.ProcessFailed += (_, args) =>
        {
            App.Log.Error($"The web view process failed: {args.ProcessFailedKind}.");
            ShowFailure(
                App.Strings.Get("error.title"),
                App.Strings.Get("error.loadFailed"),
                args.ProcessFailedKind.ToString(),
                offerRuntime: false);
        };
    }

    /// <summary>
    /// Hands the front end a file the user launched the application with, so
    /// double-clicking an exported crosshair opens it.
    /// </summary>
    private void OpenPendingFile()
    {
        if (_bridge is null) return;
        var path = App.TakePendingFile();
        if (path is null) return;

        var result = new ImportExportService().ParseFile(path);
        if (!result.Ok)
        {
            _bridge.Emit("import-failed", new JsonObject
            {
                ["errorKey"] = result.ErrorKey,
                ["detail"] = result.Detail,
            });
            return;
        }

        _bridge.Emit("open-file", new JsonObject
        {
            ["fileName"] = Path.GetFileName(path),
            ["text"] = File.ReadAllText(path),
        });
    }

    private string TrayTooltip(bool overlayOn) =>
        $"{_trayName} — {(overlayOn ? _trayOnSuffix : _trayOffSuffix)}";

    /// <summary>Puts the tray icon up and gives it its first set of labels.</summary>
    public void ConfigureTray(string? name, string? onSuffix, string? offSuffix,
                              string? toggleLabel, string? openLabel, string? exitLabel)
    {
        if (!string.IsNullOrWhiteSpace(name)) _trayName = name;
        if (!string.IsNullOrWhiteSpace(onSuffix)) _trayOnSuffix = onSuffix;
        if (!string.IsNullOrWhiteSpace(offSuffix)) _trayOffSuffix = offSuffix;
        if (!string.IsNullOrWhiteSpace(toggleLabel)) _trayToggleLabel = toggleLabel;
        if (!string.IsNullOrWhiteSpace(openLabel)) _trayOpenLabel = openLabel;
        if (!string.IsNullOrWhiteSpace(exitLabel)) _trayExitLabel = exitLabel;

        _tray.Show();
        _tray.SetState(_overlay.Options.Enabled, TrayTooltip(_overlay.Options.Enabled),
                       _trayToggleLabel, _trayOpenLabel, _trayExitLabel);
    }

    /// <summary>Brings the window back from the tray or the task bar.</summary>
    public void RestoreAndFocus()
    {
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Show();
        Activate();
        Topmost = true;
        Topmost = false;
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        // The bridge is the one place the page can reach the file system, so
        // the sender is checked rather than assumed. Navigation is already
        // confined to the virtual host; this states the same boundary at the
        // point where it actually matters.
        if (!e.Source.StartsWith($"https://{VirtualHost}/", StringComparison.OrdinalIgnoreCase))
        {
            App.Log.Warn($"Ignored a bridge message from {e.Source}.");
            return;
        }

        try
        {
            _bridge?.Handle(e.WebMessageAsJson);
        }
        catch (Exception error)
        {
            App.Log.Error("A bridge message could not be handled.", error);
        }
    }

    // --- Window commands ----------------------------------------------------

    /// <summary>Runs a chrome command the front end's title bar asked for.</summary>
    public void RunWindowCommand(string action)
    {
        switch (action)
        {
            case "minimize":
                WindowState = WindowState.Minimized;
                break;
            case "maximize":
            case "toggleMaximize":
                WindowState = WindowState == WindowState.Maximized
                    ? WindowState.Normal
                    : WindowState.Maximized;
                break;
            case "restore":
                WindowState = WindowState.Normal;
                break;
            case "drag":
                // Started from a pointerdown in the page, so the button is still
                // held and the window manager can take over the move.
                NativeMethods.BeginDrag(new WindowInteropHelper(this).Handle);
                break;
            case "close":
                Close();
                break;
            default:
                App.Log.Warn($"Unknown window command \"{action}\".");
                break;
        }
    }

    private void OnStateChanged(object? sender, EventArgs e)
    {
        // Maximised, the window overhangs the work area by the resize border,
        // so the inset that keeps that border hit-testable is dropped.
        WebView.Margin = WindowState == WindowState.Maximized
            ? new Thickness(0)
            : new Thickness(6);

        EmitWindowState();
    }

    private void EmitWindowState()
    {
        _bridge?.Emit("window-state", new JsonObject
        {
            ["maximized"] = WindowState == WindowState.Maximized,
        });
    }

    // --- Failure panel ------------------------------------------------------

    private void ShowFailure(string title, string body, string detail, bool offerRuntime)
    {
        WebView.Visibility = Visibility.Hidden;
        FailurePanel.Visibility = Visibility.Visible;
        FailureTitle.Text = title;
        FailureBody.Text = body;
        FailureDetail.Text = detail;
        RetryButton.Content = App.Strings.Get("error.retry");
        CloseButton.Content = App.Strings.Get("common.close");
        RuntimeButton.Visibility = offerRuntime ? Visibility.Visible : Visibility.Collapsed;
    }

    private async void OnRetryClicked(object sender, RoutedEventArgs e) =>
        await InitialiseWebViewAsync();

    private void OnDownloadRuntimeClicked(object sender, RoutedEventArgs e)
    {
        Process.Start(new ProcessStartInfo(RuntimeDownloadUrl) { UseShellExecute = true });
    }

    private void OnCloseClicked(object sender, RoutedEventArgs e) => Close();
}
