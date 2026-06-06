using MokkapiMock;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

// Resolve the listen URL:
//   ASPNETCORE_URLS (if set) wins — used by the Docker image (container port 8080).
//   else MOKKAPI_PORT, else the service's configured port baked at export time.
// Binding the service port directly means CDI-PUI's expected URL works for local
// and self-contained runs without any port mapping.
var configuredUrls = Environment.GetEnvironmentVariable("ASPNETCORE_URLS");
if (string.IsNullOrWhiteSpace(configuredUrls))
{
    var portEnv = Environment.GetEnvironmentVariable("MOKKAPI_PORT");
    var port = int.TryParse(portEnv, out var p) ? p : ServiceInfo.Port;
    app.Urls.Add($"http://0.0.0.0:{port}");
}

// CORS passthrough based on the service config (mirrors mokkapi's onSend hook:
// permissive methods/headers, configured origins joined or "*"). Applied to every
// response — including the 501 no_match — exactly like mokkapi.
app.Use(async (ctx, next) =>
{
    var origins = ServiceInfo.AllowedOrigins.Length > 0
        ? string.Join(", ", ServiceInfo.AllowedOrigins)
        : "*";
    ctx.Response.Headers["Access-Control-Allow-Origin"] = string.IsNullOrEmpty(origins) ? "*" : origins;
    ctx.Response.Headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS";
    ctx.Response.Headers["Access-Control-Allow-Headers"] = "*";
    await next();
});

// Health/diagnostics endpoint (not part of the mocked surface).
app.MapGet("/__mokkapi/health", () => Results.Json(new
{
    ok = true,
    service = ServiceInfo.Name,
    scenario = MockEngine.ActiveScenario(),
}));

// ── Generated endpoint registrations ──────────────────────────────────────────
// __MOKKAPI_ROUTE_REGISTRATIONS__

// Anything that matches no registered route answers with mokkapi's 501 no_match
// (the desktop app's catch-all behaves this way; ASP.NET would otherwise 404).
app.MapFallback(MockEngine.HandleNoMatch);

Console.WriteLine($"[mokkapi-mock] '{ServiceInfo.Name}' ready — active scenario '{MockEngine.ActiveScenario()}'");

app.Run();
