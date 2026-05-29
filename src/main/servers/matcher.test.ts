import { describe, expect, it } from 'vitest';
import type { Service } from '../../shared/models';
import { matchRequest, normalizeRequestTarget } from './matcher';

const service: Service = {
  id: 'billing-service',
  name: 'Billing Service',
  port: 4010,
  protocol: 'http',
  tls: { mode: 'auto', certPath: null, keyPath: null, additionalHosts: [] },
  cors: { allowedOrigins: ['*'] },
  scenarios: ['Default'],
  activeScenario: 'Default',
  enabled: true,
  endpoints: [
    {
      id: 'ep-orders',
      method: 'GET',
      path: '/v1/orders',
      description: '',
      forcedVariantId: null,
      variants: [
        {
          id: 'var-orders-ok',
          name: '200 OK',
          scenarios: [],
          match: { headers: {}, query: {}, bodyJsonPath: [] },
          delayMs: 0,
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: '{"ok":true}',
          bodyKind: 'json',
        },
      ],
    },
  ],
};

describe('normalizeRequestTarget', () => {
  it('extracts the pathname and query from an absolute-form URL', () => {
    expect(normalizeRequestTarget('http://localhost:4010/v1/orders?status=open')).toEqual({
      pathname: '/v1/orders',
      query: 'status=open',
    });
  });
});

describe('matchRequest', () => {
  it('matches endpoints when the request target is an absolute-form URL', () => {
    const result = matchRequest(
      service,
      'GET',
      'http://localhost:4010/v1/orders?status=open',
      { status: 'open' },
      {},
      null,
    );

    expect(result?.endpoint.id).toBe('ep-orders');
    expect(result?.variant.id).toBe('var-orders-ok');
  });
});