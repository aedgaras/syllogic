export function maskIban(iban: string): string {
  if (!iban || iban.length < 8) return iban;
  return iban.slice(0, 4) + " •••• " + iban.slice(-4);
}
