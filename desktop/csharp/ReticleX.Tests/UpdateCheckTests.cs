using ReticleX.Core.Services;
using Xunit;

namespace ReticleX.Tests;

public class ReleaseVersionTests
{
    [Theory]
    [InlineData("1.3.1", 1, 3, 1, "")]
    [InlineData("v1.3.1", 1, 3, 1, "")]
    [InlineData("  v2.0.0  ", 2, 0, 0, "")]
    [InlineData("1.4.0-rc1", 1, 4, 0, "rc1")]
    [InlineData("0.0.0", 0, 0, 0, "")]
    public void ReadsTheTagsWeCut(string text, int major, int minor, int patch, string prerelease)
    {
        Assert.True(ReleaseVersion.TryParse(text, out var version));
        Assert.Equal(new ReleaseVersion(major, minor, patch, prerelease), version);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("1.3")]
    [InlineData("1.3.1.2")]
    [InlineData("latest")]
    [InlineData("v1.x.0")]
    [InlineData("-1.0.0")]
    public void RefusesAnythingItCannotRead(string? text)
    {
        Assert.False(ReleaseVersion.TryParse(text, out _));
    }

    [Theory]
    [InlineData("1.3.2", "1.3.1")]
    [InlineData("1.4.0", "1.3.9")]
    [InlineData("2.0.0", "1.99.99")]
    [InlineData("1.3.10", "1.3.9")]      // not a string comparison
    [InlineData("1.4.0", "1.4.0-rc1")]   // the release beats its own prerelease
    [InlineData("1.4.0-rc2", "1.4.0-rc1")]
    public void OrdersNewerAboveOlder(string newer, string older)
    {
        Assert.True(ReleaseVersion.TryParse(newer, out var a));
        Assert.True(ReleaseVersion.TryParse(older, out var b));
        Assert.True(a.CompareTo(b) > 0, $"{newer} should sort above {older}");
        Assert.True(b.CompareTo(a) < 0, $"{older} should sort below {newer}");
    }

    [Fact]
    public void TheSameVersionIsNotNewerThanItself()
    {
        Assert.True(ReleaseVersion.TryParse("1.3.1", out var a));
        Assert.True(ReleaseVersion.TryParse("v1.3.1", out var b));
        Assert.Equal(0, a.CompareTo(b));
    }

    [Fact]
    public void RoundTripsThroughItsOwnText()
    {
        foreach (var text in new[] { "1.3.1", "2.0.0", "1.4.0-rc1" })
        {
            Assert.True(ReleaseVersion.TryParse(text, out var version));
            Assert.Equal(text, version.ToString());
        }
    }
}

public class UpdateCheckTests
{
    private static string Release(string tag, bool draft = false, bool prerelease = false,
        string url = "https://github.com/quantum3ap/reticlex/releases/tag/v9.9.9") =>
        $$"""
        {"tag_name":"{{tag}}","draft":{{(draft ? "true" : "false")}},
         "prerelease":{{(prerelease ? "true" : "false")}},"html_url":"{{url}}"}
        """;

    private static ReleaseVersion Current(string text)
    {
        Assert.True(ReleaseVersion.TryParse(text, out var version));
        return version;
    }

    [Fact]
    public void ReportsAReleaseNewerThanTheOneRunning()
    {
        var update = UpdateCheck.Evaluate(Release("v1.4.0"), Current("1.3.1"));

        Assert.NotNull(update);
        Assert.Equal("1.4.0", update.Version);
        Assert.StartsWith("https://github.com/", update.Url);
    }

    [Theory]
    [InlineData("v1.3.1")]   // the one we are running
    [InlineData("v1.3.0")]   // older
    [InlineData("v0.9.0")]
    public void SaysNothingWhenThereIsNothingNewer(string tag)
    {
        Assert.Null(UpdateCheck.Evaluate(Release(tag), Current("1.3.1")));
    }

    [Fact]
    public void IgnoresDraftsAndPrereleases()
    {
        Assert.Null(UpdateCheck.Evaluate(Release("v2.0.0", draft: true), Current("1.3.1")));
        Assert.Null(UpdateCheck.Evaluate(Release("v2.0.0", prerelease: true), Current("1.3.1")));
    }

    [Theory]
    [InlineData("not json at all")]
    [InlineData("[]")]
    [InlineData("{}")]
    [InlineData("""{"tag_name":"nightly","html_url":"https://github.com/x"}""")]
    public void TreatsAnUnreadableAnswerAsNoUpdate(string json)
    {
        Assert.Null(UpdateCheck.Evaluate(json, Current("1.3.1")));
    }

    [Theory]
    // The document arrives over the network, so the link in it is checked
    // before it is ever handed to a browser.
    [InlineData("http://github.com/quantum3ap/reticlex/releases")]
    [InlineData("https://githubb.com/quantum3ap/reticlex/releases")]
    [InlineData("javascript:alert(1)")]
    [InlineData("file:///C:/Windows/System32/calc.exe")]
    [InlineData("")]
    public void RefusesALinkThatIsNotAGitHubReleasePage(string url)
    {
        Assert.Null(UpdateCheck.Evaluate(Release("v2.0.0", url: url), Current("1.3.1")));
    }

    [Fact]
    public async Task AFailedRequestIsSilentRatherThanAnError()
    {
        var check = new UpdateCheck(_ => throw new HttpRequestException("offline"));
        Assert.Null(await check.LatestAsync("1.3.1"));
    }

    [Fact]
    public async Task AnEmptyAnswerIsSilentToo()
    {
        var check = new UpdateCheck(_ => Task.FromResult<string?>(null));
        Assert.Null(await check.LatestAsync("1.3.1"));
    }

    [Fact]
    public async Task AVersionWeCannotReadStopsTheCheckBeforeItAsks()
    {
        var asked = false;
        var check = new UpdateCheck(_ =>
        {
            asked = true;
            return Task.FromResult<string?>(Release("v9.9.9"));
        });

        Assert.Null(await check.LatestAsync("not-a-version"));
        Assert.False(asked, "there is no point asking when we cannot compare the answer");
    }

    [Fact]
    public async Task TheWholeRouteReportsAnUpdate()
    {
        var check = new UpdateCheck(_ => Task.FromResult<string?>(Release("v1.4.0")));
        var update = await check.LatestAsync("1.3.1");

        Assert.NotNull(update);
        Assert.Equal("1.4.0", update.Version);
    }
}
