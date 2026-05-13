/**
 * Pure request matcher.
 * Given a Service (with its active scenario), a method, URL, headers, query, and
 * parsed body, returns the first matching [endpoint, variant, params] triple or null.
 */

import type { Endpoint, ResponseVariant, Service } from '../../shared/models';

export interface MatchResult {
  endpoint: Endpoint;
  variant: ResponseVariant;
  params: Record<string, string>;
}

export function matchRequest(
  service: Service,
  method: string,
  url: string,
  query: Record<string, string>,
  headers: Record<string, string>,
  body: unknown,
): MatchResult | null {
  const pathname = stripQuery(url);

  for (const endpoint of service.endpoints) {
    if (endpoint.method.toUpperCase() !== method.toUpperCase()) continue;

    const params = matchPath(endpoint.path, pathname);
    if (params === null) continue;

    // forcedVariantId bypasses all matching rules
    if (endpoint.forcedVariantId) {
      const forced = endpoint.variants.find((v) => v.id === endpoint.forcedVariantId);
      if (forced) return { endpoint, variant: forced, params };
    }

    // Walk variants in declaration order — first passing variant wins
    for (const variant of endpoint.variants) {
      if (!scenarioApplies(variant.scenarios, service.activeScenario)) continue;
      if (!rulesPass(variant, query, headers, body)) continue;
      return { endpoint, variant, params };
    }

    // Path matched but no variant passed: use first variant as fallback so the
    // endpoint is still considered matched (lets us log it accurately).
    if (endpoint.variants.length > 0) {
      return { endpoint, variant: endpoint.variants[0], params };
    }
  }

  return null;
}

/** Match a route pattern (`:param` segments) against an actual URL path */
export function matchPath(pattern: string, actual: string): Record<string, string> | null {
  // Normalise trailing slashes
  const p = pattern.replace(/\/$/, '') || '/';
  const a = actual.replace(/\/$/, '') || '/';

  const pParts = p.split('/');
  const aParts = a.split('/');
  if (pParts.length !== aParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < pParts.length; i++) {
    if (pParts[i].startsWith(':')) {
      params[pParts[i].slice(1)] = decodeURIComponent(aParts[i]);
    } else if (pParts[i] !== aParts[i]) {
      return null;
    }
  }
  return params;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function scenarioApplies(variantScenarios: string[], active: string): boolean {
  return variantScenarios.length === 0 || variantScenarios.includes(active);
}

function rulesPass(
  variant: ResponseVariant,
  query: Record<string, string>,
  headers: Record<string, string>,
  body: unknown,
): boolean {
  for (const [name, rule] of Object.entries(variant.match.headers)) {
    if (!testRule(rule, headers[name.toLowerCase()])) return false;
  }
  for (const [name, rule] of Object.entries(variant.match.query)) {
    if (!testRule(rule, query[name])) return false;
  }
  for (const jpRule of variant.match.bodyJsonPath) {
    const actual = evalJsonPath(body, jpRule.path);
    if (!testOp(actual, jpRule.op, jpRule.value)) return false;
  }
  return true;
}

type RuleValue = string | { regex: string };

function testRule(rule: RuleValue, actual: string | undefined): boolean {
  if (typeof rule === 'object' && 'regex' in rule) {
    return actual !== undefined && new RegExp(rule.regex).test(actual);
  }
  if (rule === 'present')  return actual !== undefined;
  if (rule === '!present') return actual === undefined;
  return actual === rule;
}

function testOp(actual: unknown, op: string, value?: unknown): boolean {
  switch (op) {
    case 'exists': return actual !== undefined && actual !== null;
    case 'eq':     return actual === value;
    case 'regex':  return typeof actual === 'string' && new RegExp(String(value)).test(actual);
    case 'gt':     return typeof actual === 'number' && actual > (value as number);
    case 'lt':     return typeof actual === 'number' && actual < (value as number);
    default:       return false;
  }
}

/** Minimal dotted JSONPath evaluator — supports $.a.b.c and $.a[0].b */
function evalJsonPath(obj: unknown, path: string): unknown {
  if (!path.startsWith('$.')) return undefined;
  const parts = path.slice(2).split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    const arrMatch = /^(\w+)\[(\d+)\]$/.exec(part);
    if (arrMatch) {
      cur = (cur as Record<string, unknown[]>)[arrMatch[1]]?.[Number(arrMatch[2])];
    } else {
      cur = (cur as Record<string, unknown>)[part];
    }
  }
  return cur;
}

function stripQuery(url: string): string {
  const q = url.indexOf('?');
  return q >= 0 ? url.slice(0, q) : url;
}
