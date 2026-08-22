export interface BankConnectionConsent {
  status: string;
  consentExpiresAt: Date | null;
}

export function isConsentExpired(
  connection: BankConnectionConsent,
  now: number,
): boolean {
  return (
    connection.status === "expired" ||
    (!!connection.consentExpiresAt &&
      connection.consentExpiresAt.getTime() <= now)
  );
}

export function isConsentExpiringSoon(
  connection: BankConnectionConsent,
  now: number,
): boolean {
  if (!connection.consentExpiresAt) return false;
  const daysUntilExpiry = Math.ceil(
    (connection.consentExpiresAt.getTime() - now) / (1000 * 60 * 60 * 24),
  );
  return daysUntilExpiry <= 14 && daysUntilExpiry > 0;
}

export function consentTimeRemaining(
  connection: BankConnectionConsent,
  now: number,
): string | null {
  if (!connection.consentExpiresAt) return null;
  const milliseconds = connection.consentExpiresAt.getTime() - now;
  if (milliseconds <= 0) return "expired";
  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.ceil(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
