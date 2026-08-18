import { z } from "zod";
import { budgetPeriods } from "./contracts";

const budgetCategoryInputSchema = z.object({
  categoryId: z.string(),
  subLimit: z.coerce.number().positive().nullable(),
});

export const budgetEditSchema = z.object({
  name: z.string().trim().min(1, "Budget name is required"),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  currency: z.string().min(3),
  period: z.enum(budgetPeriods),
  categories: z.array(budgetCategoryInputSchema),
});

export type BudgetEditFormValues = z.infer<typeof budgetEditSchema>;
