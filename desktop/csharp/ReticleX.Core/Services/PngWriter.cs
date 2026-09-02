using System.Buffers.Binary;
using System.IO.Compression;

namespace ReticleX.Core.Services;

/// <summary>
/// Writes 8-bit RGBA PNGs.
/// </summary>
/// <remarks>
/// Small enough to be worth having instead of a dependency, and it keeps
/// ReticleX.Core free of System.Drawing so the storage layer stays testable on
/// any platform. The native rasteriser already hands back exactly the pixel
/// format PNG wants, so all that is left is framing and compression.
/// </remarks>
public static class PngWriter
{
    private static readonly byte[] Signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    private static readonly uint[] CrcTable = BuildCrcTable();

    /// <param name="rgba">Non-premultiplied RGBA, width * height * 4 bytes.</param>
    public static byte[] Encode(byte[] rgba, int width, int height)
    {
        ArgumentNullException.ThrowIfNull(rgba);
        if (width <= 0 || height <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(width), "PNG dimensions must be positive.");
        }
        var expected = (long)width * height * 4;
        if (rgba.Length < expected)
        {
            throw new ArgumentException(
                $"Expected at least {expected} bytes for {width}x{height}, got {rgba.Length}.",
                nameof(rgba));
        }

        using var output = new MemoryStream();
        output.Write(Signature);

        Span<byte> header = stackalloc byte[13];
        BinaryPrimitives.WriteInt32BigEndian(header[..4], width);
        BinaryPrimitives.WriteInt32BigEndian(header.Slice(4, 4), height);
        header[8] = 8;    // bit depth
        header[9] = 6;    // colour type: truecolour with alpha
        header[10] = 0;   // compression: deflate
        header[11] = 0;   // filter: adaptive
        header[12] = 0;   // interlace: none
        WriteChunk(output, "IHDR", header);

        WriteChunk(output, "IDAT", Compress(rgba, width, height));
        WriteChunk(output, "IEND", ReadOnlySpan<byte>.Empty);

        return output.ToArray();
    }

    /// <summary>Encodes and writes the file atomically.</summary>
    public static void WriteFile(string path, byte[] rgba, int width, int height)
    {
        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);

        var bytes = Encode(rgba, width, height);
        var temporary = path + ".tmp";
        File.WriteAllBytes(temporary, bytes);
        File.Move(temporary, path, overwrite: true);
    }

    private static byte[] Compress(byte[] rgba, int width, int height)
    {
        var stride = width * 4;
        using var compressed = new MemoryStream();

        // ZLibStream emits the 2-byte header and Adler-32 trailer PNG requires.
        using (var deflate = new ZLibStream(compressed, CompressionLevel.Optimal, leaveOpen: true))
        {
            // Filter type 0 (none) per scanline: the images are tiny and mostly
            // transparent, so the extra filter passes would not pay for
            // themselves.
            var filterByte = new byte[1];
            for (var row = 0; row < height; row++)
            {
                deflate.Write(filterByte, 0, 1);
                deflate.Write(rgba, row * stride, stride);
            }
        }

        return compressed.ToArray();
    }

    private static void WriteChunk(Stream output, string type, ReadOnlySpan<byte> data)
    {
        Span<byte> length = stackalloc byte[4];
        BinaryPrimitives.WriteInt32BigEndian(length, data.Length);
        output.Write(length);

        Span<byte> typeBytes = stackalloc byte[4];
        for (var i = 0; i < 4; i++) typeBytes[i] = (byte)type[i];
        output.Write(typeBytes);
        output.Write(data);

        var crc = Crc(typeBytes, data);
        Span<byte> crcBytes = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(crcBytes, crc);
        output.Write(crcBytes);
    }

    private static uint Crc(ReadOnlySpan<byte> type, ReadOnlySpan<byte> data)
    {
        var crc = 0xFFFFFFFFu;
        foreach (var b in type) crc = CrcTable[(crc ^ b) & 0xFF] ^ (crc >> 8);
        foreach (var b in data) crc = CrcTable[(crc ^ b) & 0xFF] ^ (crc >> 8);
        return crc ^ 0xFFFFFFFFu;
    }

    private static uint[] BuildCrcTable()
    {
        var table = new uint[256];
        for (uint n = 0; n < 256; n++)
        {
            var c = n;
            for (var k = 0; k < 8; k++)
            {
                c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            }
            table[n] = c;
        }
        return table;
    }
}
