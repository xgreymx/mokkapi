using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace MokkapiMock;

/// <summary>
/// TLS for the mock. If a certificate was bundled at export time (certs/server.crt +
/// server.key, next to the app), it is used; otherwise an in-memory self-signed cert is
/// generated at startup so HTTPS still works with nothing to install (untrusted - curl -k).
/// </summary>
internal static class MockTls
{
    /// <summary>Returns the bundled certificate if present, else a fresh self-signed one.</summary>
    public static X509Certificate2 Resolve()
    {
        var certPath = Path.Combine(AppContext.BaseDirectory, "certs", "server.crt");
        var keyPath = Path.Combine(AppContext.BaseDirectory, "certs", "server.key");
        if (File.Exists(certPath) && File.Exists(keyPath))
        {
            using var pem = X509Certificate2.CreateFromPemFile(certPath, keyPath);
            // Round-trip through PKCS#12 so Kestrel gets a usable private key on every platform.
            return X509CertificateLoader.LoadPkcs12(pem.Export(X509ContentType.Pfx), null);
        }
        return CreateSelfSigned();
    }

    /// <summary>Self-signed cert for localhost + loopback, valid for the process lifetime.</summary>
    public static X509Certificate2 CreateSelfSigned()
    {
        using var rsa = RSA.Create(2048);
        var request = new CertificateRequest(
            "CN=mokkapi-mock",
            rsa,
            HashAlgorithmName.SHA256,
            RSASignaturePadding.Pkcs1);

        var sanBuilder = new SubjectAlternativeNameBuilder();
        sanBuilder.AddDnsName("localhost");
        sanBuilder.AddIpAddress(IPAddress.Loopback);
        sanBuilder.AddIpAddress(IPAddress.IPv6Loopback);
        request.CertificateExtensions.Add(sanBuilder.Build());

        using var ephemeral = request.CreateSelfSigned(
            DateTimeOffset.UtcNow.AddDays(-1),
            DateTimeOffset.UtcNow.AddYears(10));

        // Round-trip through PKCS#12 so Kestrel gets a usable private key on Linux too.
        return X509CertificateLoader.LoadPkcs12(ephemeral.Export(X509ContentType.Pfx), null);
    }
}
