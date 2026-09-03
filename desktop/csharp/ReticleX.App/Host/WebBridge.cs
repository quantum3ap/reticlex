using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows;
using Microsoft.Web.WebView2.Wpf;
using ReticleX.Core.Models;
using ReticleX.Core.Services;

// Disambiguate from System.Windows.Shapes.Path, an implicit using in WPF.
using Path = System.IO.Path;

namespace ReticleX.App.Host;

/// <summary>
/// The host half of the front end's bridge.
/// </summary>
/// <remarks>
/// A deliberately narrow request/response channel: the web layer names a
/// method and passes JSON, and nothing else about the host is reachable from
/// the page. Every handler validates its own input, because the page is the
/// one part of the system that loads files a user was given by someone else.
/// </remarks>
public sealed class WebBridge
{
    private static readonly JsonSerializerOptions ResponseOptions = new()
    {
        WriteIndented = false,
    };

    /// <summary>A custom preview background larger than this is refused.</summary>
    private const long MaxBackgroundBytes = 1_500_000;

    private readonly WebView2 _webView;
    private readonly MainWindow _window;
    private readonly AppPaths _paths;
    private readonly JsonStore _store;
    private readonly CrosshairLibrary _library;
    private readonly ThumbnailService _thumbnails;
    private readonly Dictionary<string, Func<JsonObject, JsonNode?>> _handlers;

    public WebBridge(
        WebView2 webView,
        MainWindow window,
        AppPaths paths,
        JsonStore store,
        CrosshairLibrary library,
        ThumbnailService thumbnails)
    {
        _webView = webView;
        _window = window;
        _paths = paths;
        _store = store;
        _library = library;
        _thumbnails = thumbnails;

        _handlers = new Dictionary<string, Func<JsonObject, JsonNode?>>(StringComparer.Ordinal)
        {
            ["bootstrap"] = Bootstrap,
            ["saveSettings"] = SaveSettings,
            ["saveCrosshair"] = parameters => SaveDocument(parameters, preset: false),
            ["savePreset"] = parameters => SaveDocument(parameters, preset: true),
            ["deleteCrosshair"] = parameters => DeleteDocument(parameters, preset: false),
            ["deletePreset"] = parameters => DeleteDocument(parameters, preset: true),
            ["clearData"] = ClearData,
            ["openImportDialog"] = OpenImportDialog,
            ["saveExportDialog"] = SaveExportDialog,
            ["savePng"] = SavePng,
            ["pickImage"] = PickImage,
            ["setStartWithWindows"] = SetStartWithWindows,
            ["openExternal"] = OpenExternal,
            ["openDataFolder"] = OpenDataFolder,
            ["window"] = WindowCommand,
        };
    }

    /// <summary>Handles one message from the page and answers it.</summary>
    public void Handle(string json)
    {
        int? id = null;
        try
        {
            if (JsonNode.Parse(json) is not JsonObject request)
            {
                return;
            }

            id = request["id"]?.GetValue<int>();
            var method = request["method"]?.GetValue<string>();
            var parameters = request["params"] as JsonObject ?? new JsonObject();

            if (method is null || !_handlers.TryGetValue(method, out var handler))
            {
                Respond(id, false, null, $"Unknown method \"{method}\".");
                return;
            }

            Respond(id, true, handler(parameters), null);
        }
        catch (Exception error)
        {
            // A failing call must surface as a rejected promise the page can
            // translate, never as a crashed host.
            App.Log.Error($"Bridge call failed: {json[..Math.Min(json.Length, 200)]}", error);
            Respond(id, false, null, error.Message);
        }
    }

    private void Respond(int? id, bool ok, JsonNode? result, string? error)
    {
        if (id is null) return;
        var response = new JsonObject
        {
            ["id"] = id.Value,
            ["ok"] = ok,
        };
        if (ok) response["result"] = result;
        else response["error"] = error ?? "Unknown error";

        Post(response);
    }

    /// <summary>Pushes an unsolicited event, such as a window state change.</summary>
    public void Emit(string name, JsonNode? payload)
    {
        Post(new JsonObject { ["event"] = name, ["payload"] = payload });
    }

    private void Post(JsonNode message)
    {
        if (_webView.CoreWebView2 is null) return;
        _webView.CoreWebView2.PostWebMessageAsJson(message.ToJsonString(ResponseOptions));
    }

    // --- Handlers -----------------------------------------------------------

    private JsonNode? Bootstrap(JsonObject _)
    {
        var settings = ReadSettings();
        var crosshairs = new JsonArray();
        foreach (var document in _library.LoadCrosshairs())
        {
            crosshairs.Add(ToNode(document));
        }
        var presets = new JsonArray();
        foreach (var document in _library.LoadPresets())
        {
            presets.Add(ToNode(document));
        }

        return new JsonObject
        {
            ["appVersion"] = MainWindow.AppVersion,
            ["systemLocale"] = LocalizationCatalog.SystemLocale(),
            ["dataPath"] = _paths.Root,
            ["hasHost"] = true,
            ["startWithWindows"] = StartupRegistry.IsEnabled(),
            ["nativeCore"] = ReticleX.Core.Interop.NativeCore.IsAvailable,
            ["settings"] = settings.Values.DeepClone(),
            ["crosshairs"] = crosshairs,
            ["presets"] = presets,
        };
    }

    private AppSettings ReadSettings()
    {
        try
        {
            if (!File.Exists(_paths.SettingsFile)) return AppSettings.Empty();
            return AppSettings.FromJson(_store.ReadText(_paths.SettingsFile));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException
                                      or InvalidDataException)
        {
            App.Log.Warn("Settings could not be read; falling back to defaults.", error);
            _store.Quarantine(_paths.SettingsFile);
            return AppSettings.Empty();
        }
    }

    private JsonNode? SaveSettings(JsonObject parameters)
    {
        if (parameters["settings"] is not JsonObject settings)
        {
            throw new ArgumentException("saveSettings needs a settings object.");
        }

        // The preview background is the one field that can be large; refuse an
        // oversized one rather than writing a settings file nobody can load.
        if (settings["previewImage"] is JsonValue image
            && image.TryGetValue<string>(out var dataUrl)
            && dataUrl.Length > MaxBackgroundBytes)
        {
            settings["previewImage"] = null;
        }

        _store.WriteText(
            _paths.SettingsFile,
            settings.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        return new JsonObject { ["ok"] = true };
    }

    private JsonNode? SaveDocument(JsonObject parameters, bool preset)
    {
        if (parameters["document"] is not JsonObject node)
        {
            throw new ArgumentException("A document is required.");
        }

        var document = node.Deserialize<CrosshairDocument>(JsonStore.Options)
                       ?? throw new ArgumentException("The document could not be read.");

        var saved = preset ? _library.SavePreset(document) : _library.SaveCrosshair(document);
        _thumbnails.Write(saved);

        return new JsonObject { ["id"] = saved.Id, ["updatedAt"] = saved.UpdatedAt };
    }

    private JsonNode? DeleteDocument(JsonObject parameters, bool preset)
    {
        var id = parameters["id"]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("An id is required.");

        if (preset) _library.DeletePreset(id);
        else _library.DeleteCrosshair(id);

        return new JsonObject { ["id"] = id };
    }

    private JsonNode? ClearData(JsonObject _)
    {
        _library.Clear();
        App.Log.Info("Saved data cleared at the user's request.");
        return new JsonObject { ["ok"] = true };
    }

    private JsonNode? OpenImportDialog(JsonObject _)
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Title = App.Strings.Get("common.import"),
            Filter = "ReticleX crosshair (*.json)|*.json|All files (*.*)|*.*",
            CheckFileExists = true,
            Multiselect = false,
        };

        if (dialog.ShowDialog(_window) != true)
        {
            return new JsonObject { ["ok"] = false, ["cancelled"] = true };
        }

        var info = new FileInfo(dialog.FileName);
        if (info.Length > JsonStore.MaxDocumentBytes)
        {
            return new JsonObject { ["ok"] = false, ["error"] = "tooLarge" };
        }

        return new JsonObject
        {
            ["ok"] = true,
            ["fileName"] = info.Name,
            ["text"] = File.ReadAllText(dialog.FileName),
        };
    }

    private JsonNode? SaveExportDialog(JsonObject parameters)
    {
        var suggested = parameters["suggestedName"]?.GetValue<string>() ?? "crosshair.json";
        var text = parameters["text"]?.GetValue<string>() ?? string.Empty;

        var dialog = new Microsoft.Win32.SaveFileDialog
        {
            Title = App.Strings.Get("common.export"),
            Filter = "ReticleX crosshair (*.json)|*.json",
            DefaultExt = ".json",
            AddExtension = true,
            FileName = SafeFileName(suggested, "crosshair.json"),
        };

        if (dialog.ShowDialog(_window) != true)
        {
            return new JsonObject { ["ok"] = false, ["cancelled"] = true };
        }

        _store.WriteText(dialog.FileName, text);
        return new JsonObject { ["ok"] = true, ["fileName"] = Path.GetFileName(dialog.FileName) };
    }

    private JsonNode? SavePng(JsonObject parameters)
    {
        var suggested = parameters["suggestedName"]?.GetValue<string>() ?? "crosshair.png";
        var dataUrl = parameters["dataUrl"]?.GetValue<string>() ?? string.Empty;

        const string prefix = "data:image/png;base64,";
        if (!dataUrl.StartsWith(prefix, StringComparison.Ordinal))
        {
            throw new ArgumentException("savePng expects a PNG data URL.");
        }

        var bytes = Convert.FromBase64String(dataUrl[prefix.Length..]);

        var dialog = new Microsoft.Win32.SaveFileDialog
        {
            Title = App.Strings.Get("common.export"),
            Filter = "PNG image (*.png)|*.png",
            DefaultExt = ".png",
            AddExtension = true,
            FileName = SafeFileName(suggested, "crosshair.png"),
        };

        if (dialog.ShowDialog(_window) != true)
        {
            return new JsonObject { ["ok"] = false, ["cancelled"] = true };
        }

        File.WriteAllBytes(dialog.FileName, bytes);
        return new JsonObject { ["ok"] = true, ["fileName"] = Path.GetFileName(dialog.FileName) };
    }

    private JsonNode? PickImage(JsonObject _)
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Title = App.Strings.Get("preview.chooseImage"),
            Filter = "Images (*.png;*.jpg;*.jpeg;*.webp;*.bmp)|*.png;*.jpg;*.jpeg;*.webp;*.bmp",
            CheckFileExists = true,
        };

        if (dialog.ShowDialog(_window) != true)
        {
            return new JsonObject { ["ok"] = false, ["cancelled"] = true };
        }

        var info = new FileInfo(dialog.FileName);
        if (info.Length > MaxBackgroundBytes)
        {
            return new JsonObject { ["ok"] = false, ["error"] = "tooLarge" };
        }

        var mediaType = Path.GetExtension(dialog.FileName).ToLowerInvariant() switch
        {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".webp" => "image/webp",
            ".bmp" => "image/bmp",
            _ => "image/png",
        };
        var base64 = Convert.ToBase64String(File.ReadAllBytes(dialog.FileName));

        return new JsonObject
        {
            ["ok"] = true,
            ["fileName"] = info.Name,
            ["dataUrl"] = $"data:{mediaType};base64,{base64}",
        };
    }

    private JsonNode? SetStartWithWindows(JsonObject parameters)
    {
        var enabled = parameters["enabled"] is JsonValue value
                      && value.TryGetValue<bool>(out var flag) && flag;
        var applied = StartupRegistry.Set(enabled, Environment.ProcessPath ?? string.Empty);
        return new JsonObject { ["ok"] = applied == enabled, ["enabled"] = applied };
    }

    private JsonNode? OpenExternal(JsonObject parameters)
    {
        var url = parameters["url"]?.GetValue<string>();
        // Only ever hand the shell an http(s) address: anything else could be a
        // local path or a protocol handler the page has no business invoking.
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            throw new ArgumentException("Only http and https links can be opened.");
        }

        Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        return new JsonObject { ["ok"] = true };
    }

    private JsonNode? OpenDataFolder(JsonObject _)
    {
        _paths.EnsureCreated();
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{_paths.Root}\"")
        {
            UseShellExecute = true,
        });
        return new JsonObject { ["ok"] = true };
    }

    private JsonNode? WindowCommand(JsonObject parameters)
    {
        var action = parameters["action"]?.GetValue<string>() ?? string.Empty;
        _window.Dispatcher.Invoke(() => _window.RunWindowCommand(action));
        return new JsonObject { ["ok"] = true };
    }

    // --- Helpers ------------------------------------------------------------

    private static JsonNode ToNode(CrosshairDocument document) =>
        JsonSerializer.SerializeToNode(document, JsonStore.Options)!;

    /// <summary>Strips anything the file system would refuse.</summary>
    private static string SafeFileName(string suggested, string fallback)
    {
        var name = Path.GetFileName(suggested);
        if (string.IsNullOrWhiteSpace(name)) return fallback;

        var invalid = Path.GetInvalidFileNameChars();
        var cleaned = new string(name.Where(c => !invalid.Contains(c)).ToArray()).Trim();
        return cleaned.Length > 0 ? cleaned : fallback;
    }
}
