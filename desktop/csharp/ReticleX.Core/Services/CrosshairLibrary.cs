using ReticleX.Core.Interop;
using ReticleX.Core.Models;

namespace ReticleX.Core.Services;

/// <summary>
/// The on-disk library: one file per crosshair and per user preset.
/// </summary>
/// <remarks>
/// A file per document rather than one big index. Saving touches exactly the
/// record that changed, a corrupt file costs one crosshair instead of all of
/// them, and the folder stays something a person can browse, back up or copy
/// between machines by hand.
///
/// Everything read from disk is passed through the native normaliser before it
/// is handed on, so nothing downstream ever sees an out-of-range value —
/// including anything a user typed into the JSON themselves.
/// </remarks>
public sealed class CrosshairLibrary
{
    private readonly AppPaths _paths;
    private readonly JsonStore _store;

    public CrosshairLibrary(AppPaths paths, JsonStore store)
    {
        _paths = paths;
        _store = store;
    }

    public List<CrosshairDocument> LoadCrosshairs() => Load(_paths.Crosshairs, "crosshair");

    public List<CrosshairDocument> LoadPresets() => Load(_paths.Presets, "preset");

    private List<CrosshairDocument> Load(string directory, string kind)
    {
        var documents = _store.ReadDocuments(directory);
        foreach (var document in documents)
        {
            document.Kind = kind;
            var config = document.Config;
            if (NativeCore.IsAvailable) NativeCore.Normalize(ref config);
            document.Config = config;
        }
        return documents
            .OrderByDescending(document => document.UpdatedAt, StringComparer.Ordinal)
            .ToList();
    }

    public CrosshairDocument SaveCrosshair(CrosshairDocument document) =>
        Save(document, _paths.Crosshairs, "crosshair");

    public CrosshairDocument SavePreset(CrosshairDocument document) =>
        Save(document, _paths.Presets, "preset");

    private CrosshairDocument Save(CrosshairDocument document, string directory, string kind)
    {
        ArgumentNullException.ThrowIfNull(document);

        document.Kind = kind;
        document.Sanitize();
        if (string.IsNullOrWhiteSpace(document.UpdatedAt))
        {
            document.UpdatedAt = DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
        }

        // The renderer is not the authority on what is storable: repair the
        // configuration here too, so a bug on the other side of the bridge
        // cannot write an unusable file.
        var config = document.Config;
        if (NativeCore.IsAvailable) NativeCore.Normalize(ref config);
        document.Config = config;

        Directory.CreateDirectory(directory);
        _store.Write(Path.Combine(directory, document.Id + ".json"), document);
        return document;
    }

    public void DeleteCrosshair(string id) => Delete(_paths.Crosshairs, id, _paths.ThumbnailFile);

    public void DeletePreset(string id) => Delete(_paths.Presets, id, _paths.ThumbnailFile);

    private void Delete(string directory, string id, Func<string, string> thumbnailFor)
    {
        var safe = CrosshairDocument.SafeId(id);
        _store.Delete(Path.Combine(directory, safe + ".json"));
        _store.Delete(thumbnailFor(safe));
    }

    /// <summary>
    /// Removes every user document. Built-in presets ship with the application
    /// and are not stored here, so they come back untouched.
    /// </summary>
    public void Clear()
    {
        foreach (var directory in new[] { _paths.Crosshairs, _paths.Presets, _paths.Thumbnails })
        {
            if (!Directory.Exists(directory)) continue;
            foreach (var file in Directory.EnumerateFiles(directory))
            {
                _store.Delete(file);
            }
        }
    }
}
