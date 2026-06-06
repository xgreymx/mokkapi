using System.Text.RegularExpressions;

namespace MokkapiMock;

/// <summary>
/// Variant selection + match rules. Faithful port of the relevant parts of
/// mokkapi's src/main/servers/matcher.ts. Path matching itself is handled by
/// ASP.NET routing (one explicit route per endpoint), so this only selects which
/// variant of an already-matched endpoint should answer.
/// </summary>
public static class Matcher
{
    public static VariantDef? SelectVariant(
        EndpointDef endpoint,
        string scenario,
        Dictionary<string, string> query,
        Dictionary<string, string> headers,
        object? body)
    {
        // forcedVariantId bypasses all matching rules
        if (endpoint.ForcedVariantId is not null)
        {
            var forced = endpoint.Variants.FirstOrDefault(v => v.Id == endpoint.ForcedVariantId);
            if (forced is not null) return forced;
        }

        // Walk variants in declaration order — first passing variant wins
        foreach (var v in endpoint.Variants)
        {
            if (!ScenarioApplies(v.Scenarios, scenario)) continue;
            if (!RulesPass(v, query, headers, body)) continue;
            return v;
        }

        // Path matched but no variant passed: use first variant as fallback so the
        // endpoint is still considered matched (mirrors matcher.ts).
        return endpoint.Variants.Count > 0 ? endpoint.Variants[0] : null;
    }

    private static bool ScenarioApplies(List<string> variantScenarios, string active)
        => variantScenarios.Count == 0 || variantScenarios.Contains(active);

    private static bool RulesPass(
        VariantDef variant,
        Dictionary<string, string> query,
        Dictionary<string, string> headers,
        object? body)
    {
        foreach (var (name, rule) in variant.Match.Headers)
            if (!TestRule(rule, headers.GetValueOrDefault(name.ToLowerInvariant()))) return false;

        foreach (var (name, rule) in variant.Match.Query)
            if (!TestRule(rule, query.GetValueOrDefault(name))) return false;

        foreach (var jp in variant.Match.BodyJsonPath)
            if (!TestOp(EvalJsonPath(body, jp.Path), jp.Op, jp.Value)) return false;

        return true;
    }

    private static bool TestRule(RuleVal rule, string? actual)
    {
        if (rule.IsRegex) return actual is not null && Regex.IsMatch(actual, rule.Value);
        if (rule.Value == "present") return actual is not null;
        if (rule.Value == "!present") return actual is null;
        return actual == rule.Value;
    }

    private static bool TestOp(object? actual, string op, object? value) => op switch
    {
        "exists" => actual is not null,
        "eq" => StrictEquals(actual, value),
        "regex" => actual is string s && Regex.IsMatch(s, Convert.ToString(value) ?? ""),
        "gt" => actual is double a && value is double b && a > b,
        "lt" => actual is double a2 && value is double b2 && a2 < b2,
        _ => false,
    };

    // Mirrors JS `actual === value`: same type and value (numbers as double, etc.).
    // Body booleans arrive as JsBool (from Json.Normalize); rule values are plain bool.
    private static bool StrictEquals(object? a, object? b)
    {
        if (a is null || b is null) return a is null && b is null;
        if (a is double da && b is double db) return da.Equals(db);
        if (a is JsBool jba && b is bool jbb) return jba.Value == jbb;
        if (a is bool ba && b is bool bb) return ba == bb;
        if (a is string sa && b is string sb) return sa == sb;
        return false;
    }

    /// <summary>Minimal dotted JSONPath evaluator — supports $.a.b.c and $.a[0].b.</summary>
    private static object? EvalJsonPath(object? obj, string path)
    {
        if (!path.StartsWith("$.")) return null;
        var parts = path.Substring(2).Split('.');
        object? cur = obj;
        foreach (var part in parts)
        {
            if (cur is null) return null;
            var arrMatch = Regex.Match(part, @"^(\w+)\[(\d+)\]$");
            if (arrMatch.Success)
            {
                if (cur is Dictionary<string, object?> d
                    && d.TryGetValue(arrMatch.Groups[1].Value, out var arr)
                    && arr is List<object?> list)
                {
                    var idx = int.Parse(arrMatch.Groups[2].Value);
                    cur = idx >= 0 && idx < list.Count ? list[idx] : null;
                }
                else
                {
                    return null;
                }
            }
            else
            {
                cur = cur is Dictionary<string, object?> d2 && d2.TryGetValue(part, out var val) ? val : null;
            }
        }
        return cur;
    }
}
