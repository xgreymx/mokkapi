using System.Text.Json;
using System.Text.Json.Serialization;

namespace MokkapiMock;

// - Data model (mirrors mokkapi's src/shared/models.ts) -

public sealed class EndpointDef
{
    public string Method = "";
    /// <summary>Original mokkapi pattern, e.g. /v1/charges/:id</summary>
    public string Path = "";
    public string Description = "";
    public string? ForcedVariantId;
    public List<VariantDef> Variants = new();
}

public sealed class VariantDef
{
    public string Id = "";
    public string Name = "";
    /// <summary>Scenario names this variant is active in. Empty = active in ALL scenarios.</summary>
    public List<string> Scenarios = new();
    public MatchDef Match = new();
    public int DelayMs;
    public int Status = 200;
    public Dictionary<string, string> Headers = new();
    public string Body = "";
    public string BodyKind = "json";
}

public sealed class MatchDef
{
    public Dictionary<string, RuleVal> Headers = new();
    public Dictionary<string, RuleVal> Query = new();
    public List<JsonPathRule> BodyJsonPath = new();
}

/// <summary>A header/query rule: exact string ("present"/"!present" are sentinels) or a regex.</summary>
public sealed class RuleVal
{
    public bool IsRegex;
    public string Value = "";
}

public sealed class JsonPathRule
{
    public string Path = "";
    public string Op = "";
    /// <summary>string, double, bool or null</summary>
    public object? Value;
}

/// <summary>
/// A JSON boolean that renders as JS-style "true"/"false" when echoed in a Handlebars
/// template (C# bool.ToString() is "True"/"False" -> invalid JSON), but serialises back
/// to a real boolean for {{json}} and compares correctly in match rules.
/// </summary>
[JsonConverter(typeof(JsBoolConverter))]
public readonly struct JsBool
{
    public readonly bool Value;
    public JsBool(bool value) => Value = value;
    public override string ToString() => Value ? "true" : "false";
}

public sealed class JsBoolConverter : JsonConverter<JsBool>
{
    public override JsBool Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        => new(reader.GetBoolean());

    public override void Write(Utf8JsonWriter writer, JsBool value, JsonSerializerOptions options)
        => writer.WriteBooleanValue(value.Value);
}

// - JSON normalisation: JsonElement -> string/double/JsBool/null/Dictionary/List -
// Keeps EvalJsonPath and the Handlebars context working on plain CLR objects, the
// same shape mokkapi's renderer/matcher operate on (JS values from JSON.parse).

public static class Json
{
    public static object? Normalize(JsonElement el) => el.ValueKind switch
    {
        JsonValueKind.Object => el.EnumerateObject().ToDictionary(p => p.Name, p => Normalize(p.Value)),
        JsonValueKind.Array => el.EnumerateArray().Select(Normalize).ToList(),
        JsonValueKind.String => el.GetString(),
        JsonValueKind.Number => el.GetDouble(),
        JsonValueKind.True => new JsBool(true),
        JsonValueKind.False => new JsBool(false),
        _ => null,
    };
}
