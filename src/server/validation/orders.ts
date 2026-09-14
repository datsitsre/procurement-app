import { z } from 'zod';

const PAYMENT_METHODS = ['CARD', 'BANK_TRANSFER', 'MTN_MOMO', 'TELECEL_CASH', 'AIRTELTIGO_MONEY', 'WALLET', 'CREDIT_TERMS'] as const;

export const CheckoutSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
});

export const DispatchOrderSchema = z.object({
  driverName: z.string().trim().max(200).optional(),
});

export const NewDisputeSchema = z.object({
  orderId: z.string().trim().min(1, 'orderId is required'),
  reason: z.string().trim().min(1, 'Give a reason for this dispute').max(200),
  description: z.string().trim().min(1, 'Describe the issue before submitting').max(2000),
});

export const ResolveDisputeSchema = z.object({
  decision: z.enum(['RESOLVED_REFUND', 'RESOLVED_REJECTED']),
  note: z.string().trim().min(1, 'Add a resolution note').max(2000),
});
