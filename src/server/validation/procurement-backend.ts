import { z } from 'zod';

/** Phase 15 - budgets, purchase templates, recurring purchases (backend completion). */

export const NewBudgetSchema = z.object({
  scope: z.enum(['COMPANY', 'DEPARTMENT', 'COST_CENTER']),
  department: z.string().trim().max(200).optional(),
  costCenterId: z.string().trim().min(1).optional(),
  period: z.enum(['ANNUAL', 'MONTHLY']),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12).optional(),
  amount: z.number().positive('Set a budget amount greater than zero'),
});

export const SetBudgetAlertThresholdsSchema = z.object({
  thresholds: z.array(z.number().int().min(1).max(200)).min(1, 'Set at least one threshold'),
});

const TemplateItemSchema = z.object({
  productId: z.string().trim().min(1),
  productName: z.string().trim().min(1),
  quantity: z.number().int().positive(),
});

export const NewPurchaseTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Give the template a name').max(200),
  items: z.array(TemplateItemSchema).min(1, 'A template needs at least one product'),
});

export const NewRecurringPurchaseSchema = z.object({
  name: z.string().trim().min(1, "Give this recurring purchase a name").max(200),
  items: z.array(TemplateItemSchema).min(1, 'Add at least one product'),
  frequency: z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'CUSTOM']),
  customIntervalDays: z.number().int().min(1).max(365).optional(),
  department: z.string().trim().max(200).optional(),
  costCenterId: z.string().trim().min(1).optional(),
});

export const SetRecurringActiveSchema = z.object({
  active: z.boolean(),
});
