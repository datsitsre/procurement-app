import 'server-only';
import crypto from 'node:crypto';
import { db } from '@/server/db';
import { fail, ok, ownsRecord } from '@/services/base';
import { storage } from '@/server/services/storage';
import type { ServiceResult, TenantContext } from '@/types/common';

/** Real limits, not decorative - a real gateway/proxy would also cap request body size, but this
 *  app has to enforce its own since nothing upstream of it does in this environment. */
export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/** Deliberately small and specific - RFQ/purchase-request attachments are quotes, specs,
 *  certificates, and scanned documents, never executables or scripts. Never derived from the
 *  uploaded filename's own extension (trivially spoofable) - always the browser-reported/sniffed
 *  MIME type, checked against this allowlist. */
export const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export interface DocumentDto {
  id: string;
  ownerType: 'RFQ' | 'PURCHASE_REQUEST';
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

function toDto(doc: { id: string; ownerType: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: Date }): DocumentDto {
  return {
    id: doc.id,
    ownerType: doc.ownerType as DocumentDto['ownerType'],
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    createdAt: doc.createdAt.toISOString(),
  };
}

/** Never trusts the uploaded filename for the storage path (section 10's explicit "do not build
 *  storage keys from arbitrary filenames" rule) - the original filename is kept only as display
 *  metadata (`Document.fileName`), sanitized for safe use in a `Content-Disposition` header. */
function generateStorageKey(): string {
  return crypto.randomUUID();
}

function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'file';
  const cleaned = base.replace(/[^a-zA-Z0-9 ._-]/g, '_').slice(0, 200);
  return cleaned.length > 0 ? cleaned : 'file';
}

function validateUpload(fileName: string, mimeType: string, sizeBytes: number): ServiceResult<true> {
  if (sizeBytes <= 0) return fail('VALIDATION_ERROR', 'The file is empty.');
  if (sizeBytes > MAX_DOCUMENT_SIZE_BYTES) return fail('VALIDATION_ERROR', 'Files must be 10 MB or smaller.');
  if (!ALLOWED_DOCUMENT_MIME_TYPES.has(mimeType)) return fail('VALIDATION_ERROR', 'That file type is not supported.');
  if (!fileName.trim()) return fail('VALIDATION_ERROR', 'A file name is required.');
  return ok(true);
}

export async function uploadRfqDocument(
  rfqId: string,
  tenant: TenantContext,
  uploadedByUserId: string,
  file: { fileName: string; mimeType: string; data: Buffer },
): Promise<ServiceResult<DocumentDto>> {
  const validation = validateUpload(file.fileName, file.mimeType, file.data.byteLength);
  if (!validation.ok) return validation;

  const rfq = await db.rFQ.findUnique({ where: { id: rfqId }, include: { suppliers: true } });
  if (!rfq) return fail('NOT_FOUND', 'That RFQ could not be found.');
  const isInvitedSupplier = rfq.suppliers.some((s) => s.supplierId === tenant.supplierId);
  if (!ownsRecord(tenant, rfq.companyId) && !isInvitedSupplier) return fail('NOT_FOUND', 'That RFQ could not be found.');

  const storageKey = generateStorageKey();
  await storage.store(storageKey, file.data);

  const doc = await db.document.create({
    data: {
      ownerType: 'RFQ',
      rfqId,
      fileName: sanitizeFileName(file.fileName),
      mimeType: file.mimeType,
      sizeBytes: file.data.byteLength,
      storageKey,
      uploadedByUserId,
    },
  });

  return ok(toDto(doc));
}

export async function uploadPurchaseRequestDocument(
  purchaseRequestId: string,
  tenant: TenantContext,
  uploadedByUserId: string,
  file: { fileName: string; mimeType: string; data: Buffer },
): Promise<ServiceResult<DocumentDto>> {
  const validation = validateUpload(file.fileName, file.mimeType, file.data.byteLength);
  if (!validation.ok) return validation;

  const pr = await db.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr) return fail('NOT_FOUND', 'That purchase request could not be found.');
  if (!ownsRecord(tenant, pr.companyId)) return fail('NOT_FOUND', 'That purchase request could not be found.');

  const storageKey = generateStorageKey();
  await storage.store(storageKey, file.data);

  const doc = await db.document.create({
    data: {
      ownerType: 'PURCHASE_REQUEST',
      purchaseRequestId,
      fileName: sanitizeFileName(file.fileName),
      mimeType: file.mimeType,
      sizeBytes: file.data.byteLength,
      storageKey,
      uploadedByUserId,
    },
  });

  return ok(toDto(doc));
}

/** Shared tenant check for both download and delete - a document's real owner is whichever of
 *  `rfq`/`purchaseRequest` it's actually linked to (never both), matching the schema's own
 *  nullable-FK-per-ownerType shape. */
async function findAuthorizedDocument(documentId: string, tenant: TenantContext) {
  const doc = await db.document.findUnique({
    where: { id: documentId },
    include: { rfq: { include: { suppliers: true } }, purchaseRequest: true },
  });
  if (!doc) return null;

  if (doc.rfq) {
    const isInvitedSupplier = doc.rfq.suppliers.some((s) => s.supplierId === tenant.supplierId);
    if (!ownsRecord(tenant, doc.rfq.companyId) && !isInvitedSupplier) return null;
  } else if (doc.purchaseRequest) {
    if (!ownsRecord(tenant, doc.purchaseRequest.companyId)) return null;
  } else {
    // A Document row with neither FK set can't belong to anyone's tenant - fail closed.
    return null;
  }

  return doc;
}

export async function getDocumentForDownload(
  documentId: string,
  tenant: TenantContext,
): Promise<ServiceResult<{ fileName: string; mimeType: string; data: Buffer }>> {
  const doc = await findAuthorizedDocument(documentId, tenant);
  if (!doc) return fail('NOT_FOUND', 'That document could not be found.');

  const data = await storage.retrieve(doc.storageKey);
  if (!data) return fail('NOT_FOUND', 'That document could not be found.');

  return ok({ fileName: doc.fileName, mimeType: doc.mimeType, data });
}

export async function deleteDocument(documentId: string, tenant: TenantContext): Promise<ServiceResult<true>> {
  const doc = await findAuthorizedDocument(documentId, tenant);
  if (!doc) return fail('NOT_FOUND', 'That document could not be found.');

  await storage.delete(doc.storageKey);
  await db.document.delete({ where: { id: doc.id } });
  return ok(true);
}
