import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { listenWithLoopbackSupport, listenOnLoopback } from './service-host';

const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('listenWithLoopbackSupport', () => {
  it('accepts IPv6 loopback requests when IPv6 is available', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);

    app.get('/health', async () => ({ ok: true }));

    const listening = await listenWithLoopbackSupport(app, 0);
    const hostLabel = listening.hostLabel;
    const port = listening.port;

    expect(port).not.toBeNull();

    if (hostLabel === 'localhost') {
      const response = await fetch(`http://[::1]:${port}/health`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
      return;
    }

    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});

describe('listenOnLoopback', () => {
  it('binds only to localhost-compatible interfaces', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);

    app.get('/health', async () => ({ ok: true }));

    const listening = await listenOnLoopback(app, 0);

    if (listening.hostLabel === 'localhost') {
      const response = await fetch(`http://[::1]:${listening.port}/health`);
      expect(response.status).toBe(200);
      return;
    }

    const response = await fetch(`http://127.0.0.1:${listening.port}/health`);
    expect(response.status).toBe(200);
  });
});