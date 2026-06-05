import { describe, expect, it } from 'vitest';
import { AppSettingsSchema, ServiceSchema } from './schema';

const baseService = {
  id: 'payments-api',
  name: 'Payments API',
  protocol: 'http' as const,
  tls: { mode: 'auto' as const, certPath: null, keyPath: null, additionalHosts: [] },
  cors: { allowedOrigins: ['*'] },
  scenarios: ['Default'],
  activeScenario: 'Default',
  enabled: true,
  endpoints: [],
};

describe('ServiceSchema', () => {
  it('accepts HTTP port 80', () => {
    const parsed = ServiceSchema.parse({
      ...baseService,
      port: 80,
    });

    expect(parsed.port).toBe(80);
  });

  it('accepts HTTPS port 443', () => {
    const parsed = ServiceSchema.parse({
      ...baseService,
      port: 443,
      protocol: 'https',
    });

    expect(parsed.port).toBe(443);
    expect(parsed.protocol).toBe('https');
  });
});

describe('AppSettingsSchema', () => {
  it('accepts low port bases for restricted environments', () => {
    const parsed = AppSettingsSchema.parse({
      workspacePath: 'C:/mokkapi-workspace',
      theme: 'system',
      defaultPortBase: 80,
      historyRetentionDays: 30,
      historyRetentionRows: 100_000,
      onboardingCompletedAt: null,
    });

    expect(parsed.defaultPortBase).toBe(80);
  });
});