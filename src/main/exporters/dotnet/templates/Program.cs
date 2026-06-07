using MokkapiMock;

var builder = WebApplication.CreateBuilder(args);

// Supply a default server certificate for any HTTPS endpoint so TLS works with zero
// setup — the mock generates its own self-signed cert (see MockTls); you never provide,
// mount or install one. Applies whether HTTPS is bound via env vars or by us below.
builder.WebHost.ConfigureKestrel(kestrel =>
    kestrel.ConfigureHttpsDefaults(https => https.ServerCertificate = MockTls.CreateSelfSigned()));

var app = builder.Build();

// Port binding. The modern ASP.NET env vars win when set (ASPNETCORE_URLS, or the
// .NET 8+ ASPNETCORE_HTTP_PORTS / ASPNETCORE_HTTPS_PORTS) — that's the Docker path.
// Otherwise (local / framework-dependent / self-contained) bind BOTH schemes directly:
//   http  → MOKKAPI_PORT      else the port baked at export time
//   https → MOKKAPI_HTTPS_PORT else http port + 1
// Both are served side by side (no HTTPS redirect) — a dev mock needs http AND https.
var envConfigured =
    !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ASPNETCORE_URLS"))
    || !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ASPNETCORE_HTTP_PORTS"))
    || !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ASPNETCORE_HTTPS_PORTS"));

if (!envConfigured)
{
    var httpPort = ResolvePort("MOKKAPI_PORT", ServiceInfo.Port);
    var httpsPort = ResolvePort("MOKKAPI_HTTPS_PORT", httpPort + 1);
    app.Urls.Add($"http://0.0.0.0:{httpPort}");
    app.Urls.Add($"https://0.0.0.0:{httpsPort}");
}

static int ResolvePort(string envName, int fallback) =>
    int.TryParse(Environment.GetEnvironmentVariable(envName), out var p) ? p : fallback;

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

var boundUrls = app.Urls.Count > 0 ? string.Join(", ", app.Urls) : "(configured via ASPNETCORE_* env)";
Console.WriteLine($"[mokkapi-mock] '{ServiceInfo.Name}' ready — active scenario '{MockEngine.ActiveScenario()}' — listening on {boundUrls}");

app.Run();
