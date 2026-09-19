import 'server-only';

/**
 * The abstraction every document upload/download goes through (section 18 - previously
 * schema-only: the `Document` model existed with no route or storage backend behind it, per
 * PHASE19_FINAL_REPORT.md). Modeled on the same shape as `PaymentProvider.ts` in this codebase -
 * one small interface, one concrete implementation selected once, nothing in `documents.service.ts`
 * or any route needs to know which backend is behind it.
 *
 * `key` is always a value this module generates itself (see `localDiskStorage.ts`), never a raw
 * uploaded filename or anything else the caller supplies - see documents.service.ts's own
 * `generateStorageKey`.
 */
export interface StorageProvider {
  store(key: string, data: Buffer): Promise<void>;
  retrieve(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}
