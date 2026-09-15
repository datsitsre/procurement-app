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
