/**
 * CertManager — generates a local CA and per-service TLS certificates
 * using node-forge (pure JS, no OpenSSL required).
 *
 * Certificates are stored at:
 *   <workspace>/certs/ca.crt + ca.key
 *   <workspace>/certs/<serviceId>.crt + <serviceId>.key
 */

import forge from 'node-forge';
import { readFile, writeFile, access } from 'fs/promises';
import { join } from 'path';
import type { TlsConfig } from '../../shared/models';

const CA_VALIDITY_YEARS = 10;
const CERT_VALIDITY_YEARS = 2;

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

function yearsFromNow(years: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
