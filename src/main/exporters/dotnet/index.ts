/**
 * .NET 10 exporter - turns a mokkapi Service into a runnable, self-contained mock
 * API project under <outputDir>/<service-id>/. Hybrid shape: explicit route per
 * endpoint (Program.cs) + a shared engine (MockEngine/Matcher/BodyRenderer) that
 * faithfully ports mokkapi's matching and Handlebars/faker rendering.
 *
 * Static template files are bundled via Vite `?raw` imports; only Endpoints.cs and
 * the Program.cs route block are generated per service.
 */

import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import type { Service, ExportOptions, ExportResult } from '../../../shared/models';
import { emitEndpoints } from './emit-endpoints';

import programCsTemplate from './templates/Program.cs?raw';
import mockEngineCs from './templates/MockEngine.cs?raw';
import matcherCs from './templates/Matcher.cs?raw';
import bodyRendererCs from './templates/BodyRenderer.cs?raw';
import mockTlsCs from './templates/MockTls.cs?raw';
import serviceDefinitionCs from './templates/ServiceDefinition.cs?raw';
import csproj from './templates/MokkapiMock.csproj?raw';
import dockerfile from './templates/Dockerfile?raw';
import dockerignore from './templates/dockerignore?raw';
import dockerCompose from './templates/docker-compose.yml?raw';
import readme from './templates/README.md?raw';
import publishScript from './templates/publish-selfcontained.sh?raw';

const ROUTE_PLACEHOLDER = '// __MOKKAPI_ROUTE_REGISTRATIONS__';

/**
 * @param service The service to export.
 * @param options Run-mode targets + optional output base directory.
 * @param defaultBaseDir Fallback base dir (e.g. <workspace>/exports) when options.outputDir is unset.
 * @param tls Resolved PEM cert+key to bundle for HTTPS. When omitted, the generated app
 *            falls back to minting its own self-signed cert at startup.
 */
export async function exportDotnet(
  service: Service,
  options: ExportOptions,
  defaultBaseDir: string,
  tls?: { cert: string; key: string },
): Promise<ExportResult> {
  const warnings: string[] = [];
  const targets = new Set(options.targets);

  const baseDir = options.outputDir && options.outputDir.trim() !== '' ? options.outputDir : defaultBaseDir;
  const outputPath = join(baseDir, service.id);
  const srcDir = join(outputPath, 'src');
  await mkdir(srcDir, { recursive: true });

  // ── Generate per-service C# ──────────────────────────────────────────────────
  const emitted = emitEndpoints(service);
  warnings.push(...emitted.warnings);

  // HTTPS listens on the port next to the HTTP one (down a step at the 65535 ceiling).
  const httpsPort = service.port < 65535 ? service.port + 1 : service.port - 1;

  if (service.protocol === 'https') {
    warnings.push(
      tls
        ? `The generated mock serves HTTP and HTTPS; HTTPS uses the certificate you selected, ` +
            `bundled at src/certs/. Call it at https://localhost:${httpsPort}.`
        : 'The generated mock serves both HTTP and HTTPS, using a self-signed dev certificate ' +
            `it generates at startup (no cert needed). It is untrusted - call https://localhost:${httpsPort} ` +
            'with TLS verification disabled (e.g. curl -k).',
    );
  }
  if (service.endpoints.length === 0) {
    warnings.push('Service has no endpoints - the mock will return 404/no routes.');
  }

  const programCs = programCsTemplate.replace(ROUTE_PLACEHOLDER, emitted.routeRegistrations || '// (no endpoints defined)');

  // ── Assemble the file set ────────────────────────────────────────────────────
  const tokens = {
    __MOKKAPI_SERVICE_ID__: service.id,
    __MOKKAPI_SERVICE_NAME__: service.name,
    __MOKKAPI_PORT__: String(service.port),
    __MOKKAPI_HTTPS_PORT__: String(httpsPort),
    __MOKKAPI_SCENARIO__: service.activeScenario,
  };

  const files: Array<{ path: string; content: string }> = [
    { path: join(srcDir, 'Program.cs'), content: programCs },
    { path: join(srcDir, 'Endpoints.cs'), content: emitted.endpointsCs },
    { path: join(srcDir, 'MockEngine.cs'), content: mockEngineCs },
    { path: join(srcDir, 'Matcher.cs'), content: matcherCs },
    { path: join(srcDir, 'BodyRenderer.cs'), content: bodyRendererCs },
    { path: join(srcDir, 'MockTls.cs'), content: mockTlsCs },
    { path: join(srcDir, 'ServiceDefinition.cs'), content: serviceDefinitionCs },
    { path: join(srcDir, 'MokkapiMock.csproj'), content: csproj },
    { path: join(outputPath, 'README.md'), content: applyTokens(readme, tokens) },
  ];

  if (targets.has('docker')) {
    files.push(
      { path: join(outputPath, 'Dockerfile'), content: dockerfile },
      { path: join(outputPath, '.dockerignore'), content: dockerignore },
      { path: join(outputPath, 'docker-compose.yml'), content: applyTokens(dockerCompose, tokens) },
    );
  }
  if (targets.has('selfcontained')) {
    files.push({ path: join(outputPath, 'publish-selfcontained.sh'), content: applyTokens(publishScript, tokens) });
  }
  // 'framework' needs no extra files - covered by the project itself + README.

  // Bundle the chosen HTTPS certificate so it ships with the project (MockTls loads it,
  // else falls back to a runtime self-signed cert). Lives under src/ so the csproj
  // copy-to-output rule and the Docker `COPY src/` both carry it into the build.
  if (tls) {
    const certsDir = join(srcDir, 'certs');
    await mkdir(certsDir, { recursive: true });
    files.push(
      { path: join(certsDir, 'server.crt'), content: tls.cert },
      { path: join(certsDir, 'server.key'), content: tls.key },
    );
  }

  await Promise.all(files.map((f) => writeFile(f.path, f.content, 'utf-8')));

  return {
    serviceId: service.id,
    serviceName: service.name,
    outputPath,
    filesWritten: files.length,
    warnings,
  };
}

function applyTokens(template: string, tokens: Record<string, string>): string {
  let out = template;
  for (const [token, value] of Object.entries(tokens)) {
    out = out.split(token).join(value);
  }
  return out;
}
