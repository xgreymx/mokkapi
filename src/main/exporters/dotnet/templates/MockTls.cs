using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace MokkapiMock;

/// <summary>
/// Dev-only TLS for the mock. Generates an in-memory self-signed certificate for
/// localhost at startup so HTTPS works out of the box in every run mode — Docker,
/// framework-dependent and self-contained — with NO certificate to provide, mount or
/// install (no <c>dotnet dev-certs</c>, no Kestrel cert config).
///
/// The certificate is self-signed and therefore NOT trusted by clients: point your
/// client at the https URL with verification disabled (e.g. <c>curl -k</c>,
/// <c>NODE_TLS_REJECT_UNAUTHORIZED=0</c>, <c>HttpClient</c> with a permissive callback).
/// That is expected and fine — this is a development mock, not a production server.
/// </summary>
internal static class MockTls
{
    /// <summary>
    /// Builds a fresh self-signed certificate valid for <c>localhost</c> and the IPv4/IPv6
    /// loopback addresses. Lives only for the lifetime of the process (kept in memory).
    /// </summary>
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

        // Round-trip through PKCS#12 so Kestrel receives a certificate whose private key
        // is usable on every platform (notably Linux/containers). X509CertificateLoader
        // is the .NET 9+ API; the old `new X509Certificate2(byte[])` ctor is obsolete.
        return X509CertificateLoader.LoadPkcs12(ephemeral.Export(X509ContentType.Pfx), null);
    }
}
