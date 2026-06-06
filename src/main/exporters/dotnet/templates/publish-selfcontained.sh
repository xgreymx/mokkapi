#!/usr/bin/env bash
# Publish a self-contained, single-file binary that runs on a headless server with
# NO .NET runtime installed. Copy ./publish/MokkapiMock to the target and run it.
set -euo pipefail

RID="${1:-linux-x64}"   # e.g. linux-x64, linux-arm64, linux-musl-x64
HERE="$(cd "$(dirname "$0")" && pwd)"

dotnet publish "$HERE/src/MokkapiMock.csproj" \
  -c Release \
  -r "$RID" \
  --self-contained true \
  -p:PublishSingleFile=true \
  -p:IncludeNativeLibrariesForSelfExtract=true \
  -o "$HERE/publish"

echo
echo "Built: $HERE/publish/MokkapiMock"
echo "Run:   MOKKAPI_PORT=__MOKKAPI_PORT__ $HERE/publish/MokkapiMock"
echo "       (defaults to port __MOKKAPI_PORT__ if MOKKAPI_PORT is unset)"
