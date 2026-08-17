import { t as translate } from "@/i18n/translate";
// All supported currencies for accounts and transactions
export const CURRENCIES = [
  { code: "EUR", name: translate("euro"), symbol: "€" },
  { code: "USD", name: translate("usDollar"), symbol: "$" },
  { code: "GBP", name: translate("britishPound"), symbol: "£" },
  { code: "CHF", name: translate("swissFranc"), symbol: "CHF" },
  { code: "JPY", name: translate("japaneseYen"), symbol: "¥" },
  { code: "CAD", name: translate("canadianDollar"), symbol: "C$" },
  { code: "AUD", name: translate("australianDollar"), symbol: "A$" },
  { code: "NZD", name: translate("newZealandDollar"), symbol: "NZ$" },
  { code: "SEK", name: translate("swedishKrona"), symbol: "kr" },
  { code: "NOK", name: translate("norwegianKrone"), symbol: "kr" },
  { code: "DKK", name: translate("danishKrone"), symbol: "kr" },
  { code: "PLN", name: translate("polishZloty"), symbol: "zł" },
  { code: "CZK", name: translate("czechKoruna"), symbol: "Kč" },
  { code: "HUF", name: translate("hungarianForint"), symbol: "Ft" },
  { code: "RON", name: translate("romanianLeu"), symbol: "lei" },
  { code: "BGN", name: translate("bulgarianLev"), symbol: "лв" },
  { code: "HRK", name: translate("croatianKuna"), symbol: "kn" },
  { code: "TRY", name: translate("turkishLira"), symbol: "₺" },
  { code: "RUB", name: translate("russianRuble"), symbol: "₽" },
  { code: "INR", name: translate("indianRupee"), symbol: "₹" },
  { code: "CNY", name: translate("chineseYuan"), symbol: "¥" },
  { code: "KRW", name: translate("southKoreanWon"), symbol: "₩" },
  { code: "SGD", name: translate("singaporeDollar"), symbol: "S$" },
  { code: "HKD", name: translate("hongKongDollar"), symbol: "HK$" },
  { code: "MXN", name: translate("mexicanPeso"), symbol: "MX$" },
  { code: "BRL", name: translate("brazilianReal"), symbol: "R$" },
  { code: "ZAR", name: translate("southAfricanRand"), symbol: "R" },
  { code: "AED", name: translate("uaeDirham"), symbol: "د.إ" },
  { code: "SAR", name: translate("saudiRiyal"), symbol: "﷼" },
  { code: "ILS", name: translate("israeliShekel"), symbol: "₪" },
] as const;

// Functional currencies for user's primary reporting currency
// Limited to major currencies for simplicity
export const FUNCTIONAL_CURRENCIES = [
  { code: "EUR", name: translate("euro"), symbol: "€" },
  { code: "USD", name: translate("usDollar"), symbol: "$" },
] as const;

export type Currency = (typeof CURRENCIES)[number];
export type FunctionalCurrency = (typeof FUNCTIONAL_CURRENCIES)[number];

export function getCurrencyByCode(code: string): Currency | undefined {
  return CURRENCIES.find((currency) => currency.code === code);
}

export function formatCurrency(amount: number, currencyCode: string): string {
  const currency = getCurrencyByCode(currencyCode);
  if (!currency) {
    return `${amount.toFixed(2)} ${currencyCode}`;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
