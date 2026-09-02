using System.Text;

namespace ReticleX.Core.Services;

/// <summary>
/// A small append-only log.
/// </summary>
/// <remarks>
/// A packaged desktop application has no console to write to, so when something
/// goes wrong on a user's machine this file is the only evidence. It is capped
/// and rotated once so it can never grow without bound, and every write is
/// wrapped: logging must never be the thing that crashes the app.
/// </remarks>
public sealed class AppLog
{
    private const long MaxBytes = 512 * 1024;

    private readonly string _path;
    private readonly object _gate = new();

    public AppLog(string path) => _path = path;

    public void Info(string message) => Write("INFO ", message, null);

    public void Warn(string message, Exception? error = null) => Write("WARN ", message, error);

    public void Error(string message, Exception? error = null) => Write("ERROR", message, error);

    private void Write(string level, string message, Exception? error)
    {
        try
        {
            lock (_gate)
            {
                var directory = Path.GetDirectoryName(_path);
                if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);

                RotateIfNeeded();

                var line = new StringBuilder()
                    .Append(DateTimeOffset.UtcNow.ToString("yyyy-MM-dd HH:mm:ss.fff"))
                    .Append(' ').Append(level).Append(' ').Append(message);
                if (error is not null)
                {
                    line.AppendLine().Append("    ").Append(error.GetType().Name)
                        .Append(": ").Append(error.Message);
                }
                line.AppendLine();

                File.AppendAllText(_path, line.ToString(), Encoding.UTF8);
            }
        }
        catch (Exception)
        {
            // Losing a log line is always preferable to losing the session.
        }
    }

    private void RotateIfNeeded()
    {
        var info = new FileInfo(_path);
        if (!info.Exists || info.Length < MaxBytes) return;
        var previous = _path + ".1";
        if (File.Exists(previous)) File.Delete(previous);
        File.Move(_path, previous);
    }
}
