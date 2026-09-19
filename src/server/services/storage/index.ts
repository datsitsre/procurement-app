import 'server-only';
import { env } from '@/server/env';
import { LocalDiskStorageProvider } from './localDiskStorage';
import { S3StorageProvider } from './s3Storage';
import type { StorageProvider } from './StorageProvider';

export type { StorageProvider } from './StorageProvider';

// Single selection point (mirrors `payment/providers.ts`'s own `env.MTN_MOMO === null ? fallback
// : realGateway` pattern exactly). `env.STORAGE` is null unless every one of STORAGE_BUCKET/
// STORAGE_REGION/STORAGE_ACCESS_KEY_ID/STORAGE_SECRET_ACCESS_KEY is set (see env.ts's
// `optionalS3Storage`) - true in every environment this repo has ever run in, so
// LocalDiskStorageProvider remains what's actually exercised today. Nothing in
// documents.service.ts or any route needs to know or care which one is selected here.
export const storage: StorageProvider = env.STORAGE ? new S3StorageProvider(env.STORAGE) : new LocalDiskStorageProvider();
