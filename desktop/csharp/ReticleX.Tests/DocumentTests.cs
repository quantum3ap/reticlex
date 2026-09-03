using ReticleX.Core.Models;
using Xunit;

namespace ReticleX.Tests;

public class DocumentTests
{
    [Fact]
    public void SanitizeTrimsAndBoundsUserText()
    {
        var document = new CrosshairDocument
        {
            Id = "cx_valid-1",
            Name = new string('x', 500),
            Description = new string('y', 500),
        }.Sanitize();

        Assert.Equal(80, document.Name.Length);
        Assert.Equal(240, document.Description.Length);
    }

    [Fact]
    public void SanitizeReplacesAnEmptyName()
    {
        var document = new CrosshairDocument { Id = "cx_1", Name = "   " }.Sanitize();
        Assert.Equal("Untitled", document.Name);
    }

    [Theory]
    [InlineData("../../etc/passwd")]
    [InlineData("C:\\Windows\\System32")]
    [InlineData("with spaces")]
    [InlineData("semi;colon")]
    public void IdentifiersCannotEscapeTheirDirectory(string hostile)
    {
        // Identifiers become filenames, so traversal characters must not survive.
        var safe = CrosshairDocument.SafeId(hostile);
        Assert.DoesNotContain("..", safe);
        Assert.DoesNotContain("/", safe);
        Assert.DoesNotContain("\\", safe);
        Assert.DoesNotContain(":", safe);
        Assert.Equal(safe, Path.GetFileName(safe));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("///")]
    [InlineData("___")]
    public void AnUnusableIdentifierIsReplacedWithAFreshOne(string? input)
    {
        var safe = CrosshairDocument.SafeId(input);
        Assert.StartsWith("cx_", safe);
        Assert.True(safe.Length > 4);
    }

    [Fact]
    public void AGoodIdentifierIsLeftAlone()
    {
        Assert.Equal("cx_abc123-x", CrosshairDocument.SafeId("cx_abc123-x"));
    }

    [Fact]
    public void GeneratedIdentifiersAreUnique()
    {
        var ids = Enumerable.Range(0, 500).Select(_ => CrosshairDocument.NewId("ps")).ToHashSet();
        Assert.Equal(500, ids.Count);
        Assert.All(ids, id => Assert.StartsWith("ps_", id));
    }

    [Theory]
    [InlineData("not a date")]
    [InlineData("")]
    [InlineData(null)]
    public void AnUnreadableTimestampBecomesNow(string? input)
    {
        var document = new CrosshairDocument { Id = "cx_1", CreatedAt = input! }.Sanitize();
        var parsed = DateTimeOffset.Parse(document.CreatedAt);
        Assert.True((DateTimeOffset.UtcNow - parsed).Duration() < TimeSpan.FromMinutes(1));
    }

    [Fact]
    public void TimestampsAreNormalisedToUtc()
    {
        var document = new CrosshairDocument
        {
            Id = "cx_1",
            CreatedAt = "2024-03-01T12:00:00+05:00",
        }.Sanitize();
        Assert.Equal("2024-03-01T07:00:00.000Z", document.CreatedAt);
    }

    [Fact]
    public void KindIsCanonicalised()
    {
        Assert.Equal("preset", new CrosshairDocument { Id = "p", Kind = "PRESET" }.Sanitize().Kind);
        Assert.Equal("crosshair", new CrosshairDocument { Id = "c", Kind = "nonsense" }.Sanitize().Kind);
        Assert.True(new CrosshairDocument { Kind = "preset" }.IsPreset);
    }
}
