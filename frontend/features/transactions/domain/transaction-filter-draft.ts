import { z } from "zod";

export const transactionFilterDraftSchema = z.object({
  search: z.string(),
  minAmount: z.string(),
  maxAmount: z.string(),
});

export type TransactionFilterDraft = z.infer<
  typeof transactionFilterDraftSchema
>;

export type TransactionFilterDraftAction =
  | { type: "sync"; draft: TransactionFilterDraft }
  | { type: "edit"; field: keyof TransactionFilterDraft; value: string };

export function transactionFilterDraftReducer(
  state: TransactionFilterDraft,
  action: TransactionFilterDraftAction,
): TransactionFilterDraft {
  if (action.type === "sync") {
    return state.search === action.draft.search &&
      state.minAmount === action.draft.minAmount &&
      state.maxAmount === action.draft.maxAmount
      ? state
      : action.draft;
  }
  return { ...state, [action.field]: action.value };
}

export function normalizeTransactionFilterDraft(draft: TransactionFilterDraft) {
  const parsed = transactionFilterDraftSchema.parse(draft);
  return {
    search: parsed.search.trim() || undefined,
    minAmount: parsed.minAmount.trim() || undefined,
    maxAmount: parsed.maxAmount.trim() || undefined,
  };
}
