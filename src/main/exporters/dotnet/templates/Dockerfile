# syntax=docker/dockerfile:1

# ── Build stage ────────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/ ./
RUN dotnet publish MokkapiMock.csproj -c Release -o /app

# ── Runtime stage ───────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app ./
# Container listens on 8080 (HTTP) and 8443 (HTTPS); docker-compose maps the host
# ports to them. Modern ASP.NET port binding (.NET 8+). No certificate is mounted or
# configured — the app generates its own self-signed dev cert at startup (see MockTls).
ENV ASPNETCORE_HTTP_PORTS=8080 \
    ASPNETCORE_HTTPS_PORTS=8443
EXPOSE 8080 8443
ENTRYPOINT ["dotnet", "MokkapiMock.dll"]
