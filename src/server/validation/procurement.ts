import { z } from 'zod';

export const NewRfqSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        productName: z.string().trim().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1, 'Add at least one product to the RFQ'),
  requiredDeliveryDate: z.string().trim().min(1, 'requiredDeliveryDate is required'),
  deliveryLocation: z.string().trim().min(1, 'Delivery location is required'),
  additionalRequirements: z.string().trim().max(2000).optional(),
  supplierIds: z.array(z.string().trim().min(1)).min(1, 'Invite at least one supplier'),
});

export const SubmitQuoteSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        quantity: z.number().int().positive(),
        unitPrice: z.number().positive(),
      }),
    )
    .min(1, 'Quote at least one item'),
  deliveryDays: z.number().int().min(0),
  warrantyMonths: z.number().int().min(0),
  notes: z.string().trim().max(2000).optional(),
});

export const SendNegotiationMessageSchema = z.object({
  message: z.string().trim().min(1, 'Write a message before sending'),
  proposedPrice: z.number().positive().optional(),
  proposedQuantity: z.number().int().positive().optional(),
});

export const NewPurchaseRequestSchema = z.object({
  department: z.string().trim().max(200).optional(),
  costCenterId: z.string().trim().min(1).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        productName: z.string().trim().min(1),
        supplierId: z.string().trim().min(1),
        supplierName: z.string().trim().min(1),
        quantity: z.number().int().positive(),
        unitPrice: z.number().positive(),
      }),
    )
    .min(1, 'Your cart is empty'),
  reason: z.string().trim().min(1, 'Give a reason for this request').max(2000),
});

export const DecideStepSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().trim().max(2000).optional(),
});

export const NewApprovalRuleSchema = z.object({
  minAmount: z.number().min(0, 'The minimum amount cannot be negative'),
  maxAmount: z.number().positive().optional(),
  requiredApproverRoles: z.array(z.string().trim().min(1)).min(1, 'Pick at least one approver role'),
});
