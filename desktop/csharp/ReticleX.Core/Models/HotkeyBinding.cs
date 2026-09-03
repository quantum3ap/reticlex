namespace ReticleX.Core.Models;

/// <summary>
/// Modifier keys, matching the MOD_* values RegisterHotKey expects.
/// </summary>
[Flags]
public enum HotkeyModifiers
{
    None = 0,
    Alt = 0x0001,
    Control = 0x0002,
    Shift = 0x0004,
    Windows = 0x0008,
}

/// <summary>
/// One parsed keyboard shortcut, as text on the way in and virtual-key codes
/// on the way out.
/// </summary>
/// <remarks>
/// The binding is stored as text ("Ctrl+Shift+X") because that is what the
/// settings file and the interface both work in; the host needs the numeric
/// form only at the moment it registers the hotkey with Windows. Parsing lives
/// here rather than in the shell so it can be tested without a window, and so
/// an unusable binding is rejected before anything tries to register it.
/// </remarks>
public sealed record HotkeyBinding(HotkeyModifiers Modifiers, uint VirtualKey, string Text)
{
    /// <summary>What a fresh install listens for.</summary>
    public const string Default = "Ctrl+Shift+X";

    /// <summary>
    /// Windows refuses a hotkey with no modifier for good reason: it would
    /// swallow that key everywhere, including inside other applications.
    /// </summary>
    public static bool IsUsable(HotkeyModifiers modifiers, uint virtualKey) =>
        modifiers != HotkeyModifiers.None && virtualKey != 0;

    /// <summary>
    /// Reads a binding written as modifiers and one key joined by "+".
    /// Returns null for anything Windows would not accept.
    /// </summary>
    public static HotkeyBinding? TryParse(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;

        var modifiers = HotkeyModifiers.None;
        uint virtualKey = 0;
        var canonical = new List<string>();

        foreach (var raw in text.Split('+', StringSplitOptions.RemoveEmptyEntries))
        {
            var part = raw.Trim();
            if (part.Length == 0) continue;

            switch (part.ToLowerInvariant())
            {
                case "ctrl" or "control":
                    modifiers |= HotkeyModifiers.Control;
                    continue;
                case "alt":
                    modifiers |= HotkeyModifiers.Alt;
                    continue;
                case "shift":
                    modifiers |= HotkeyModifiers.Shift;
                    continue;
                case "win" or "windows" or "meta":
                    modifiers |= HotkeyModifiers.Windows;
                    continue;
            }

            // Two keys named in one binding is a typo, not a chord.
            if (virtualKey != 0) return null;
            virtualKey = KeyCode(part);
            if (virtualKey == 0) return null;
            canonical.Add(KeyName(virtualKey));
        }

        if (!IsUsable(modifiers, virtualKey)) return null;

        var ordered = new List<string>(4);
        if (modifiers.HasFlag(HotkeyModifiers.Control)) ordered.Add("Ctrl");
        if (modifiers.HasFlag(HotkeyModifiers.Alt)) ordered.Add("Alt");
        if (modifiers.HasFlag(HotkeyModifiers.Shift)) ordered.Add("Shift");
        if (modifiers.HasFlag(HotkeyModifiers.Windows)) ordered.Add("Win");
        ordered.AddRange(canonical);

        return new HotkeyBinding(modifiers, virtualKey, string.Join("+", ordered));
    }

    /// <summary>The stored binding, or the default when it cannot be used.</summary>
    public static HotkeyBinding Resolve(string? text) =>
        TryParse(text) ?? TryParse(Default)!;

    private static uint KeyCode(string name)
    {
        if (name.Length == 1)
        {
            var c = char.ToUpperInvariant(name[0]);
            if (c is >= 'A' and <= 'Z') return c;
            if (c is >= '0' and <= '9') return c;
        }

        if (name.Length is 2 or 3
            && (name[0] is 'F' or 'f')
            && int.TryParse(name.AsSpan(1), out var index)
            && index is >= 1 and <= 24)
        {
            return (uint)(0x70 + index - 1); // VK_F1 .. VK_F24
        }

        return name.ToLowerInvariant() switch
        {
            "space" => 0x20,
            "insert" => 0x2D,
            "delete" or "del" => 0x2E,
            "home" => 0x24,
            "end" => 0x23,
            "pageup" => 0x21,
            "pagedown" => 0x22,
            "tab" => 0x09,
            "backspace" => 0x08,
            "up" => 0x26,
            "down" => 0x28,
            "left" => 0x25,
            "right" => 0x27,
            _ => 0,
        };
    }

    private static string KeyName(uint code) => code switch
    {
        >= 'A' and <= 'Z' => ((char)code).ToString(),
        >= '0' and <= '9' => ((char)code).ToString(),
        >= 0x70 and <= 0x87 => $"F{code - 0x70 + 1}",
        0x20 => "Space",
        0x2D => "Insert",
        0x2E => "Delete",
        0x24 => "Home",
        0x23 => "End",
        0x21 => "PageUp",
        0x22 => "PageDown",
        0x09 => "Tab",
        0x08 => "Backspace",
        0x26 => "Up",
        0x28 => "Down",
        0x25 => "Left",
        0x27 => "Right",
        _ => "?",
    };
}
