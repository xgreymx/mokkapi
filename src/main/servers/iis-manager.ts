import { execFile } from 'node:child_process';
import { access, readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'node:util';
import type { Endpoint, IisDiagnosticsReport, IisIntegrationStatus, Service } from '../../shared/models';

const execFileAsync = promisify(execFile);
const MOKKAPI_RULE_PREFIX = 'mokkapi';

export interface IisSiteBinding {
  protocol: string;
  bindingInformation: string;
}

export interface IisSiteInfo {
  name: string;
  physicalPath: string;
  bindings: IisSiteBinding[];
}

export interface IisProxyBinding {
  siteName: string;
  publicPort: number;
}

export interface IisProxyPrerequisites {
  urlRewriteInstalled: boolean;
  arrInstalled: boolean;
}

export interface IisInspectionOptions {
  allowElevation?: boolean;
}

interface IisSnapshot {
  iisInstalled: boolean;
  requiresElevation: boolean;
  sites: IisSiteInfo[];
  prerequisites: IisProxyPrerequisites;
}

interface RawIisSnapshot {
  sites: IisSiteInfo | IisSiteInfo[] | null;
  prerequisites: IisProxyPrerequisites;
}

const EMPTY_PREREQUISITES: IisProxyPrerequisites = {
  urlRewriteInstalled: false,
  arrInstalled: false,
};

export function shouldUseIisForService(service: Pick<Service, 'port' | 'protocol'>): boolean {
  return (service.protocol === 'http' && service.port === 80)
    || (service.protocol === 'https' && service.port === 443);
}

export function endpointPathToIisPattern(path: string): string {
  if (path === '/') return '^$';

  const trimmed = path.replace(/^\/+|\/+$/g, '');
  const pattern = trimmed
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) return '[^/]+';
      return escapeRegex(segment);
    })
    .join('/');

  return `^${pattern}/?$`;
}

export function collectIisPatterns(endpoints: Endpoint[]): string[] {
  return Array.from(new Set(endpoints.map((endpoint) => endpointPathToIisPattern(endpoint.path))));
}

export function bindingUsesPort(bindingInformation: string, port: number): boolean {
  const parts = bindingInformation.split(':');
  return parts.length >= 2 && Number(parts[1]) === port;
}

export function buildIisRuleName(serviceId: string, index: number): string {
  return `${MOKKAPI_RULE_PREFIX}-${serviceId}-${index}`;
}

export function buildIisRuleWildcard(serviceId: string): string {
  return `${MOKKAPI_RULE_PREFIX}-${serviceId}-*`;
}

export function buildIisSiteConfigPath(physicalPath: string): string {
  return join(physicalPath, 'web.config');
}

export class IisManager {
  async inspectBindings(options: IisInspectionOptions = {}): Promise<IisDiagnosticsReport> {
    const snapshot = await this.getIisSnapshot(options);
    return {
      http80: this.buildStatusForBinding({ port: 80, protocol: 'http' }, snapshot),
      https443: this.buildStatusForBinding({ port: 443, protocol: 'https' }, snapshot),
    };
  }

  async inspectService(
    service: Pick<Service, 'port' | 'protocol'>,
    options: IisInspectionOptions = {},
  ): Promise<IisIntegrationStatus> {
    const snapshot = await this.getIisSnapshot(options);
    return this.buildStatusForBinding(service, snapshot);
  }

  async findActiveSite(service: Pick<Service, 'port' | 'protocol'>): Promise<IisSiteInfo | null> {
    if (process.platform !== 'win32' || !shouldUseIisForService(service)) {
      return null;
    }

    let sites: IisSiteInfo[];
    try {
      const snapshot = await this.getIisSnapshot({ allowElevation: true });
      if (snapshot.requiresElevation) {
        return null;
      }
      sites = snapshot.sites;
    } catch (error) {
      if (isIisUnavailableError(error)) {
        return null;
      }
      throw error;
    }

    return sites.find((site) =>
      site.bindings.some((binding) =>
        binding.protocol === service.protocol && bindingUsesPort(binding.bindingInformation, service.port),
      ),
    ) ?? null;
  }

  async getSiteConfigPath(siteName: string, options: IisInspectionOptions = {}): Promise<string> {
    if (process.platform !== 'win32') {
      throw new Error('IIS integration is only available on Windows.');
    }

    const snapshot = await this.getIisSnapshot(options);
    if (snapshot.requiresElevation) {
      throw new Error('Administrator permission is required to inspect the IIS site configuration path.');
    }

    const site = snapshot.sites.find((item) => item.name === siteName);
    if (!site) {
      throw new Error(`IIS site '${siteName}' was not found.`);
    }

    return buildIisSiteConfigPath(site.physicalPath);
  }

  async applyServiceProxy(service: Service, siteName: string, backendPort: number): Promise<IisProxyBinding> {
    if (process.platform !== 'win32') {
      throw new Error('IIS integration is only available on Windows.');
    }

    const patterns = collectIisPatterns(service.endpoints);
    const backendUrl = `http://127.0.0.1:${backendPort}`;
    const patternsLiteral = toPowerShellArrayLiteral(patterns);

    const script = `
$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

function Ensure-XmlElement([xml]$Document, $Parent, [string]$Name) {
  $existing = $Parent.SelectSingleNode($Name)
  if ($null -ne $existing) { return $existing }
  $node = $Document.CreateElement($Name)
  [void]$Parent.AppendChild($node)
  return $node
}

$siteName = '${toPowerShellSingleQuoted(siteName)}'
$serviceId = '${toPowerShellSingleQuoted(service.id)}'
$ruleWildcard = '${toPowerShellSingleQuoted(buildIisRuleWildcard(service.id))}'
$backendUrl = '${toPowerShellSingleQuoted(backendUrl)}'
$patterns = ${patternsLiteral}

$site = Get-Website -Name $siteName -ErrorAction Stop
$rewriteModule = Get-WebGlobalModule -Name 'RewriteModule' -ErrorAction SilentlyContinue
if ($null -eq $rewriteModule) {
  throw 'IIS URL Rewrite is not installed. Install URL Rewrite plus ARR to proxy mokkapi through IIS.'
}

try {
  Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'enabled' -ErrorAction Stop | Out-Null
} catch {
  throw 'IIS Application Request Routing (ARR) proxy support is not available. Install ARR to proxy mokkapi through IIS.'
}

Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'enabled' -Value $true | Out-Null

$physicalPath = [Environment]::ExpandEnvironmentVariables($site.PhysicalPath)
if (-not (Test-Path -LiteralPath $physicalPath)) {
  throw "IIS site '$siteName' points to a missing physical path: $physicalPath"
}

$configPath = Join-Path $physicalPath 'web.config'
if (-not (Test-Path -LiteralPath $configPath)) {
  Set-Content -LiteralPath $configPath -Value '<configuration />' -Encoding UTF8
}

[xml]$document = Get-Content -LiteralPath $configPath -Raw
$configuration = $document.SelectSingleNode('/configuration')
if ($null -eq $configuration) {
  throw "The web.config for IIS site '$siteName' is invalid."
}

$systemWebServer = Ensure-XmlElement $document $configuration 'system.webServer'
$rewrite = Ensure-XmlElement $document $systemWebServer 'rewrite'
$rules = Ensure-XmlElement $document $rewrite 'rules'

@($rules.rule) |
  Where-Object { $_.name -like $ruleWildcard } |
  ForEach-Object { [void]$rules.RemoveChild($_) }

for ($index = $patterns.Count - 1; $index -ge 0; $index--) {
  $rule = $document.CreateElement('rule')
  $rule.SetAttribute('name', '${toPowerShellSingleQuoted(MOKKAPI_RULE_PREFIX)}-' + $serviceId + '-' + $index)
  $rule.SetAttribute('stopProcessing', 'true')

  $match = $document.CreateElement('match')
  $match.SetAttribute('url', $patterns[$index])
  $match.SetAttribute('ignoreCase', 'true')
  [void]$rule.AppendChild($match)

  $action = $document.CreateElement('action')
  $action.SetAttribute('type', 'Rewrite')
  $action.SetAttribute('url', $backendUrl + '/{R:0}')
  $action.SetAttribute('appendQueryString', 'true')
  [void]$rule.AppendChild($action)

  if ($rules.HasChildNodes) {
    [void]$rules.InsertBefore($rule, $rules.FirstChild)
  } else {
    [void]$rules.AppendChild($rule)
  }
}

$document.Save($configPath)

[xml]$verification = Get-Content -LiteralPath $configPath -Raw
$remaining = @($verification.SelectNodes('/configuration/system.webServer/rewrite/rules/rule')) |
  Where-Object { $_.name -like $ruleWildcard }
if ($remaining.Count -ne $patterns.Count) {
  throw "IIS apply verification failed for service '$serviceId'."
}
`;

    await this.runWritableIisScript(script);
    return { siteName, publicPort: service.port };
  }

  async removeServiceProxy(serviceId: string): Promise<void> {
    if (process.platform !== 'win32') {
      return;
    }

    const script = `
$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

$serviceId = '${toPowerShellSingleQuoted(serviceId)}'
$ruleWildcard = '${toPowerShellSingleQuoted(buildIisRuleWildcard(serviceId))}'
$remainingMatches = @()

Get-Website | ForEach-Object {
  $siteName = $_.Name
  $physicalPath = [Environment]::ExpandEnvironmentVariables($_.PhysicalPath)
  if (-not (Test-Path -LiteralPath $physicalPath)) { return }

  $configPath = Join-Path $physicalPath 'web.config'
  if (-not (Test-Path -LiteralPath $configPath)) { return }

  [xml]$document = Get-Content -LiteralPath $configPath -Raw
  $rules = $document.SelectSingleNode('/configuration/system.webServer/rewrite/rules')
  if ($null -eq $rules) { return }

  $changed = $false
  @($rules.rule) |
    Where-Object { $_.name -like $ruleWildcard } |
    ForEach-Object {
      $changed = $true
      [void]$rules.RemoveChild($_)
    }

  if ($changed) {
    $document.Save($configPath)
  }

  [xml]$verification = Get-Content -LiteralPath $configPath -Raw
  $remaining = @($verification.SelectNodes('/configuration/system.webServer/rewrite/rules/rule')) |
    Where-Object { $_.name -like $ruleWildcard }
  if ($remaining.Count -gt 0) {
    $remainingMatches += "${siteName}: ${configPath}"
  }
}

if ($remainingMatches.Count -gt 0) {
  throw "IIS cleanup verification failed for service '$serviceId'. Remaining rules found in: $($remainingMatches -join '; ')"
}
`;

    try {
      await this.runWritableIisScript(script);
    } catch (error) {
      if (isIisUnavailableError(error)) {
        return;
      }
      throw error;
    }
  }

  private buildStatusForBinding(
    service: Pick<Service, 'port' | 'protocol'>,
    snapshot: IisSnapshot,
  ): IisIntegrationStatus {
    if (process.platform !== 'win32' || !shouldUseIisForService(service)) {
      return {
        applicable: false,
        iisInstalled: false,
        requiresElevation: false,
        bindingActive: false,
        siteName: null,
        urlRewriteInstalled: false,
        arrInstalled: false,
        canProxy: false,
        message: null,
      };
    }

    if (snapshot.requiresElevation) {
      return {
        applicable: true,
        iisInstalled: snapshot.iisInstalled,
        requiresElevation: true,
        bindingActive: false,
        siteName: null,
        urlRewriteInstalled: false,
        arrInstalled: false,
        canProxy: false,
        message: 'IIS is installed, but administrator permission is required to inspect active bindings and proxy prerequisites.',
      };
    }

    const activeSite = snapshot.sites.find((site) =>
      site.bindings.some((binding) =>
        binding.protocol === service.protocol && bindingUsesPort(binding.bindingInformation, service.port),
      ),
    ) ?? null;

    return {
      applicable: true,
      iisInstalled: snapshot.iisInstalled,
      requiresElevation: false,
      bindingActive: activeSite !== null,
      siteName: activeSite?.name ?? null,
      urlRewriteInstalled: snapshot.prerequisites.urlRewriteInstalled,
      arrInstalled: snapshot.prerequisites.arrInstalled,
      canProxy: snapshot.prerequisites.urlRewriteInstalled && snapshot.prerequisites.arrInstalled,
      message: activeSite
        ? buildIisPrerequisiteMessage(activeSite.name, snapshot.prerequisites)
        : null,
    };
  }

  private async getIisSnapshot(options: IisInspectionOptions): Promise<IisSnapshot> {
    const iisInstalled = await this.isIisInstalled();
    if (!iisInstalled) {
      return {
        iisInstalled: false,
        requiresElevation: false,
        sites: [],
        prerequisites: EMPTY_PREREQUISITES,
      };
    }

    try {
      return await this.readIisSnapshot(options.allowElevation ?? false);
    } catch (error) {
      if (isIisUnavailableError(error)) {
        return {
          iisInstalled,
          requiresElevation: false,
          sites: [],
          prerequisites: EMPTY_PREREQUISITES,
        };
      }

      if (isIisAccessDeniedError(error) && !options.allowElevation) {
        return {
          iisInstalled,
          requiresElevation: true,
          sites: [],
          prerequisites: EMPTY_PREREQUISITES,
        };
      }

      throw error;
    }
  }

  private async readIisSnapshot(allowElevation: boolean): Promise<IisSnapshot> {
    const script = `
$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

$sites = Get-Website |
  Where-Object { $_.State -eq 'Started' } |
  ForEach-Object {
    [PSCustomObject]@{
      name = $_.Name
      physicalPath = [Environment]::ExpandEnvironmentVariables($_.PhysicalPath)
      bindings = @(
        $_.Bindings.Collection | ForEach-Object {
          [PSCustomObject]@{
            protocol = $_.protocol
            bindingInformation = $_.bindingInformation
          }
        }
      )
    }
  }

$rewriteInstalled = $null -ne (Get-WebGlobalModule -Name 'RewriteModule' -ErrorAction SilentlyContinue)
$arrInstalled = $true
try {
  Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'enabled' -ErrorAction Stop | Out-Null
} catch {
  $arrInstalled = $false
}

[PSCustomObject]@{
  sites = @($sites)
  prerequisites = [PSCustomObject]@{
    urlRewriteInstalled = $rewriteInstalled
    arrInstalled = $arrInstalled
  }
} | ConvertTo-Json -Depth 6
`;

  const stdout = await this.runPowerShellForRead(script, allowElevation);
    if (!stdout) {
      return {
        iisInstalled: true,
        requiresElevation: false,
        sites: [],
        prerequisites: EMPTY_PREREQUISITES,
      };
    }

    const parsed = JSON.parse(stdout) as RawIisSnapshot;
    const sites = Array.isArray(parsed.sites)
      ? parsed.sites
      : parsed.sites
        ? [parsed.sites]
        : [];

    return {
      iisInstalled: true,
      requiresElevation: false,
      sites,
      prerequisites: parsed.prerequisites ?? EMPTY_PREREQUISITES,
    };
  }

  private async isIisInstalled(): Promise<boolean> {
    const windowsDir = process.env['WINDIR'] ?? process.env['windir'] ?? 'C:\\Windows';
    const candidates = [
      join(windowsDir, 'System32', 'inetsrv', 'config', 'applicationHost.config'),
      join(windowsDir, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules', 'WebAdministration', 'WebAdministration.psd1'),
    ];

    for (const candidate of candidates) {
      if (await exists(candidate)) {
        return true;
      }
    }

    return false;
  }

  private async runWritableIisScript(script: string): Promise<void> {
    try {
      await this.runPowerShell(script);
      return;
    } catch (error) {
      if (!shouldRetryElevated(error)) {
        throw normalizeIisError(error);
      }
    }

    try {
      await this.runPowerShellElevated(script);
    } catch (error) {
      throw normalizeIisError(error);
    }
  }

  private async runPowerShellForRead(script: string, allowElevation: boolean): Promise<string> {
    try {
      return await this.runPowerShell(script);
    } catch (error) {
      if (!allowElevation || !isIisAccessDeniedError(error)) {
        throw error;
      }
    }

    return this.runPowerShellElevatedCapture(script);
  }

  private async runPowerShell(script: string): Promise<string> {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true },
    );

    return stdout.trim();
  }

  private async runPowerShellElevatedCapture(script: string): Promise<string> {
    const tempPath = join(
      tmpdir(),
      `mokkapi-iis-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
    );
    const captureScript = `
$ErrorActionPreference = 'Stop'
$result = & {
${script}
} | Out-String
Set-Content -LiteralPath '${toPowerShellSingleQuoted(tempPath)}' -Value $result -Encoding UTF8
`;

    try {
      const encoded = encodePowerShellCommand(captureScript);
      const elevationScript = `
$ErrorActionPreference = 'Stop'
$process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -PassThru -Wait -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', '${encoded}')
if ($process.ExitCode -ne 0) { exit $process.ExitCode }
`;

      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', elevationScript],
        { windowsHide: true },
      );

      return (await readFile(tempPath, 'utf8')).trim();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (/cancelled|canceled|was canceled by the user/i.test(message)) {
        throw new Error('The IIS inspection was canceled.');
      }
      throw error;
    } finally {
      await unlink(tempPath).catch(() => {});
    }
  }

  private async runPowerShellElevated(script: string): Promise<void> {
    const encoded = encodePowerShellCommand(script);
    const elevationScript = `
$ErrorActionPreference = 'Stop'
$process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -PassThru -Wait -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', '${encoded}')
if ($process.ExitCode -ne 0) { exit $process.ExitCode }
`;

    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', elevationScript],
      { windowsHide: true },
    );
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toPowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

function toPowerShellArrayLiteral(values: string[]): string {
  return `@(${values.map((value) => `'${toPowerShellSingleQuoted(value)}'`).join(', ')})`;
}

function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

export function buildIisPrerequisiteMessage(siteName: string, prerequisites: IisProxyPrerequisites): string | null {
  const missing: string[] = [];
  if (!prerequisites.urlRewriteInstalled) missing.push('IIS URL Rewrite');
  if (!prerequisites.arrInstalled) missing.push('Application Request Routing (ARR)');
  if (missing.length === 0) return null;

  return `IIS site '${siteName}' is already active on this binding. Install ${missing.join(' and ')} to publish mokkapi endpoints through IIS.`;
}

export function isIisAccessDeniedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /must have an elevated process|estado elevado|access is denied|permisos insuficientes|redirection\.config|administrator permission is required/i.test(message);
}

function shouldRetryElevated(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /access is denied|unauthorizedaccessexception|requested registry access is not allowed|cannot write configuration file/i.test(message);
}

function normalizeIisError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (/rewrite module/i.test(message)) {
    return new Error('IIS URL Rewrite is required to proxy mokkapi through IIS.');
  }
  if (/arr|proxy support is not available|system\.webServer\/proxy/i.test(message)) {
    return new Error('IIS Application Request Routing (ARR) is required to proxy mokkapi through IIS.');
  }
  if (/cancelled|canceled|was canceled by the user/i.test(message)) {
    return new Error('The IIS configuration change was canceled.');
  }

  return new Error(`IIS configuration failed: ${message}`);
}

export function isIisUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cannot find a provider with the name 'webadministration'|the term 'get-website' is not recognized|no se encuentra ningún proveedor con el nombre 'webadministration'|no se reconoce el término 'get-website'|the specified module 'webadministration' was not loaded/i.test(message);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}