using System.Text.Json;
using System.Text.Json.Serialization;
using ReticleX.Core.Models;

namespace ReticleX.Core.Serialization;

/// <summary>
/// Reads and writes <see cref="CrosshairConfig"/> as a flat object keyed by the
/// core's own field names.
/// </summary>
/// <remarks>
/// Reading is deliberately forgiving: unknown properties are skipped, missing
/// ones keep their default, and a value of the wrong type is ignored rather
/// than aborting the whole file. A single bad field must never cost the user
/// their entire library.
/// </remarks>
public sealed class CrosshairConfigConverter : JsonConverter<CrosshairConfig>
{
    public override CrosshairConfig Read(
        ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return CrosshairConfig.CreateDefault();
        }
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException("A crosshair configuration must be an object.");
        }

        var config = CrosshairConfig.CreateDefault();

        while (reader.Read())
        {
            if (reader.TokenType == JsonTokenType.EndObject) return config;
            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                throw new JsonException("Unexpected token in a crosshair configuration.");
            }

            var name = reader.GetString();
            reader.Read();

            var index = Array.IndexOf(CrosshairConfig.FieldNames, name);
            if (index < 0)
            {
                reader.Skip();
                continue;
            }

            switch (reader.TokenType)
            {
                case JsonTokenType.Number when reader.TryGetDouble(out var number):
                    config.SetField(index, number);
                    break;
                case JsonTokenType.True:
                    config.SetField(index, 1);
                    break;
                case JsonTokenType.False:
                    config.SetField(index, 0);
                    break;
                default:
                    // Anything else (string, object, array) is not a value this
                    // field can hold; leave the default in place.
                    reader.Skip();
                    break;
            }
        }

        throw new JsonException("A crosshair configuration was not closed.");
    }

    public override void Write(
        Utf8JsonWriter writer, CrosshairConfig value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        for (var i = 0; i < CrosshairConfig.FieldCount; i++)
        {
            var name = CrosshairConfig.FieldNames[i];
            if (CrosshairConfig.FieldIsInteger[i])
            {
                writer.WriteNumber(name, (int)value.GetField(i));
            }
            else
            {
                // Round-trip at float precision: the value came from a float32
                // and writing more digits than that would only add noise.
                writer.WriteNumber(name, (float)value.GetField(i));
            }
        }
        writer.WriteEndObject();
    }
}
