export type ExpirationOption = "never" | "30days" | "90days" | "1year";

export function getExpirationDate(option: ExpirationOption): Date | null {
  if (option === "never") return null;
  const now = new Date();
  switch (option) {
    case "30days":
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    case "90days":
      return new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    case "1year":
      return new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}

export function formatKeyDate(date: Date | null): string {
  if (!date) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

export function formatKeyRelativeTime(date: Date | null): string {
  if (!date) return "Never";
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

export function isKeyExpired(date: Date | null): boolean {
  if (!date) return false;
  return new Date(date) < new Date();
}
