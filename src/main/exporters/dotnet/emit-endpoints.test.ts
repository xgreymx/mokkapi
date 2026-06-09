import { describe, it, expect } from 'vitest';
import { emitEndpoints } from './emit-endpoints';
import type { Service, Endpoint, ResponseVariant } from '../../../shared/models';

function makeVariant(overrides: Partial<ResponseVariant> = {}): ResponseVariant {
  return {
    id: 'v1',
    name: 'New variant',
    scenarios: [],
    match: { headers: {}, query: {}, bodyJsonPath: [] },
    delayMs: 0,
    status: 200,
    headers: {},
    body: '{"ok":true}',
    bodyKind: 'json',
    ...overrides,
  };
}

function makeEndpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    id: 'ep1',
    method: 'GET',
    path: '/things',
    description: '',
    variants: [makeVariant()],
    forcedVariantId: null,
    ...overrides,
  };
}

function makeService(endpoints: Endpoint[]): Service {
  return {
    id: 'svc',
    name: 'svc',
    port: 8080,
    protocol: 'http',
    tls: { mode: 'auto', certPath: null, keyPath: null, additionalHosts: [] },
    cors: { allowedOrigins: ['*'] },
    scenarios: ['Default'],
    activeScenario: 'Default',
    enabled: true,
    endpoints,
  };
}

describe('emitEndpoints', () => {
  it('registers a route per endpoint', () => {
    const { routeRegistrations } = emitEndpoints(
      makeService([makeEndpoint(), makeEndpoint({ id: 'ep2', method: 'POST', path: '/things' })]),
    );
    expect(routeRegistrations).toContain('app.MapMethods("/things", new[] { "GET" }');
    expect(routeRegistrations).toContain('app.MapMethods("/things", new[] { "POST" }');
  });

  it('warns when an endpoint has no variants (it will always answer 501)', () => {
    const { warnings, routeRegistrations } = emitEndpoints(
      makeService([makeEndpoint({ variants: [] })]),
    );
    expect(warnings.some((w) => w.includes('GET /things') && w.includes('no response variants'))).toBe(true);
    // The route is still registered so behaviour matches the desktop app (501 no_match).
    expect(routeRegistrations).toContain('app.MapMethods("/things"');
  });

  it('does not warn about variants when every endpoint has at least one', () => {
    const { warnings } = emitEndpoints(makeService([makeEndpoint()]));
    expect(warnings).toEqual([]);
  });

  it('emits an empty body as a valid C# literal', () => {
    const { endpointsCs } = emitEndpoints(
      makeService([makeEndpoint({ variants: [makeVariant({ body: '' })] })]),
    );
    expect(endpointsCs).toContain('Body =\n""\n}');
  });
});
