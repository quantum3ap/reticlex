using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using ReticleX.Core.Models;

namespace ReticleX.Core.Services;

/// <summary>
/// Reads and writes the JSON files that make up the library.
/// </summary>
/// <remarks>
/// Writes go to a temporary file and are then moved into place, so a crash or a
/// power cut can lose the newest change but never leave a half-written document
/// behind. A file that cannot be parsed is renamed out of the way rather than
/// deleted: the user may still want it, and the next save must not fail because
/// of it.
/// </remarks>
public sealed class JsonStore
{
    public static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    /// <summary>Documents larger than this are treated as corrupt.</summary>
    public const long MaxDocumentBytes = 4L * 1024 * 1024;

    private readonly Action<string, Exception?>? _log;

    public JsonStore(Action<string, Exception?>? log = null) => _log = log;

    public string ReadText(string path)
    {
        var info = new FileInfo(path);
        if (!info.Exists) return string.Empty;
        if (info.Length > MaxDocumentBytes)
        {
            throw new InvalidDataException($"{path} is {info.Length} bytes, which is implausible.");
        }
        return File.ReadAllText(path, Encoding.UTF8);
    }

    /// <summary>Writes atomically: temporary file first, then a replace.</summary>
    public void WriteText(string path, string contents)
    {
        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);

        var temporary = path + ".tmp";
        File.WriteAllText(temporary, contents, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        File.Move(temporary, path, overwrite: true);
    }

    public void Write<T>(string path, T value) =>
        WriteText(path, JsonSerializer.Serialize(value, Options));

    /// <summary>
    /// Deserialises one file, quarantining it and returning null if it cannot
    /// be read.
    /// </summary>
    public T? TryRead<T>(string path) where T : class
    {
        try
        {
            var text = ReadText(path);
            if (string.IsNullOrWhiteSpace(text)) return null;
            return JsonSerializer.Deserialize<T>(text, Options);
        }
        catch (Exception error) when (error is JsonException or InvalidDataException or IOException
                                      or UnauthorizedAccessException or NotSupportedException)
        {
            _log?.Invoke($"Could not read {path}; moving it aside.", error);
            Quarantine(path);
            return null;
        }
    }

    /// <summary>
    /// Loads every document in a directory, skipping the ones that fail.
    /// One bad file must not hide the rest of the library.
    /// </summary>
    public List<CrosshairDocument> ReadDocuments(string directory)
    {
        var documents = new List<CrosshairDocument>();
        if (!Directory.Exists(directory)) return documents;

        foreach (var path in Directory.EnumerateFiles(directory, "*.json"))
        {
            var document = TryRead<CrosshairDocument>(path);
            if (document is null) continue;
            documents.Add(document.Sanitize());
        }

        return documents;
    }

    /// <summary>Renames an unreadable file so the next write can succeed.</summary>
    public void Quarantine(string path)
    {
        try
        {
            if (!File.Exists(path)) return;
            var stamp = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss");
            File.Move(path, $"{path}.{stamp}.corrupt", overwrite: true);
        }
        catch (IOException error)
        {
            _log?.Invoke($"Could not quarantine {path}.", error);
        }
        catch (UnauthorizedAccessException error)
        {
            _log?.Invoke($"Could not quarantine {path}.", error);
        }
    }

    public void Delete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            _log?.Invoke($"Could not delete {path}.", error);
        }
    }
}
