import { t as translate } from "@/i18n/translate";
import { CATEGORY_COLORS } from "./colors";

export type CategoryType = "expense" | "income" | "transfer";

export interface DefaultCategory {
  name: string;
  categoryType: CategoryType;
  color: string;
  icon: string;
  description?: string;
  isSystem?: boolean;
  hideFromSelection?: boolean;
  key?: string;
  /** Marks a category that only exists to gather other categories under it. */
  isGroup?: boolean;
  /** `key` of the group this category belongs to. */
  groupKey?: string;
}

/**
 * Category groups ("sections"): Needs / Wants / Savings, Investments / Income.
 * They are never selectable on a transaction - they only gather categories of
 * the same category type, one level deep.
 */
export const DEFAULT_CATEGORY_GROUPS: DefaultCategory[] = [
  {
    name: translate("categoryGroupNeeds"),
    categoryType: "expense",
    color: CATEGORY_COLORS[5].value, // Teal
    icon: "RiShieldCheckLine",
    description: translate("essentialSpendingYouCannotEasilyGoWithout"),
    isSystem: true,
    hideFromSelection: true,
    isGroup: true,
    key: "group_needs",
  },
  {
    name: translate("categoryGroupWants"),
    categoryType: "expense",
    color: CATEGORY_COLORS[4].value, // Purple
    icon: "RiSparklingLine",
    description: translate("discretionarySpendingYouChooseToMake"),
    isSystem: true,
    hideFromSelection: true,
    isGroup: true,
    key: "group_wants",
  },
  {
    name: translate("categoryGroupSavings"),
    categoryType: "transfer",
    color: CATEGORY_COLORS[2].value, // Green
    icon: "RiSafe2Line",
    description: translate("moneyYouMoveIntoSavingsAndInvestmentAccounts"),
    isSystem: true,
    hideFromSelection: true,
    isGroup: true,
    key: "group_savings",
  },
  {
    name: translate("categoryGroupIncome"),
    categoryType: "income",
    color: CATEGORY_COLORS[8].value, // Emerald
    icon: "RiMoneyEuroBoxLine",
    description: translate("moneyComingIn"),
    isSystem: true,
    hideFromSelection: true,
    isGroup: true,
    key: "group_income",
  },
];

export const DEFAULT_EXPENSE_CATEGORIES: DefaultCategory[] = [
  {
    name: translate("foodDining"),
    categoryType: "expense",
    color: CATEGORY_COLORS[0].value, // Amber
    icon: "RiRestaurantLine",
    description: translate("restaurantsFoodDeliveryCafes"),
    groupKey: "group_wants",
  },
  {
    name: translate("groceries"),
    categoryType: "expense",
    color: CATEGORY_COLORS[8].value, // Emerald
    icon: "RiShoppingCartLine",
    description: translate("supermarketsGroceryStoresHouseholdEssentials"),
    groupKey: "group_needs",
  },
  {
    name: translate("transportation"),
    categoryType: "expense",
    color: CATEGORY_COLORS[1].value, // Blue
    icon: "RiCarLine",
    description: translate("fuelPublicTransitParkingRideSharing"),
    groupKey: "group_needs",
  },
  {
    name: translate("shopping"),
    categoryType: "expense",
    color: CATEGORY_COLORS[6].value, // Pink
    icon: "RiShoppingBagLine",
    description: translate("clothingElectronicsGeneralPurchases"),
    groupKey: "group_wants",
  },
  {
    name: translate("entertainment"),
    categoryType: "expense",
    color: CATEGORY_COLORS[4].value, // Purple
    icon: "RiGamepadLine",
    description: translate("moviesGamesConcertsStreamingServices"),
    groupKey: "group_wants",
  },
  {
    name: translate("billsUtilities"),
    categoryType: "expense",
    color: CATEGORY_COLORS[9].value, // Slate
    icon: "RiFileTextLine",
    description: translate("electricityWaterInternetPhone"),
    groupKey: "group_needs",
  },
  {
    name: translate("healthFitness"),
    categoryType: "expense",
    color: CATEGORY_COLORS[2].value, // Green
    icon: "RiHeartPulseLine",
    description: translate("gymMedicalExpensesPharmacy"),
    groupKey: "group_needs",
  },
  {
    name: translate("housing"),
    categoryType: "expense",
    color: CATEGORY_COLORS[10].value, // Stone
    icon: "RiHome4Line",
    description: translate("rentMortgageHomeMaintenance"),
    groupKey: "group_needs",
  },
  {
    name: translate("education"),
    categoryType: "expense",
    color: CATEGORY_COLORS[7].value, // Indigo
    icon: "RiBookOpenLine",
    description: translate("coursesBooksTuitionTraining"),
    groupKey: "group_needs",
  },
  {
    name: translate("travel"),
    categoryType: "expense",
    color: CATEGORY_COLORS[5].value, // Teal
    icon: "RiPlaneLine",
    description: translate("hotelsFlightsVacationExpenses"),
    groupKey: "group_wants",
  },
  {
    name: translate("personalCare"),
    categoryType: "expense",
    color: CATEGORY_COLORS[8].value, // Emerald
    icon: "RiUser3Line",
    description: translate("haircutsSpaPersonalHygiene"),
    groupKey: "group_wants",
  },
  {
    name: translate("giftsDonations"),
    categoryType: "expense",
    color: CATEGORY_COLORS[3].value, // Red
    icon: "RiGiftLine",
    description: translate("presentsCharityDonations"),
    groupKey: "group_wants",
  },
  {
    name: translate("otherExpenses"),
    categoryType: "expense",
    color: CATEGORY_COLORS[11].value, // Zinc
    icon: "RiMore2Line",
    description: translate("miscellaneousExpenses"),
  },
];

export const DEFAULT_INCOME_CATEGORIES: DefaultCategory[] = [
  {
    name: translate("salary"),
    categoryType: "income",
    color: CATEGORY_COLORS[2].value, // Green
    icon: "RiBriefcaseLine",
    description: translate("regularEmploymentIncome"),
    groupKey: "group_income",
  },
  {
    name: translate("otherIncome"),
    categoryType: "income",
    color: CATEGORY_COLORS[9].value, // Slate
    icon: "RiAddCircleLine",
    description: translate("miscellaneousIncome"),
    groupKey: "group_income",
  },
  {
    name: translate("refunds"),
    categoryType: "income",
    color: CATEGORY_COLORS[1].value, // Blue
    icon: "RiArrowGoBackLine",
    description: translate("refundsReimbursementsChargebacks"),
    groupKey: "group_income",
  },
  {
    name: translate("freelance"),
    categoryType: "income",
    color: CATEGORY_COLORS[5].value, // Teal
    icon: "RiComputerLine",
    description: translate("freelanceAndContractWork"),
    groupKey: "group_income",
  },
];

export const DEFAULT_INTEREST_CATEGORIES: DefaultCategory[] = [
  {
    name: translate("interest"),
    categoryType: "income",
    color: CATEGORY_COLORS[2].value, // Green
    icon: "RiPercentLine",
    description: translate("interestEarnedOnSavingsAccounts"),
    isSystem: true,
    groupKey: "group_income",
    key: "savings_interest",
  },
];

export const DEFAULT_TRANSFER_CATEGORIES: DefaultCategory[] = [
  {
    name: translate("internalTransfere06d01"),
    categoryType: "transfer",
    color: CATEGORY_COLORS[9].value, // Slate
    icon: "RiExchangeLine",
    description: translate(
      "transfersBetweenYourOwnAccountsToMoveMoneyInternally",
    ),
    isSystem: true,
    key: "internal_transfer",
  },
  {
    name: translate("externalTransfer"),
    categoryType: "transfer",
    color: CATEGORY_COLORS[10].value, // Stone
    icon: "RiArrowLeftRightLine",
    description: translate("moneyMovedToOrFromExternalAccountsNotTracked"),
    isSystem: true,
    key: "external_transfer",
  },
  {
    name: translate("balancingTransfer"),
    categoryType: "transfer",
    color: CATEGORY_COLORS[11].value, // Zinc
    icon: "RiScalesLine",
    description: translate("balanceAdjustmentsForAccountReconciliation"),
    isSystem: true,
    hideFromSelection: true,
    key: "balancing_transfer",
  },
  {
    name: translate("savingsTransfer"),
    categoryType: "transfer",
    color: CATEGORY_COLORS[2].value, // Green
    icon: "RiSafe2Line",
    description: translate("transfersMovedIntoYourSavingsAccounts"),
    isSystem: true,
    groupKey: "group_savings",
    key: "savings_transfer",
  },
  {
    name: translate("investmentTransfer"),
    categoryType: "transfer",
    color: CATEGORY_COLORS[1].value, // Blue
    icon: "RiLineChartLine",
    description: translate("transfersMovedIntoYourInvestmentAccounts"),
    isSystem: true,
    groupKey: "group_savings",
    key: "investment_transfer",
  },
];

// Groups come first: seeding inserts them before the categories that
// reference them by `groupKey`.
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  ...DEFAULT_CATEGORY_GROUPS,
  ...DEFAULT_EXPENSE_CATEGORIES,
  ...DEFAULT_INCOME_CATEGORIES,
  ...DEFAULT_TRANSFER_CATEGORIES,
  ...DEFAULT_INTEREST_CATEGORIES,
];

export function getCategoriesByType(type: CategoryType): DefaultCategory[] {
  return DEFAULT_CATEGORIES.filter(
    (category) => category.categoryType === type,
  );
}
