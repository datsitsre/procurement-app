import { z } from 'zod';

export const NewProductSchema = z.object({
  name: z.string().trim().min(1, 'Give the product a name').max(200),
  brand: z.string().trim().max(100),
  sku: z.string().trim().max(100),
  categoryId: z.string().trim().min(1, 'categoryId is required'),
  description: z.string().trim().max(5000),
  currency: z.enum(['GHS', 'NGN', 'KES', 'ZAR', 'XOF', 'USD']),
  basePrice: z.number().positive('Set a base price greater than zero'),
  moq: z.number().int().min(1),
  warehouseId: z.string().trim().min(1, 'warehouseId is required'),
  stock: z.number().int().min(0),
  lowStockThreshold: z.number().int().min(0),
});

export const ProductPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    basePrice: z.number().positive(),
    moq: z.number().int().min(1),
    description: z.string().trim().max(5000),
  })
  .partial();

export const InventoryPatchSchema = z.object({
  warehouseId: z.string().trim().min(1, 'warehouseId is required'),
  stock: z.number().int().min(0).optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
});

export const ModerateProductSchema = z.object({
  decision: z.enum(['PUBLISHED', 'REJECTED']),
  note: z.string().trim().max(1000).optional(),
});

export const VerifySupplierSchema = z.object({
  decision: z.enum(['VERIFIED', 'SUSPENDED', 'REJECTED']),
});

/** A platform administrator creating a new supplier directly (Phase 28, section 10) - the
 *  required fields mirror SupplierProfile's own non-optional columns (prisma/schema.prisma):
 *  name/city/country/description. `currency` is for the supplier's underlying Company row
 *  (required there even though SupplierProfile has no currency field of its own). */
export const NewPlatformSupplierSchema = z.object({
  name: z.string().trim().min(1, 'Give the supplier a name').max(200),
  city: z.string().trim().min(1, 'City is required').max(120),
  country: z.enum(['GH', 'NG', 'KE', 'ZA', 'CI']),
  currency: z.enum(['GHS', 'NGN', 'KES', 'ZAR', 'XOF', 'USD']),
  description: z.string().trim().max(2000).default(''),
  logoUrl: z.string().trim().max(2000).optional(),
  categories: z.array(z.string().trim().max(100)).max(20).optional(),
  certifications: z.array(z.string().trim().max(100)).max(20).optional(),
});

/** A platform administrator editing an existing supplier's profile metadata (Phase 28, section
 *  11) - deliberately excludes `verification`, which keeps its own dedicated route/permission
 *  (VerifySupplierSchema above). */
export const PlatformSupplierUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(120),
    country: z.enum(['GH', 'NG', 'KE', 'ZA', 'CI']),
    description: z.string().trim().max(2000),
    logoUrl: z.string().trim().max(2000),
    categories: z.array(z.string().trim().max(100)).max(20),
    certifications: z.array(z.string().trim().max(100)).max(20),
  })
  .partial();
