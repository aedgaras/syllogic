export function validateBudgetInput(input: {
  name?: string;
  amount?: number;
}): string | null {
  if (!input.name?.trim()) return "Name is required";
  if (
    input.amount === undefined ||
    !Number.isFinite(input.amount) ||
    input.amount <= 0
  ) {
    return "Amount must be greater than 0";
  }
  return null;
}
