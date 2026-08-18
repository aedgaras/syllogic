import { z } from "zod";
import { budgetPeriods } from "./contracts";

export const budgetEditSchema = z.object({
  name: z.string().trim().min(1, "Budget name is required"),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  currency: z.string().min(3),
  period: z.enum(budgetPeriods),
  categoryIds: z
    .array(z.string())
    .min(1, "Select at least one category"),
});

export type BudgetEditFormValues = z.infer<typeof budgetEditSchema>;
