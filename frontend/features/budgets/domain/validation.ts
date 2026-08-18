export function validateBudgetInput(input: {
  name?: string;
  amount?: number;
  categoryIds?: string[];
}): string | null {
  if (!input.name?.trim()) return "Name is required";
  if (
    input.amount === undefined ||
    !Number.isFinite(input.amount) ||
    input.amount <= 0
  ) {
    return "Amount must be greater than 0";
  }
  if (!input.categoryIds || input.categoryIds.length === 0) {
    return "Select at least one category";
  }
  return null;
}
