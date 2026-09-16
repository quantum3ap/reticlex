using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json.Nodes;

namespace ReticleX.Core.Services;

/// <summary>A published release newer than the one running.</summary>
public sealed record UpdateInfo(string Version, string Url);

/// <summary>
/// A version as ReticleX tags them: three numbers and an optional prerelease
/// suffix. It answers one question — is that release newer than this one — and
/// nothing else, so it deliberately stops well short of full semver.
/// </summary>
public readonly record struct ReleaseVersion(int Major, int Minor, int Patch, string Prerelease)
    : IComparable<ReleaseVersion>
{
    /// <summary>
    /// Parses "1.3.1", "v1.3.1" or "1.4.0-rc1". Anything else is refused
    /// rather than guessed at: a version we cannot read is not a version we
    /// should be comparing against.
    /// </summary>
    public static bool TryParse(string? text, out ReleaseVersion version)
    {
        version = default;
        if (string.IsNullOrWhiteSpace(text)) return false;

        var span = text.Trim();
        if (span.StartsWith('v') || span.StartsWith('V')) span = span[1..];

        var prerelease = string.Empty;
        var dash = span.IndexOf('-');
        if (dash >= 0)
        {
            prerelease = span[(dash + 1)..];
            span = span[..dash];
        }

        var parts = span.Split('.');
        if (parts.Length != 3) return false;

        if (!int.TryParse(parts[0], out var major) || major < 0) return false;
        if (!int.TryParse(parts[1], out var minor) || minor < 0) return false;
        if (!int.TryParse(parts[2], out var patch) || patch < 0) return false;

        version = new ReleaseVersion(major, minor, patch, prerelease);
        return true;
    }

    public int CompareTo(ReleaseVersion other)
    {
        if (Major != other.Major) return Major.CompareTo(other.Major);
        if (Minor != other.Minor) return Minor.CompareTo(other.Minor);
        if (Patch != other.Patch) return Patch.CompareTo(other.Patch);

        // 1.4.0-rc1 comes before 1.4.0, as it does everywhere else. Between two
        // prereleases an ordinal comparison is close enough for tags we cut
        // ourselves, and the alternative is a great deal of machinery for a
        // case that has not happened yet.
        var mine = string.IsNullOrEmpty(Prerelease);
        var theirs = string.IsNullOrEmpty(other.Prerelease);
        if (mine != theirs) return mine ? 1 : -1;
        return string.CompareOrdinal(Prerelease, other.Prerelease);
    }

    public override string ToString() =>
        string.IsNullOrEmpty(Prerelease)
            ? $"{Major}.{Minor}.{Patch}"
            : $"{Major}.{Minor}.{Patch}-{Prerelease}";
}

/// <summary>
/// Asks GitHub whether there is a newer release than the one running.
/// </summary>
/// <remarks>
/// This is the only thing in ReticleX that touches the network, and it is one
/// unauthenticated GET that sends nothing but a user agent. It exists because
/// the alternative is what happened with 1.3.0: a release that would not open,
/// a fix published the same week, and no way for anyone to find out. The
/// interface has a switch to turn it off, and every failure here is silent —
/// being offline is not a problem worth interrupting someone about.
/// </remarks>
public sealed class UpdateCheck
{
    public const string LatestReleaseUrl =
        "https://api.github.com/repos/quantum3ap/reticlex/releases/latest";

    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(10);

    private static readonly Lazy<HttpClient> SharedClient = new(() =>
    {
        var client = new HttpClient { Timeout = RequestTimeout };
        // GitHub refuses requests without one.
        client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("ReticleX", "1.0"));
        client.DefaultRequestHeaders.Accept.Add(
            new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        return client;
    });

    private readonly Func<CancellationToken, Task<string?>> _fetch;

    /// <param name="fetch">
    /// Where the release document comes from. Defaults to the real request;
    /// the tests pass their own so the decision can be exercised without a
    /// network.
    /// </param>
    public UpdateCheck(Func<CancellationToken, Task<string?>>? fetch = null) =>
        _fetch = fetch ?? FetchAsync;

    /// <summary>
    /// The newest published release, when it is newer than
    /// <paramref name="currentVersion"/>. Null means no update, or that we
    /// could not tell — the caller treats those the same way.
    /// </summary>
    public async Task<UpdateInfo?> LatestAsync(string currentVersion, CancellationToken token = default)
    {
        if (!ReleaseVersion.TryParse(currentVersion, out var current)) return null;

        string? json;
        try
        {
            json = await _fetch(token).ConfigureAwait(false);
        }
        catch
        {
            return null;
        }

        return string.IsNullOrEmpty(json) ? null : Evaluate(json, current);
    }

    /// <summary>
    /// Reads a GitHub release document and decides. Separated from the request
    /// so the interesting half can be tested on its own.
    /// </summary>
    public static UpdateInfo? Evaluate(string json, ReleaseVersion current)
    {
        JsonNode? node;
        try
        {
            node = JsonNode.Parse(json);
        }
        catch
        {
            return null;
        }

        if (node is not JsonObject release) return null;
        if (release["draft"]?.GetValue<bool>() == true) return null;
        if (release["prerelease"]?.GetValue<bool>() == true) return null;

        var tag = release["tag_name"]?.GetValue<string>();
        if (!ReleaseVersion.TryParse(tag, out var latest)) return null;
        if (latest.CompareTo(current) <= 0) return null;

        var url = release["html_url"]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(url) || !IsReleasePage(url)) return null;

        return new UpdateInfo(latest.ToString(), url);
    }

    /// <summary>
    /// The page we are willing to hand to a browser. The document comes off
    /// the network, so the link inside it is checked rather than trusted.
    /// </summary>
    private static bool IsReleasePage(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri)
        && uri.Scheme == Uri.UriSchemeHttps
        && uri.Host.Equals("github.com", StringComparison.OrdinalIgnoreCase);

    private static async Task<string?> FetchAsync(CancellationToken token)
    {
        using var response = await SharedClient.Value
            .GetAsync(LatestReleaseUrl, HttpCompletionOption.ResponseContentRead, token)
            .ConfigureAwait(false);

        if (!response.IsSuccessStatusCode) return null;
        return await response.Content.ReadAsStringAsync(token).ConfigureAwait(false);
    }
}
