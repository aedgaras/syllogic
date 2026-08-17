import { t as translate } from "@/i18n/translate";
export const ACCOUNT_TYPES = [
  { value: "checking", label: translate("checkingAccount") },
  { value: "savings", label: translate("savingsAccount") },
  { value: "credit_card", label: translate("creditCard") },
  { value: "investment", label: translate("investmentAccount") },
  { value: "cash", label: translate("cash") },
  { value: "other", label: translate("other") },
] as const;

export type AccountTypeValue = (typeof ACCOUNT_TYPES)[number]["value"];
