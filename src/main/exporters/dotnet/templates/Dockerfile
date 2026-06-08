# syntax=docker/dockerfile:1

# - Build stage -
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/ ./
RUN dotnet publish MokkapiMock.csproj -c Release -o /app

# - Runtime stage -
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app ./
# Listens on 8080 (HTTP) + 8443 (HTTPS). The app self-generates its TLS cert (see MockTls).
ENV ASPNETCORE_HTTP_PORTS=8080 \
    ASPNETCORE_HTTPS_PORTS=8443
EXPOSE 8080 8443
ENTRYPOINT ["dotnet", "MokkapiMock.dll"]
