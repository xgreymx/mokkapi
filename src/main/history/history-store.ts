/**
 * HistoryStore — synchronous SQLite wrapper using Node's built-in node:sqlite.
 * All writes are synchronous (SQLite is single-writer anyway), reads are fast
 * because of the index on (service_id, ts DESC).
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { join } from 'path';
import type { HistoryEntry, HistoryFilter, AppSettings } from '../../shared/models';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS requests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           INTEGER NOT NULL,
    service_id   TEXT    NOT NULL,
    endpoint_id  TEXT,
    variant_id   TEXT,
    method       TEXT    NOT NULL,
    path         TEXT    NOT NULL,
    query        TEXT,
    req_headers  TEXT    NOT NULL,
    req_body     BLOB,
    res_status   INTEGER NOT NULL,
    res_headers  TEXT    NOT NULL,
    res_body     BLOB,
    duration_ms  INTEGER NOT NULL,
    remote_addr  TEXT,
    source       TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_requests_svc_ts
    ON requests (service_id, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_requests_ts
    ON requests (ts DESC);
`;

export class HistoryStore {
  private db: DatabaseSync;
  private insertStmt!: StatementSync;

  constructor(workspacePath: string) {
    this.db = new DatabaseSync(join(workspacePath, 'history.sqlite'));
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.init();
  }

  private init(): void {
    this.db.exec(SCHEMA);
    this.insertStmt = this.db.prepare(`
      INSERT INTO requests
        (ts, service_id, endpoint_id, variant_id, method, path, query,
         req_headers, req_body, res_status, res_headers, res_body, duration_ms,
         remote_addr, source)
      VALUES
        (@ts, @service_id, @endpoint_id, @variant_id, @method, @path, @query,
         @req_headers, @req_body, @res_status, @res_headers, @res_body, @duration_ms,
         @remote_addr, @source)
    `);
  }

  close(): void {
    this.db.close();
  }

  // ─── Write ─────────────────────────────────────────────────────────────────

  insert(entry: HistoryEntry): HistoryEntry {
    const result = this.insertStmt.run({
      ts:          entry.ts,
      service_id:  entry.serviceId,
      endpoint_id: entry.endpointId,
      variant_id:  entry.variantId,
      method:      entry.method,
      path:        entry.path,
      query:       entry.query,
      req_headers: JSON.stringify(entry.reqHeaders),
      req_body:    entry.reqBody,
      res_status:  entry.resStatus,
      res_headers: JSON.stringify(entry.resHeaders),
      res_body:    entry.resBody,
      duration_ms: entry.durationMs,
      remote_addr: entry.remoteAddr,
      source:      entry.source ?? null,
    });
    return { ...entry, id: result.lastInsertRowid as number };
  }

  // ─── Read ──────────────────────────────────────────────────────────────────

  query(filter: HistoryFilter = {}): HistoryEntry[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter.serviceId) {
      conditions.push('service_id = @service_id');
      params['service_id'] = filter.serviceId;
    }
    if (filter.method) {
      conditions.push('method = @method');
      params['method'] = filter.method.toUpperCase();
    }
    if (filter.statusMin !== undefined) {
      conditions.push('res_status >= @status_min');
      params['status_min'] = filter.statusMin;
    }
    if (filter.statusMax !== undefined) {
      conditions.push('res_status <= @status_max');
      params['status_max'] = filter.statusMax;
    }
    if (filter.search) {
      conditions.push("(path LIKE @search OR req_body LIKE @search OR res_body LIKE @search)");
      params['search'] = `%${filter.search}%`;
    }
    if (filter.before !== undefined) {
      conditions.push('ts < @before');
      params['before'] = filter.before;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit ?? 200;

    const rows = this.db
      .prepare(`SELECT * FROM requests ${where} ORDER BY ts DESC LIMIT ${limit}`)
      .all(params) as RawRow[];

    return rows.map(rowToEntry);
  }

  // ─── Maintenance ───────────────────────────────────────────────────────────

  clear(serviceId?: string): void {
    if (serviceId) {
      this.db.prepare('DELETE FROM requests WHERE service_id = ?').run(serviceId);
    } else {
      this.db.exec('DELETE FROM requests');
    }
  }

  /** Trim old rows according to retention settings — call on app startup */
  trim(settings: Pick<AppSettings, 'historyRetentionDays' | 'historyRetentionRows'>): void {
    const cutoff = Date.now() - settings.historyRetentionDays * 86_400_000;
    this.db.prepare('DELETE FROM requests WHERE ts < ?').run(cutoff);

    const { count } = this.db
      .prepare('SELECT COUNT(*) as count FROM requests')
      .get() as { count: number };

    if (count > settings.historyRetentionRows) {
      const excess = count - settings.historyRetentionRows;
      this.db
        .prepare('DELETE FROM requests WHERE id IN (SELECT id FROM requests ORDER BY ts ASC LIMIT ?)')
        .run(excess);
    }
  }
}

// ─── Row mapping ──────────────────────────────────────────────────────────────

interface RawRow {
  id: number;
  ts: number;
  service_id: string;
  endpoint_id: string | null;
  variant_id: string | null;
  method: string;
  path: string;
  query: string | null;
  req_headers: string;
  req_body: string | null;
  res_status: number;
  res_headers: string;
  res_body: string | null;
  duration_ms: number;
  remote_addr: string | null;
  source: string | null;
}

function rowToEntry(row: RawRow): HistoryEntry {
  return {
    id:          row.id,
    ts:          row.ts,
    serviceId:   row.service_id,
    endpointId:  row.endpoint_id,
    variantId:   row.variant_id,
    method:      row.method,
    path:        row.path,
    query:       row.query,
    reqHeaders:  safeJson(row.req_headers, {}),
    reqBody:     row.req_body,
    resStatus:   row.res_status,
    resHeaders:  safeJson(row.res_headers, {}),
    resBody:     row.res_body,
    durationMs:  row.duration_ms,
    remoteAddr:  row.remote_addr,
    source:      row.source as HistoryEntry['source'],
  };
}

function safeJson<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; }
  catch { return fallback; }
}
