using System.Collections.Concurrent;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using Bogus;
using HandlebarsDotNet;

namespace MokkapiMock;

/// <summary>
/// Handlebars body renderer. Faithful port of mokkapi's src/main/servers/renderer.ts.
/// Provides {{faker.*}}, {{request.*}}, {{now}}, {{nowMs}}, {{timestamp}},
/// {{upper}}, {{lower}}, {{json}} helpers.
///
/// Three parity details that matter:
///   1. HTML escaping is DISABLED (TextEncoder = null) - mokkapi compiles with
///      noEscape:true; otherwise JSON bodies with &lt; or &amp; would corrupt.
///   2. mokkapi registers dotted helper names like "faker.uuid". Handlebars.Net parses
///      {{faker.uuid}} as a context path, not a helper. We rewrite the leading
///      `faker.x` token to `faker_x` and register the helpers under those names -
///      behaviour-equivalent, templates stay unchanged.
///   3. Handlebars.Net greedily consumes a run of '}' at a mustache close, so a simple
///      expression immediately followed by a JSON brace (e.g. {"amount":{{x}}}) either
///      fails to parse or drops the trailing brace - yet Handlebars.js (mokkapi) renders
///      it correctly. We therefore EXTRACT top-level simple expressions into brace-free
///      markers, let Handlebars.Net render the scaffold (so block helpers like
///      {{#each}} still work), then evaluate each extracted expression in isolation
///      (no adjacent brace) and substitute the result back.
/// </summary>
public static class BodyRenderer
{
    private static readonly IHandlebars Hb = CreateEngine();
    // Bogus.Faker is not thread-safe; ASP.NET serves requests concurrently.
    private static readonly ThreadLocal<Faker> Fkr = new(() => new Faker());
    private static readonly ConcurrentDictionary<string, HandlebarsTemplate<object, object>> ExprCache = new();

    // Match JS JSON.stringify, which (unlike System.Text.Json's default) does not
    // escape ' + < > &. Used by the {{json}} helper for byte-parity with mokkapi.
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private static readonly Regex FakerToken = new(@"\{\{(\s*)faker\.([A-Za-z]+)", RegexOptions.Compiled);
    // A simple mustache: {{ expr }} with no inner braces, closed by the FIRST }} (not greedy).
    private static readonly Regex MustacheToken = new(@"\{\{\s*([^{}]+?)\s*\}\}", RegexOptions.Compiled);

    // Readable, brace-free placeholder for lifting a simple {{expr}} out of the template
    // before Handlebars compiles the scaffold, then swapping the rendered value back in.
    // Plain ASCII (so the source and any dumped scaffold stay readable) and distinctive
    // enough not to collide with real JSON/XML/text bodies.
    private const string SlotOpen = "[[mokkapi-slot:";
    private const string SlotClose = "]]";

    public static string Render(
        string template,
        Dictionary<string, string> @params,
        Dictionary<string, string> query,
        Dictionary<string, string> headers,
        object? body)
    {
        try
        {
            var context = new Dictionary<string, object?>
            {
                ["request"] = new Dictionary<string, object?>
                {
                    ["params"] = @params,
                    ["query"] = query,
                    ["headers"] = headers,
                    ["body"] = body,
                },
            };

            var faker = FakerToken.Replace(template, "{{$1faker_$2");
            var (scaffold, slots) = ExtractSimpleExpressions(faker);

            // Render the scaffold (block helpers, partials, comments). Simple expressions
            // are now plain markers - inert literal text - so brace adjacency can't bite.
            var rendered = Hb.Compile(scaffold)(context);

            foreach (var (marker, expr) in slots)
                rendered = rendered.Replace(marker, RenderExpression(expr, context));

            return rendered;
        }
        catch
        {
            // Mirror renderer.ts: return the raw template on compile/render error.
            return template;
        }
    }

    /// <summary>Default Content-Type for a given bodyKind (mirrors renderer.ts).</summary>
    public static string DefaultContentType(string bodyKind) => bodyKind switch
    {
        "json" => "application/json; charset=utf-8",
        "xml" => "application/xml; charset=utf-8",
        "html" => "text/html; charset=utf-8",
        "text" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    };

    // - Internals -

    /// <summary>
    /// Replaces every top-level (not inside a block helper) simple mustache with a
    /// brace-free marker, returning the scaffold and the marker->expression map.
    /// Block helpers, comments, partials, inverse sections and {{else}} are preserved.
    /// </summary>
    private static (string scaffold, List<(string marker, string expr)> slots) ExtractSimpleExpressions(string template)
    {
        var slots = new List<(string, string)>();
        var sb = new StringBuilder();
        var depth = 0;
        var index = 0;
        var pos = 0;

        foreach (Match m in MustacheToken.Matches(template))
        {
            sb.Append(template, pos, m.Index - pos);
            pos = m.Index + m.Length;

            var bodyExpr = m.Groups[1].Value.Trim();
            var sigil = bodyExpr.Length > 0 ? bodyExpr[0] : '\0';

            if (sigil is '#' or '^')
            {
                depth++;
                sb.Append(m.Value);
            }
            else if (sigil == '/')
            {
                depth = Math.Max(0, depth - 1);
                sb.Append(m.Value);
            }
            else if (sigil is '!' or '>' || bodyExpr == "else")
            {
                sb.Append(m.Value);
            }
            else if (depth == 0)
            {
                var marker = $"{SlotOpen}{index++}{SlotClose}";
                slots.Add((marker, bodyExpr));
                sb.Append(marker);
            }
            else
            {
                // Inside a block helper - leave for Handlebars.Net to render in scope.
                sb.Append(m.Value);
            }
        }

        sb.Append(template, pos, template.Length - pos);
        return (sb.ToString(), slots);
    }

    private static string RenderExpression(string expr, Dictionary<string, object?> context)
    {
        var template = ExprCache.GetOrAdd(expr, e => Hb.Compile("{{" + e + "}}"));
        return template(context);
    }

    private static IHandlebars CreateEngine()
    {
        var hb = Handlebars.Create(new HandlebarsConfiguration { TextEncoder = null });
        Register(hb);
        return hb;
    }

    private static void Register(IHandlebars hb)
    {
        void R(string name, Func<Arguments, object?> fn)
            => hb.RegisterHelper(name, (Context _, Arguments args) => fn(args) ?? "");

        var f = () => Fkr.Value!;

        // - Faker helpers (registered as faker_*; see class summary) -
        R("faker_uuid", _ => f().Random.Guid().ToString());
        R("faker_name", _ => f().Name.FullName());
        R("faker_firstName", _ => f().Name.FirstName());
        R("faker_lastName", _ => f().Name.LastName());
        R("faker_email", _ => f().Internet.Email());
        R("faker_phone", _ => f().Phone.PhoneNumber());
        R("faker_int", a => f().Random.Int(ArgInt(a, 0, 1), ArgInt(a, 1, 1000)));
        R("faker_float", a => Math.Round(f().Random.Double(ArgDbl(a, 0, 0), ArgDbl(a, 1, 1000)), 2));
        R("faker_bool", _ => f().Random.Bool() ? "true" : "false"); // JS-style, not C# "True"
        R("faker_date", _ => f().Date.Recent().ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ"));
        R("faker_sentence", _ => f().Lorem.Sentence());
        R("faker_word", _ => f().Lorem.Word());
        R("faker_paragraph", _ => f().Lorem.Paragraph());
        R("faker_ipv4", _ => f().Internet.Ip());
        R("faker_url", _ => f().Internet.Url());
        R("faker_color", _ => f().Internet.Color());
        R("faker_company", _ => f().Company.CompanyName());
        R("faker_country", _ => f().Address.Country());
        R("faker_city", _ => f().Address.City());
        R("faker_street", _ => f().Address.StreetAddress());
        R("faker_zip", _ => f().Address.ZipCode());

        // - Time helpers -
        R("now", _ => DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"));
        R("nowMs", _ => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        R("timestamp", _ => DateTimeOffset.UtcNow.ToUnixTimeSeconds());

        // - String helpers -
        R("upper", a => (a.Length > 0 ? a[0]?.ToString() : "")?.ToUpperInvariant() ?? "");
        R("lower", a => (a.Length > 0 ? a[0]?.ToString() : "")?.ToLowerInvariant() ?? "");
        R("json", a => JsonSerializer.Serialize(a.Length > 0 ? a[0] : null, JsonOpts));
    }

    private static int ArgInt(Arguments a, int index, int fallback)
        => a.Length > index && int.TryParse(Convert.ToString(a[index]), out var v) ? v : fallback;

    private static double ArgDbl(Arguments a, int index, double fallback)
        => a.Length > index && double.TryParse(Convert.ToString(a[index]), out var v) ? v : fallback;
}
