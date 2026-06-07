using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace MokkapiMock;

/// <summary>
/// Dev-only TLS: generates an in-memory self-signed cert for localhost at startup so
/// HTTPS works in every run mode with no certificate to provide, mount or install.
/// It is self-signed, so clients must skip verification (e.g. curl -k).
/// </summary>
internal static class MockTls
{
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
