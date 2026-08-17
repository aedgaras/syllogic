import { z } from "zod";

const owners = z.array(z.object({ personId: z.string(), share: z.number().nullable() })).min(1, "Select at least one owner.");
const money = z.string().refine((value) => Number.isFinite(Number(value)), "Enter a valid amount");

export const accountEditSchema = z.object({
  name: z.string().trim().min(1, "Account name is required"),
  accountType: z.string().min(1),
  institution: z.string(),
  currency: z.string().min(3),
  balance: money,
  logoId: z.string().nullable(),
  logoUrl: z.string().nullable(),
  logoUpdatedAt: z.string().nullable(),
  owners,
});

export const propertyEditSchema = z.object({
  name: z.string().trim().min(1, "Property name is required"),
  propertyType: z.string().min(1),
  address: z.string(),
  currentValue: money,
  currency: z.string().min(3),
  owners,
});

export const vehicleEditSchema = z.object({
  name: z.string().trim().min(1, "Vehicle name is required"),
  vehicleType: z.string().min(1),
  make: z.string(),
  model: z.string(),
  year: z.string().refine((value) => !value || /^\d{4}$/.test(value), "Enter a four-digit year"),
  currentValue: money,
  currency: z.string().min(3),
  owners,
});
