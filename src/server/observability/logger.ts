import 'server-only';

/**
 * Lightweight structured logging (section 10/30) - the audit found zero structured logging
 * anywhere in `src/server`. Deliberately not a full logging platform (pino/winston) or an
 * external log shipper - "no huge monitoring platform unless required" (section 34/36). This
 * writes single-line JSON to stdout/stderr, which any standard log aggregator (CloudWatch,
 * Vercel's own log drain, a self-hosted `docker logs`, ...) already knows how to ingest without
 * further configuration.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogFields {
  requestId?: string;
  route?: string;
  method?: string;
  operation?: string;
  durationMs?: number;
  status?: number;
  errorCode?: string;
  userId?: string;
  companyId?: string;
  supplierId?: string;
  [key: string]: unknown;
}

/** Case-insensitive - matched against each field's own key, not its value, so this can't be
 *  defeated by a differently-cased key. Defense in depth: the real safeguard is call sites never
 *  passing these fields in the first place (never log a whole request body or `details` object
 *  wholesale), but this catches the case where one slips through. */
const SENSITIVE_KEY_PATTERN = /password|token|secret|signature|authorization|cookie|card(?:number)?|cvv|pin|apikey|api_key/i;

function redact(fields: LogFields): LogFields {
  const safe: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    safe[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : value;
  }
  return safe;
}

function write(level: LogLevel, message: string, fields: LogFields = {}) {
  const entry = { timestamp: new Date().toISOString(), level, message, ...redact(fields) };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, fields?: LogFields) => write('info', message, fields),
  warn: (message: string, fields?: LogFields) => write('warn', message, fields),
  error: (message: string, fields?: LogFields) => write('error', message, fields),
};
