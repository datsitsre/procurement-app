import 'server-only';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { S3StorageEnv } from '@/server/env';
import type { StorageProvider } from './StorageProvider';

/**
 * S3-compatible object storage (Phase 21). The production counterpart to
 * `LocalDiskStorageProvider` - selected instead of it once `env.STORAGE` is configured (see
 * `index.ts`). Uses the official AWS SDK v3 `S3Client` with `endpoint` left unset for real AWS S3
 * or pointed at any S3-compatible provider (Cloudflare R2, DigitalOcean Spaces, MinIO, Backblaze
 * B2, ...) - the actual requirement per the brief is "S3-compatible", not "AWS-only", and every
 * one of those providers implements the same `PutObject`/`GetObject`/`DeleteObject` API surface
 * this file uses.
 *
 * No real bucket/credentials exist anywhere in this environment or repository, so this has never
 * been exercised against a real S3-compatible endpoint - see `PHASE21_FINAL_REPORT.md`'s Object
 * Storage section for the exact classification. What IS verified: `s3Storage.test.ts` mocks
 * `S3Client.send` and asserts this class builds the exact right command (bucket, key, body,
 * content length) for `store`/`retrieve`/`delete`, and that `retrieve` returns `null` (matching
 * `LocalDiskStorageProvider`'s own contract) rather than throwing when the SDK reports the object
 * doesn't exist - real, but adapter-level, verification, not a production round-trip.
 */
export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3StorageEnv) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      // Required by most non-AWS S3-compatible providers (MinIO, R2, Spaces, ...), which serve
      // buckets at `<endpoint>/<bucket>/<key>` rather than AWS's own `<bucket>.<endpoint>/<key>`
      // virtual-hosted-style default. Harmless for real AWS S3 too.
      forcePathStyle: Boolean(config.endpoint),
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async store(key: string, data: Buffer): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentLength: data.byteLength }));
  }

  async retrieve(key: string): Promise<Buffer | null> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!result.Body) return null;
      const bytes = await result.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (error) {
      // The SDK throws a `NoSuchKey`-named error for a missing object - matching
      // LocalDiskStorageProvider's own "not found -> null, never throw" contract, so
      // documents.service.ts doesn't need to know or care which backend is behind it.
      if (error instanceof Error && error.name === 'NoSuchKey') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
