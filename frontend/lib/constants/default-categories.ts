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
}

export const DEFAULT_EXPENSE_CATEGORIES: DefaultCategory[] = [
  {
    name: translate("foodDining"),
    categoryType: "expense",
    color: CATEGORY_COLORS[0].value, // Amber
    icon: "RiRestaurantLine",
    description: translate("restaurantsFoodDeliveryCafes"),
  },
  {
    name: translate("groceries"),
    categoryType: "expense",
    color: CATEGORY_COLORS[8].value, // Emerald
    icon: "RiShoppingCartLine",
    description: translate("supermarketsGroceryStoresHouseholdEssentials"),
  },
  {
    name: translate("transportation"),
    categoryType: "expense",
    color: CATEGORY_COLORS[1].value, // Blue
    icon: "RiCarLine",
    description: translate("fuelPublicTransitParkingRideSharing"),
  },
  {
    name: translate("shopping"),
    categoryType: "expense",
    color: CATEGORY_COLORS[6].value, // Pink
    icon: "RiShoppingBagLine",
    description: translate("clothingElectronicsGeneralPurchases"),
  },
  {
    name: translate("entertainment"),
    categoryType: "expense",
    color: CATEGORY_COLORS[4].value, // Purple
    icon: "RiGamepadLine",
    description: translate("moviesGamesConcertsStreamingServices"),
  },
  {
    name: translate("billsUtilities"),
    categoryType: "expense",
    color: CATEGORY_COLORS[9].value, // Slate
    icon: "RiFileTextLine",
    description: translate("electricityWaterInternetPhone"),
  },
  {
    name: translate("healthFitness"),
    categoryType: "expense",
    color: CATEGORY_COLORS[2].value, // Green
    icon: "RiHeartPulseLine",
    description: translate("gymMedicalExpensesPharmacy"),
  },
  {
    name: translate("housing"),
    categoryType: "expense",
    color: CATEGORY_COLORS[10].value, // Stone
    icon: "RiHome4Line",
    description: translate("rentMortgageHomeMaintenance"),
  },
  {
    name: translate("education"),
    categoryType: "expense",
    color: CATEGORY_COLORS[7].value, // Indigo
    icon: "RiBookOpenLine",
    description: translate("coursesBooksTuitionTraining"),
  },
  {
    name: translate("travel"),
    categoryType: "expense",
    color: CATEGORY_COLORS[5].value, // Teal
    icon: "RiPlaneLine",
    description: translate("hotelsFlightsVacationExpenses"),
  },
  {
    name: translate("personalCare"),
    categoryType: "expense",
    color: CATEGORY_COLORS[8].value, // Emerald
    icon: "RiUser3Line",
    description: translate("haircutsSpaPersonalHygiene"),
  },
  {
    name: translate("giftsDonations"),
    categoryType: "expense",
    color: CATEGORY_COLORS[3].value, // Red
    icon: "RiGiftLine",
    description: translate("presentsCharityDonations"),
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
  },
  {
    name: translate("otherIncome"),
    categoryType: "income",
    color: CATEGORY_COLORS[9].value, // Slate
    icon: "RiAddCircleLine",
    description: translate("miscellaneousIncome"),
  },
  {
    name: translate("refunds"),
    categoryType: "income",
    color: CATEGORY_COLORS[1].value, // Blue
    icon: "RiArrowGoBackLine",
    description: translate("refundsReimbursementsChargebacks"),
  },
  {
    name: translate("freelance"),
    categoryType: "income",
    color: CATEGORY_COLORS[5].value, // Teal
    icon: "RiComputerLine",
    description: translate("freelanceAndContractWork"),
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
    key: "savings_transfer",
  },
  {
    name: translate("investmentTransfer"),
    categoryType: "transfer",
    color: CATEGORY_COLORS[1].value, // Blue
    icon: "RiLineChartLine",
    description: translate("transfersMovedIntoYourInvestmentAccounts"),
    isSystem: true,
    key: "investment_transfer",
  },
];

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  ...DEFAULT_EXPENSE_CATEGORIES,
  ...DEFAULT_INCOME_CATEGORIES,
  ...DEFAULT_TRANSFER_CATEGORIES,
];

export function getCategoriesByType(type: CategoryType): DefaultCategory[] {
  return DEFAULT_CATEGORIES.filter(
    (category) => category.categoryType === type,
  );
}
