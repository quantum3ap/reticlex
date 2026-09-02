using System.Buffers.Binary;
using System.IO.Compression;
using ReticleX.Core.Services;
using Xunit;

namespace ReticleX.Tests;

public class PngWriterTests
{
    private static readonly byte[] Signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    private static byte[] SolidImage(int width, int height, byte r, byte g, byte b, byte a)
    {
        var pixels = new byte[width * height * 4];
        for (var i = 0; i < width * height; i++)
        {
            pixels[i * 4] = r;
            pixels[i * 4 + 1] = g;
            pixels[i * 4 + 2] = b;
            pixels[i * 4 + 3] = a;
        }
        return pixels;
    }

    [Fact]
    public void ProducesAWellFormedPng()
    {
        var png = PngWriter.Encode(SolidImage(4, 3, 0, 255, 136, 255), 4, 3);

        Assert.True(png.AsSpan(0, 8).SequenceEqual(Signature), "the PNG signature is wrong");

        // IHDR follows immediately: length, type, then the header fields.
        Assert.Equal(13, BinaryPrimitives.ReadInt32BigEndian(png.AsSpan(8, 4)));
        Assert.Equal("IHDR", System.Text.Encoding.ASCII.GetString(png, 12, 4));
        Assert.Equal(4, BinaryPrimitives.ReadInt32BigEndian(png.AsSpan(16, 4)));
        Assert.Equal(3, BinaryPrimitives.ReadInt32BigEndian(png.AsSpan(20, 4)));
        Assert.Equal(8, png[24]);   // bit depth
        Assert.Equal(6, png[25]);   // RGBA
    }

    [Fact]
    public void EndsWithIend()
    {
        var png = PngWriter.Encode(SolidImage(2, 2, 1, 2, 3, 4), 2, 2);
        var tail = System.Text.Encoding.ASCII.GetString(png, png.Length - 8, 4);
        Assert.Equal("IEND", tail);
        Assert.Equal(0, BinaryPrimitives.ReadInt32BigEndian(png.AsSpan(png.Length - 12, 4)));
    }

    [Fact]
    public void ChunkChecksumsAreCorrect()
    {
        var png = PngWriter.Encode(SolidImage(8, 8, 10, 20, 30, 255), 8, 8);

        var offset = 8;
        var chunks = 0;
        while (offset < png.Length)
        {
            var length = BinaryPrimitives.ReadInt32BigEndian(png.AsSpan(offset, 4));
            var stored = BinaryPrimitives.ReadUInt32BigEndian(png.AsSpan(offset + 8 + length, 4));
            var computed = Crc32(png.AsSpan(offset + 4, 4 + length));
            Assert.Equal(stored, computed);
            offset += 12 + length;
            chunks++;
        }

        Assert.Equal(png.Length, offset);
        Assert.Equal(3, chunks);   // IHDR, IDAT, IEND
    }

    [Fact]
    public void PixelDataRoundTripsThroughTheCompressedStream()
    {
        const int width = 5;
        const int height = 4;
        var original = SolidImage(width, height, 12, 34, 56, 200);
        var png = PngWriter.Encode(original, width, height);

        // Find IDAT and inflate it: every scanline should be a zero filter byte
        // followed by the original row.
        var offset = 8;
        byte[]? idat = null;
        while (offset < png.Length)
        {
            var length = BinaryPrimitives.ReadInt32BigEndian(png.AsSpan(offset, 4));
            var type = System.Text.Encoding.ASCII.GetString(png, offset + 4, 4);
            if (type == "IDAT") idat = png.AsSpan(offset + 8, length).ToArray();
            offset += 12 + length;
        }

        Assert.NotNull(idat);
        using var input = new MemoryStream(idat!);
        using var inflate = new ZLibStream(input, CompressionMode.Decompress);
        using var output = new MemoryStream();
        inflate.CopyTo(output);
        var raw = output.ToArray();

        Assert.Equal(height * (1 + width * 4), raw.Length);
        for (var row = 0; row < height; row++)
        {
            var start = row * (1 + width * 4);
            Assert.Equal(0, raw[start]);
            Assert.True(
                raw.AsSpan(start + 1, width * 4).SequenceEqual(original.AsSpan(row * width * 4, width * 4)),
                $"row {row} does not match");
        }
    }

    [Fact]
    public void TransparencyIsPreserved()
    {
        var png = PngWriter.Encode(SolidImage(2, 2, 0, 0, 0, 0), 2, 2);
        Assert.True(png.Length > 40);
        Assert.Equal(6, png[25]);   // colour type must keep the alpha channel
    }

    [Theory]
    [InlineData(0, 10)]
    [InlineData(10, 0)]
    [InlineData(-1, 10)]
    public void RejectsImpossibleDimensions(int width, int height)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            PngWriter.Encode(new byte[400], width, height));
    }

    [Fact]
    public void RejectsABufferThatIsTooSmall()
    {
        Assert.Throws<ArgumentException>(() => PngWriter.Encode(new byte[10], 8, 8));
    }

    [Fact]
    public void WritesAtomicallyToDisk()
    {
        using var workspace = new TempWorkspace();
        var path = Path.Combine(workspace.Root, "thumb", "test.png");

        PngWriter.WriteFile(path, SolidImage(16, 16, 255, 0, 0, 255), 16, 16);

        Assert.True(File.Exists(path));
        Assert.Empty(Directory.GetFiles(Path.GetDirectoryName(path)!, "*.tmp"));
        Assert.True(File.ReadAllBytes(path).AsSpan(0, 8).SequenceEqual(Signature));
    }

    private static uint Crc32(ReadOnlySpan<byte> data)
    {
        var crc = 0xFFFFFFFFu;
        foreach (var b in data)
        {
            crc ^= b;
            for (var k = 0; k < 8; k++)
            {
                crc = (crc & 1) != 0 ? 0xEDB88320u ^ (crc >> 1) : crc >> 1;
            }
        }
        return crc ^ 0xFFFFFFFFu;
    }
}
