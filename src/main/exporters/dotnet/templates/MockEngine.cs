using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace MokkapiMock;

/// <summary>
/// Request handler shared by every generated route. Port of the per-request logic
/// in mokkapi's src/main/servers/service-host.ts: normalise → select variant →
/// delay → render → write, with a 501 no_match fallback. Logs each request to
/// stdout (headless-friendly; no SQLite history in the generated mock).
/// </summary>
public static class MockEngine
{
    // Match JS JSON.stringify escaping (no ' / + for ' and +).
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static string ActiveScenario()
        => Environment.GetEnvironmentVariable("MOKKAPI_SCENARIO") is { Length: > 0 } s
            ? s
            : ServiceInfo.DefaultScenario;

    public static async Task Handle(HttpContext ctx, EndpointDef endpoint)
    {
        var startMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        // ── Normalise incoming request ────────────────────────────────────────
        var headers = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var h in ctx.Request.Headers)
            headers[h.Key.ToLowerInvariant()] = h.Value.ToString();

        var query = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var q in ctx.Request.Query)
            query[q.Key] = q.Value.FirstOrDefault() ?? "";

        var routeParams = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var rv in ctx.Request.RouteValues)
            if (rv.Value is not null)
                routeParams[rv.Key] = Uri.UnescapeDataString(rv.Value.ToString() ?? "");

        var contentType = headers.GetValueOrDefault("content-type", "");
        var (rawBody, parsedBody) = await ReadBodyAsync(ctx.Request, contentType);
        _ = rawBody; // captured for parity/extension; not persisted in the generated mock

        // ── Select variant + build response ───────────────────────────────────
        var scenario = ActiveScenario();
        var variant = Matcher.SelectVariant(endpoint, scenario, query, headers, parsedBody);

        int status;
        Dictionary<string, string> resHeaders;
        string resBody;

        if (variant is null)
        {
            await WriteNoMatchAsync(ctx, startMs);
            return;
        }
        else
        {
            if (variant.DelayMs > 0) await Task.Delay(variant.DelayMs);

            resBody = BodyRenderer.Render(variant.Body, routeParams, query, headers, parsedBody);
            status = variant.Status;
            resHeaders = new Dictionary<string, string>(variant.Headers, StringComparer.OrdinalIgnoreCase);

            if (!resHeaders.Keys.Any(k => string.Equals(k, "content-type", StringComparison.OrdinalIgnoreCase)))
                resHeaders["content-type"] = BodyRenderer.DefaultContentType(variant.BodyKind);
        }

        var durationMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - startMs;
        Console.WriteLine(
            $"[mokkapi-mock] {ctx.Request.Method} {ctx.Request.Path}{ctx.Request.QueryString} -> {status} ({durationMs}ms)"
            + (variant is not null ? $" [{variant.Name}]" : ""));

        // ── Send response ─────────────────────────────────────────────────────
        ctx.Response.StatusCode = status;
        foreach (var kv in resHeaders)
            ctx.Response.Headers[kv.Key] = kv.Value;
        await ctx.Response.WriteAsync(resBody, Encoding.UTF8);
    }

    /// <summary>
    /// Fallback for requests that match no registered route. Mirrors mokkapi, whose
    /// catch-all always answers with a 501 no_match (rather than ASP.NET's default 404).
    /// </summary>
    public static Task HandleNoMatch(HttpContext ctx)
        => WriteNoMatchAsync(ctx, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());

    private static async Task WriteNoMatchAsync(HttpContext ctx, long startMs)
    {
        const int status = 501;
        var body = JsonSerializer.Serialize(new
        {
            error = "no_match",
            message = $"mokkapi: no variant matched {ctx.Request.Method} {ctx.Request.Path} on service '{ServiceInfo.Name}'",
            hint = "Add a matching endpoint + variant, or check the active scenario.",
        }, JsonOpts);

        var durationMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - startMs;
        Console.WriteLine($"[mokkapi-mock] {ctx.Request.Method} {ctx.Request.Path}{ctx.Request.QueryString} -> {status} ({durationMs}ms) [no_match]");

        ctx.Response.StatusCode = status;
        ctx.Response.Headers["content-type"] = "application/json";
        await ctx.Response.WriteAsync(body, Encoding.UTF8);
    }

    private static async Task<(string? raw, object? parsed)> ReadBodyAsync(HttpRequest request, string contentType)
    {
        using var reader = new StreamReader(request.Body, Encoding.UTF8);
        var text = await reader.ReadToEndAsync();
        if (string.IsNullOrEmpty(text)) return (null, null);

        var isJson = contentType.Contains("application/json") || contentType.Contains("+json");
        if (!isJson) return (text, text);

        try
        {
            using var doc = JsonDocument.Parse(text);
            return (text, Json.Normalize(doc.RootElement));
        }
        catch
        {
            return (text, text);
        }
    }
}
