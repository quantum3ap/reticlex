// A WPF project's implicit usings deliberately leave out System.IO, because
// System.IO.Path would collide with System.Windows.Shapes.Path.
using System.IO;

using Microsoft.Win32;

namespace ReticleX.App.Host;

/// <summary>
/// The "start with Windows" setting.
/// </summary>
/// <remarks>
/// Written to the per-user Run key, so enabling it needs no administrator
/// rights and only affects the account that asked for it. Every operation is
/// wrapped: a locked-down or policy-managed registry must leave the toggle
/// reporting the truth rather than throwing.
/// </remarks>
public static class StartupRegistry
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "ReticleX";

    public static bool IsEnabled()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: false);
            var value = key?.GetValue(ValueName) as string;
            return !string.IsNullOrWhiteSpace(value);
        }
        catch (Exception error) when (error is System.Security.SecurityException
                                      or UnauthorizedAccessException or IOException)
        {
            return false;
        }
    }

    /// <summary>
    /// Applies the setting and returns the state that actually took effect,
    /// which may differ from the request on a managed machine.
    /// </summary>
    public static bool Set(bool enabled, string executablePath)
    {
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(RunKey, writable: true);
            if (key is null) return IsEnabled();

            if (enabled)
            {
                // Quoted: the install path routinely contains spaces.
                key.SetValue(ValueName, $"\"{executablePath}\"", RegistryValueKind.String);
            }
            else if (key.GetValue(ValueName) is not null)
            {
                key.DeleteValue(ValueName, throwOnMissingValue: false);
            }

            return IsEnabled();
        }
        catch (Exception error) when (error is System.Security.SecurityException
                                      or UnauthorizedAccessException or IOException)
        {
            App.Log.Warn("The start-with-Windows setting could not be written.", error);
            return IsEnabled();
        }
    }
}
