import { describe, expect, it } from 'vitest';
import {
  bindingUsesPort,
  buildIisRuleName,
  buildIisRuleWildcard,
  buildIisSiteConfigPath,
  buildIisPrerequisiteMessage,
  collectIisPatterns,
  endpointPathToIisPattern,
  isIisAccessDeniedError,
  isIisUnavailableError,
  shouldUseIisForService,
} from './iis-manager';

describe('shouldUseIisForService', () => {
  it('uses IIS only for canonical 80/443 bindings', () => {
    expect(shouldUseIisForService({ port: 80, protocol: 'http' })).toBe(true);
    expect(shouldUseIisForService({ port: 443, protocol: 'https' })).toBe(true);
    expect(shouldUseIisForService({ port: 80, protocol: 'https' })).toBe(false);
    expect(shouldUseIisForService({ port: 4001, protocol: 'http' })).toBe(false);
  });
});

describe('endpointPathToIisPattern', () => {
  it('maps path params to URL Rewrite regex fragments', () => {
    expect(endpointPathToIisPattern('/v1/orders/:id')).toBe('^v1/orders/[^/]+/?$');
    expect(endpointPathToIisPattern('/')).toBe('^$');
  });

  it('escapes literal regex characters', () => {
    expect(endpointPathToIisPattern('/v1/files/report.v1')).toBe('^v1/files/report\\.v1/?$');
  });
});

describe('collectIisPatterns', () => {
  it('deduplicates endpoint path patterns', () => {
    const patterns = collectIisPatterns([
      { id: '1', method: 'GET', path: '/items/:id', description: '', variants: [], forcedVariantId: null },
      { id: '2', method: 'POST', path: '/items/:id', description: '', variants: [], forcedVariantId: null },
    ]);

    expect(patterns).toEqual(['^items/[^/]+/?$']);
  });
});

describe('bindingUsesPort', () => {
  it('matches IIS bindingInformation by port', () => {
    expect(bindingUsesPort('*:80:', 80)).toBe(true);
    expect(bindingUsesPort('*:443:example.test', 443)).toBe(true);
    expect(bindingUsesPort('*:8080:', 80)).toBe(false);
  });
});

describe('IIS rule naming', () => {
  it('builds the exact rule names and wildcard used by apply/remove', () => {
    expect(buildIisRuleName('orders-api', 2)).toBe('mokkapi-orders-api-2');
    expect(buildIisRuleWildcard('orders-api')).toBe('mokkapi-orders-api-*');
  });

  it('builds the site web.config path', () => {
    expect(buildIisSiteConfigPath('C:/inetpub/wwwroot')).toBe('C:\\inetpub\\wwwroot\\web.config');
  });
});

describe('buildIisPrerequisiteMessage', () => {
  it('describes missing URL Rewrite and ARR prerequisites', () => {
    expect(buildIisPrerequisiteMessage('Default Web Site', {
      urlRewriteInstalled: false,
      arrInstalled: false,
    })).toContain('IIS URL Rewrite and Application Request Routing (ARR)');
  });

  it('returns null when IIS can already proxy', () => {
    expect(buildIisPrerequisiteMessage('Default Web Site', {
      urlRewriteInstalled: true,
      arrInstalled: true,
    })).toBeNull();
  });
});

describe('IIS error classification', () => {
  it('treats elevated-process failures as access denied instead of missing IIS', () => {
    const error = new Error("Import-Module WebAdministration: El proceso debe tener un estado elevado para obtener acceso a los datos de configuración IIS.");
    expect(isIisAccessDeniedError(error)).toBe(true);
    expect(isIisUnavailableError(error)).toBe(false);
  });

  it('treats missing WebAdministration provider as IIS unavailable', () => {
    const error = new Error("Get-Website: No se encuentra ningún proveedor con el nombre 'WebAdministration'.");
    expect(isIisUnavailableError(error)).toBe(true);
    expect(isIisAccessDeniedError(error)).toBe(false);
  });
});