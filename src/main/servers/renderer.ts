/**
 * Handlebars-based response body renderer.
 * Provides {{faker.*}}, {{request.*}}, {{now}}, {{nowMs}} helpers.
 */

import Handlebars from 'handlebars';
import { faker } from '@faker-js/faker';

let registered = false;

function registerHelpers(): void {
  if (registered) return;
  registered = true;

  // ── Faker helpers ────────────────────────────────────────────────────────
  const h = (name: string, fn: (...args: unknown[]) => unknown) =>
    Handlebars.registerHelper(name, fn);

  h('faker.uuid',      () => faker.string.uuid());
  h('faker.name',      () => faker.person.fullName());
  h('faker.firstName', () => faker.person.firstName());
  h('faker.lastName',  () => faker.person.lastName());
  h('faker.email',     () => faker.internet.email());
  h('faker.phone',     () => faker.phone.number());
  h('faker.int',       (min: unknown = 1, max: unknown = 1000) =>
    faker.number.int({ min: Number(min), max: Number(max) }));
  h('faker.float',     (min: unknown = 0, max: unknown = 1000) =>
    faker.number.float({ min: Number(min), max: Number(max), fractionDigits: 2 }));
  h('faker.bool',      () => faker.datatype.boolean());
  h('faker.date',      () => faker.date.recent().toISOString());
  h('faker.sentence',  () => faker.lorem.sentence());
  h('faker.word',      () => faker.lorem.word());
  h('faker.paragraph', () => faker.lorem.paragraph());
  h('faker.ipv4',      () => faker.internet.ip());
  h('faker.url',       () => faker.internet.url());
  h('faker.color',     () => faker.internet.color());
  h('faker.company',   () => faker.company.name());
  h('faker.country',   () => faker.location.country());
  h('faker.city',      () => faker.location.city());
  h('faker.street',    () => faker.location.streetAddress());
  h('faker.zip',       () => faker.location.zipCode());

  // ── Time helpers ─────────────────────────────────────────────────────────
  h('now',       () => new Date().toISOString());
  h('nowMs',     () => Date.now());
  h('timestamp', () => Math.floor(Date.now() / 1000));

  // ── String helpers ───────────────────────────────────────────────────────
  h('upper', (s: unknown) => String(s).toUpperCase());
  h('lower', (s: unknown) => String(s).toLowerCase());
  h('json',  (v: unknown) => JSON.stringify(v));
}

export interface RenderContext {
  request: {
    params:  Record<string, string>;
    query:   Record<string, string>;
    headers: Record<string, string>;
    body:    unknown;
  };
}

export function renderBody(template: string, context: RenderContext): string {
  registerHelpers();
  try {
    return Handlebars.compile(template, { noEscape: true })(context);
  } catch (err) {
    console.warn('[Renderer] Template error:', err instanceof Error ? err.message : err);
    return template; // Return raw template on compile/render error
  }
}

/** Determine the default Content-Type for a given bodyKind */
export function defaultContentType(bodyKind: string): string {
  switch (bodyKind) {
    case 'json': return 'application/json; charset=utf-8';
    case 'xml':  return 'application/xml; charset=utf-8';
    case 'html': return 'text/html; charset=utf-8';
    case 'text': return 'text/plain; charset=utf-8';
    default:     return 'application/octet-stream';
  }
}
