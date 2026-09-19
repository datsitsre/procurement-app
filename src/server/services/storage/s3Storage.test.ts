import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase 21, Objective C - adapter-level tests for `S3StorageProvider`. No real bucket/credentials
 * exist anywhere in this environment (see s3Storage.ts's own comment), so `S3Client.send` is
 * mocked - this verifies the provider builds the right command for each operation and maps the
 * SDK's own "not found" shape onto this codebase's `null` contract, not a real S3 round-trip.
 * Classified `PROVIDER ADAPTER TEST`, not `REAL SANDBOX ROUND-TRIP`, matching the same distinction
 * Phase 20 already established for the payment gateway adapter tests.
 */

const sendMock = vi.fn();

vi.mock('@aws-sdk/client-s3', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/client-s3')>('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: vi.fn().mockImplementation(() => ({ send: sendMock })),
  };
});

const { S3StorageProvider } = await import('./s3Storage');
const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');

const CONFIG = {
  bucket: 'test-bucket',
  region: 'auto',
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-key',
  endpoint: 'https://s3.example.test',
};

describe('S3StorageProvider', () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it('store() sends a PutObjectCommand with the exact bucket/key/body', async () => {
    sendMock.mockResolvedValueOnce({});
    const provider = new S3StorageProvider(CONFIG);
    const data = Buffer.from('real file bytes');

    await provider.store('doc-key-1', data);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({ Bucket: 'test-bucket', Key: 'doc-key-1', ContentLength: data.byteLength });
    expect(command.input.Body).toBe(data);
  });

  it('retrieve() sends a GetObjectCommand and returns the real bytes as a Buffer', async () => {
    const bytes = new TextEncoder().encode('downloaded bytes');
    sendMock.mockResolvedValueOnce({ Body: { transformToByteArray: async () => bytes } });
    const provider = new S3StorageProvider(CONFIG);

    const result = await provider.retrieve('doc-key-2');

    const command = sendMock.mock.calls[0][0];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toMatchObject({ Bucket: 'test-bucket', Key: 'doc-key-2' });
    expect(result?.toString()).toBe('downloaded bytes');
  });

  it('retrieve() returns null (never throws) when the SDK reports the object does not exist', async () => {
    const notFound = new Error('The specified key does not exist.');
    notFound.name = 'NoSuchKey';
    sendMock.mockRejectedValueOnce(notFound);
    const provider = new S3StorageProvider(CONFIG);

    const result = await provider.retrieve('does-not-exist');
    expect(result).toBeNull();
  });

  it('retrieve() re-throws a genuine transport/auth error rather than masking it as "not found"', async () => {
    sendMock.mockRejectedValueOnce(new Error('Network timeout'));
    const provider = new S3StorageProvider(CONFIG);

    await expect(provider.retrieve('doc-key-3')).rejects.toThrow('Network timeout');
  });

  it('delete() sends a DeleteObjectCommand with the exact bucket/key', async () => {
    sendMock.mockResolvedValueOnce({});
    const provider = new S3StorageProvider(CONFIG);

    await provider.delete('doc-key-4');

    const command = sendMock.mock.calls[0][0];
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toMatchObject({ Bucket: 'test-bucket', Key: 'doc-key-4' });
  });
});
