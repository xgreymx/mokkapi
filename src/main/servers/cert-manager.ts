/**
 * CertManager — generates a local CA and per-service TLS certificates
 * using node-forge (pure JS, no OpenSSL required).
 *
 * Certificates are stored at:
 *   <workspace>/certs/ca.crt + ca.key
 *   <workspace>/certs/<serviceId>.crt + <serviceId>.key
 */

import forge from 'node-forge';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, access } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { promisify } from 'node:util';
import type { CaTrustStatus, TlsConfig } from '../../shared/models';

const CA_VALIDITY_YEARS = 10;
const CERT_VALIDITY_YEARS = 2;
const LINUX_CA_FILENAME = 'mokkapi-local-ca.crt';
const execFileAsync = promisify(execFile);

interface LinuxCaInstaller {
  supported: boolean;
  storeLabel: string;
  installPath: string | null;
  manualInstallCommand: string;
  unsupportedMessage: string;
  shellScript: string | null;
}

export interface TlsCredentials {
  cert: string; // PEM
  key: string;  // PEM
}

export class CertManager {
  private caCredentials: TlsCredentials | null = null;

  constructor(private readonly certsDir: string) {}

  // ─── CA ────────────────────────────────────────────────────────────────────

  async getOrCreateCa(): Promise<TlsCredentials> {
    if (this.caCredentials) return this.caCredentials;

    const certPath = join(this.certsDir, 'ca.crt');
    const keyPath  = join(this.certsDir, 'ca.key');

    if (await exists(certPath) && await exists(keyPath)) {
      this.caCredentials = {
        cert: await readFile(certPath, 'utf-8'),
        key:  await readFile(keyPath,  'utf-8'),
      };
      return this.caCredentials;
    }

    return this.generateCa();
  }

  async generateCa(): Promise<TlsCredentials> {
    const { cert, key } = generateSelfSignedCa('mokkapi Local CA');
    const certPath = join(this.certsDir, 'ca.crt');
    const keyPath  = join(this.certsDir, 'ca.key');
    await writeFile(certPath, cert, 'utf-8');
    await writeFile(keyPath,  key,  'utf-8');
    this.caCredentials = { cert, key };
    console.log(`[CertManager] CA generated at ${certPath}`);
    return this.caCredentials;
  }

  getCaPath(): string {
    return join(this.certsDir, 'ca.crt');
  }

  async getCaTrustStatus(): Promise<CaTrustStatus> {
    const caPath = this.getCaPath();
    const ca = await this.getOrCreateCa();

    switch (process.platform) {
      case 'win32':
        return this.getWindowsCaTrustStatus(ca.cert, caPath);
      case 'darwin':
        return this.getMacCaTrustStatus(ca.cert, caPath);
      case 'linux':
        return this.getLinuxCaTrustStatus(ca.cert, caPath);
      default:
        return {
          platform: process.platform,
          supported: false,
          installed: false,
          caPath,
          thumbprint: null,
          storeLabel: 'Manual trust',
          message: 'Automatic CA installation is not available on this platform.',
          manualInstallLabel: 'Manual trust:',
          manualInstallCommand: caPath,
        };
    }
  }

  async installCa(): Promise<CaTrustStatus> {
    const current = await this.getCaTrustStatus();
    if (!current.supported) {
      throw new Error(current.message);
    }
    if (current.installed) {
      return current;
    }

    switch (process.platform) {
      case 'win32':
        await this.installCaOnWindows(current.caPath);
        break;
      case 'darwin':
        await this.installCaOnMac(current.caPath);
        break;
      case 'linux':
        await this.installCaOnLinux(current.caPath);
        break;
      default:
        throw new Error('Automatic CA installation is not available on this platform.');
    }

    const refreshed = await this.getCaTrustStatus();
    if (!refreshed.installed) {
      throw new Error('The CA could not be verified after installation.');
    }
    return refreshed;
  }

  // ─── Per-service certificates ──────────────────────────────────────────────

  async getOrCreateServiceCert(
    serviceId: string,
    additionalHosts: string[] = [],
  ): Promise<TlsCredentials> {
    const certPath = join(this.certsDir, `${serviceId}.crt`);
    const keyPath  = join(this.certsDir, `${serviceId}.key`);

    if (await exists(certPath) && await exists(keyPath)) {
      return {
        cert: await readFile(certPath, 'utf-8'),
        key:  await readFile(keyPath,  'utf-8'),
      };
    }

    return this.generateServiceCert(serviceId, additionalHosts);
  }

  async generateServiceCert(
    serviceId: string,
    additionalHosts: string[] = [],
  ): Promise<TlsCredentials> {
    const ca = await this.getOrCreateCa();
    const { cert, key } = signCertificate(serviceId, additionalHosts, ca);
    const certPath = join(this.certsDir, `${serviceId}.crt`);
    const keyPath  = join(this.certsDir, `${serviceId}.key`);
    await writeFile(certPath, cert, 'utf-8');
    await writeFile(keyPath,  key,  'utf-8');
    return { cert, key };
  }

  /** Resolve TLS credentials based on the service's TLS config */
  async resolveTls(serviceId: string, tlsConfig: TlsConfig): Promise<TlsCredentials> {
    if (tlsConfig.mode === 'byo' && tlsConfig.certPath && tlsConfig.keyPath) {
      return {
        cert: await readFile(tlsConfig.certPath, 'utf-8'),
        key:  await readFile(tlsConfig.keyPath,  'utf-8'),
      };
    }
    return this.getOrCreateServiceCert(serviceId, tlsConfig.additionalHosts);
  }

  private async getWindowsCaTrustStatus(certPem: string, caPath: string): Promise<CaTrustStatus> {
    const thumbprint = getCertificateFingerprint(certPem, 'sha1');
    const installed = await this.commandOutputHasFingerprint('certutil.exe', ['-user', '-store', 'Root'], thumbprint)
      || await this.commandOutputHasFingerprint('certutil.exe', ['-store', 'Root'], thumbprint);

    return {
      platform: 'win32',
      supported: true,
      installed,
      caPath,
      thumbprint,
      storeLabel: 'Windows Root stores',
      message: installed
        ? 'The current mokkapi CA is trusted on this machine.'
        : 'The current mokkapi CA is not trusted yet. Install it before using HTTPS services.',
      manualInstallLabel: 'Windows (PowerShell or Command Prompt as admin):',
      manualInstallCommand: `certutil -addstore Root "${caPath}"`,
    };
  }

  private async installCaOnWindows(caPath: string): Promise<void> {
    try {
      await this.runPowerShell(`
$ErrorActionPreference = 'Stop'
$process = Start-Process -FilePath 'certutil.exe' -Verb RunAs -WindowStyle Hidden -PassThru -Wait -ArgumentList @('-addstore', 'Root', '${toPowerShellSingleQuoted(caPath)}')
if ($process.ExitCode -ne 0) { exit $process.ExitCode }
`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (/cancelled|canceled|was canceled by the user/i.test(message)) {
        throw new Error('Certificate installation was canceled.');
      }
      throw new Error(`Certificate installation failed: ${message}`);
    }
  }

  private async getMacCaTrustStatus(certPem: string, caPath: string): Promise<CaTrustStatus> {
    const thumbprint = getCertificateFingerprint(certPem, 'sha256');
    const keychains = [
      '/Library/Keychains/System.keychain',
      join(homedir(), 'Library/Keychains/login.keychain-db'),
    ];

    let installed = false;
    for (const keychain of keychains) {
      if (!await exists(keychain)) continue;
      if (await this.commandOutputHasFingerprint('security', ['find-certificate', '-a', '-Z', '-c', 'mokkapi Local CA', keychain], thumbprint)) {
        installed = true;
        break;
      }
    }

    return {
      platform: 'darwin',
      supported: true,
      installed,
      caPath,
      thumbprint,
      storeLabel: 'macOS keychains',
      message: installed
        ? 'The current mokkapi CA is trusted on this machine.'
        : 'The current mokkapi CA is not trusted yet. Install it before using HTTPS services.',
      manualInstallLabel: 'macOS (Terminal with admin privileges):',
      manualInstallCommand: `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ${quotePosix(caPath)}`,
    };
  }

  private async installCaOnMac(caPath: string): Promise<void> {
    try {
      await execFileAsync('osascript', [
        '-e', 'on run argv',
        '-e', 'set certPath to item 1 of argv',
        '-e', 'do shell script "/usr/bin/security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain " & quoted form of certPath with administrator privileges',
        '-e', 'end run',
        caPath,
      ]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (/cancelled|canceled|user canceled/i.test(message)) {
        throw new Error('Certificate installation was canceled.');
      }
      throw new Error(`Certificate installation failed: ${message}`);
    }
  }

  private async getLinuxCaTrustStatus(certPem: string, caPath: string): Promise<CaTrustStatus> {
    const thumbprint = getCertificateFingerprint(certPem, 'sha256');
    const installer = await this.getLinuxInstaller(caPath);
    const installed = installer.installPath
      ? await fileHasCertificateFingerprint(installer.installPath, thumbprint, 'sha256')
      : false;

    return {
      platform: 'linux',
      supported: installer.supported,
      installed,
      caPath,
      thumbprint,
      storeLabel: installer.storeLabel,
      message: installed
        ? 'The current mokkapi CA is trusted on this machine.'
        : installer.supported
          ? 'The current mokkapi CA is not trusted yet. Install it before using HTTPS services.'
          : installer.unsupportedMessage,
      manualInstallLabel: 'Linux (shell with sudo):',
      manualInstallCommand: installer.manualInstallCommand,
    };
  }

  private async installCaOnLinux(caPath: string): Promise<void> {
    const installer = await this.getLinuxInstaller(caPath);
    if (!installer.supported || !installer.shellScript) {
      throw new Error(installer.unsupportedMessage);
    }

    const shell = await getPreferredPosixShell();

    try {
      await execFileAsync('pkexec', [shell, '-lc', installer.shellScript, shell, caPath]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (/cancelled|canceled|not authorized|authorization failed/i.test(message)) {
        throw new Error('Certificate installation was canceled.');
      }
      throw new Error(`Certificate installation failed: ${message}`);
    }
  }

  private async getLinuxInstaller(caPath: string): Promise<LinuxCaInstaller> {
    const hasPkexec = await commandExists('pkexec');

    if (await commandExists('update-ca-certificates')) {
      const installPath = `/usr/local/share/ca-certificates/${LINUX_CA_FILENAME}`;
      return {
        supported: hasPkexec,
        storeLabel: 'Linux CA bundle (/usr/local/share/ca-certificates)',
        installPath,
        manualInstallCommand: `sudo install -Dm644 ${quotePosix(caPath)} ${quotePosix(installPath)} && sudo update-ca-certificates`,
        unsupportedMessage: hasPkexec
          ? 'The current mokkapi CA is not trusted yet.'
          : 'Automatic installation requires pkexec on this Linux system. Use the manual command below.',
        shellScript: `install -Dm644 "$1" "${installPath}" && update-ca-certificates`,
      };
    }

    if (await commandExists('update-ca-trust')) {
      const installPath = `/etc/pki/ca-trust/source/anchors/${LINUX_CA_FILENAME}`;
      return {
        supported: hasPkexec,
        storeLabel: 'Linux CA trust anchors (/etc/pki/ca-trust/source/anchors)',
        installPath,
        manualInstallCommand: `sudo install -Dm644 ${quotePosix(caPath)} ${quotePosix(installPath)} && sudo update-ca-trust extract`,
        unsupportedMessage: hasPkexec
          ? 'The current mokkapi CA is not trusted yet.'
          : 'Automatic installation requires pkexec on this Linux system. Use the manual command below.',
        shellScript: `install -Dm644 "$1" "${installPath}" && update-ca-trust extract`,
      };
    }

    return {
      supported: false,
      storeLabel: 'Linux certificate store',
      installPath: null,
      manualInstallCommand: `# Install ${quotePosix(caPath)} using your distribution's CA trust tool`,
      unsupportedMessage: 'Automatic installation is not available on this Linux distribution. Use the manual command below or your distribution CA trust tool.',
      shellScript: null,
    };
  }

  private async runPowerShell(script: string): Promise<string> {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true },
    );

    return stdout.trim();
  }

  private async commandOutputHasFingerprint(file: string, args: string[], fingerprint: string): Promise<boolean> {
    try {
      const { stdout, stderr } = await execFileAsync(file, args, { windowsHide: true });
      return normalizeFingerprint(`${stdout}\n${stderr}`).includes(normalizeFingerprint(fingerprint));
    } catch {
      return false;
    }
  }
}

// ─── Crypto helpers ────────────────────────────────────────────────────────────

function generateSelfSignedCa(commonName: string): TlsCredentials {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomSerial();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = yearsFromNow(CA_VALIDITY_YEARS);

  const attrs = [
    { name: 'commonName', value: commonName },
    { name: 'organizationName', value: 'mokkapi' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  return {
    cert: forge.pki.certificateToPem(cert),
    key:  forge.pki.privateKeyToPem(keys.privateKey),
  };
}

function signCertificate(
  cn: string,
  extraHosts: string[],
  ca: TlsCredentials,
): TlsCredentials {
  const caCert = forge.pki.certificateFromPem(ca.cert);
  const caKey  = forge.pki.privateKeyFromPem(ca.key);

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomSerial();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = yearsFromNow(CERT_VALIDITY_YEARS);

  const subjectAttrs = [
    { name: 'commonName', value: cn },
    { name: 'organizationName', value: 'mokkapi' },
  ];
  cert.setSubject(subjectAttrs);
  cert.setIssuer(caCert.subject.attributes);

  const altNames = [
    { type: 2, value: 'localhost' },      // DNS
    { type: 7, ip: '127.0.0.1' },        // IP
    { type: 7, ip: '::1' },
    ...extraHosts.map((h) => ({ type: 2, value: h })),
  ];

  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames },
    { name: 'subjectKeyIdentifier' },
  ]);

  cert.sign(caKey, forge.md.sha256.create());

  return {
    cert: forge.pki.certificateToPem(cert),
    key:  forge.pki.privateKeyToPem(keys.privateKey),
  };
}

function randomSerial(): string {
  return Math.floor(Math.random() * 1e16).toString(16);
}

function getCertificateFingerprint(certPem: string, algorithm: 'sha1' | 'sha256'): string {
  const cert = forge.pki.certificateFromPem(certPem);
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return createHash(algorithm)
    .update(Buffer.from(der, 'binary'))
    .digest('hex')
    .toUpperCase();
}

function toPowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

function normalizeFingerprint(value: string): string {
  return value.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
}

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function yearsFromNow(years: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d;
}

async function commandExists(command: string): Promise<boolean> {
  const shell = await getPreferredPosixShell();
  try {
    await execFileAsync(shell, ['-lc', `command -v ${command} >/dev/null 2>&1`]);
    return true;
  } catch {
    return false;
  }
}

async function getPreferredPosixShell(): Promise<string> {
  return await exists('/bin/bash') ? '/bin/bash' : '/bin/sh';
}

async function fileHasCertificateFingerprint(
  filePath: string,
  fingerprint: string,
  algorithm: 'sha1' | 'sha256',
): Promise<boolean> {
  if (!await exists(filePath)) return false;

  try {
    const certPem = await readFile(filePath, 'utf-8');
    return getCertificateFingerprint(certPem, algorithm) === normalizeFingerprint(fingerprint);
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
