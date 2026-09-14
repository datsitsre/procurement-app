import { z } from 'zod';

/** The company settings form always submits every field, even ones left blank (matching the
 *  mock's original behavior of saving the whole `CompanyProfilePatch` object as-is) - so
 *  optional fields must tolerate an empty string, not just being absent. `email` is the only
 *  field with a format constraint, and that constraint only applies once there's a value. */
export const CompanyProfilePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    legalName: z.string().trim().max(200),
    registrationNumber: z.string().trim().max(100),
    taxId: z.string().trim().max(100),
    industry: z.string().trim().max(100),
    website: z.string().trim().max(300),
    phone: z.string().trim().max(50),
    email: z
      .string()
      .trim()
      .max(254)
      .refine((v) => v === '' || z.string().email().safeParse(v).success, 'Enter a valid email address'),
    description: z.string().trim().max(2000),
  })
  .partial();

export const NewDepartmentSchema = z.object({
  name: z.string().trim().min(1, 'Give the department a name').max(200),
});

export const NewCostCenterSchema = z.object({
  code: z.string().trim().min(1, 'Give the cost center a code').max(50),
  name: z.string().trim().min(1, 'Give the cost center a name').max(200),
  departmentId: z.string().trim().min(1).optional(),
});

export const NewBranchSchema = z.object({
  name: z.string().trim().min(1, 'Give the branch a name').max(200),
  addressId: z.string().trim().min(1, 'addressId is required'),
  contactName: z.string().trim().max(200).optional(),
  contactPhone: z.string().trim().max(50).optional(),
  costCenterId: z.string().trim().min(1).optional(),
  isWarehouse: z.boolean(),
});

export const SetSpendingLimitSchema = z.object({
  amount: z.number().min(0, 'Set a spending limit of zero or more'),
});
