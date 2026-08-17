export const DATE_FORMAT_OPTIONS = [
  { value: "DD-MM-YYYY", label: "DD-MM-YYYY", example: "31-12-2025" },
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY", example: "31/12/2025" },
  { value: "DD.MM.YYYY", label: "DD.MM.YYYY", example: "31.12.2025" },
  { value: "MM-DD-YYYY", label: "MM-DD-YYYY", example: "12-31-2025" },
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY", example: "12/31/2025" },
  { value: "MM.DD.YYYY", label: "MM.DD.YYYY", example: "12.31.2025" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD", example: "2025-12-31" },
  { value: "YYYY/MM/DD", label: "YYYY/MM/DD", example: "2025/12/31" },
  { value: "YYYY.MM.DD", label: "YYYY.MM.DD", example: "2025.12.31" },
  { value: "DD-MM-YY", label: "DD-MM-YY", example: "31-12-25" },
  { value: "DD/MM/YY", label: "DD/MM/YY", example: "31/12/25" },
  { value: "DD.MM.YY", label: "DD.MM.YY", example: "31.12.25" },
  { value: "MM-DD-YY", label: "MM-DD-YY", example: "12-31-25" },
  { value: "MM/DD/YY", label: "MM/DD/YY", example: "12/31/25" },
  { value: "MM.DD.YY", label: "MM.DD.YY", example: "12.31.25" },
  { value: "YY-MM-DD", label: "YY-MM-DD", example: "25-12-31" },
  { value: "YY/MM/DD", label: "YY/MM/DD", example: "25/12/31" },
  { value: "YY.MM.DD", label: "YY.MM.DD", example: "25.12.31" },
  { value: "YYYYMMDD", label: "YYYYMMDD", example: "20251231" },
  { value: "DDMMYYYY", label: "DDMMYYYY", example: "31122025" },
  { value: "MMDDYYYY", label: "MMDDYYYY", example: "12312025" },
  { value: "DD MMM YYYY", label: "DD MMM YYYY", example: "31 Dec 2025" },
  { value: "MMM DD, YYYY", label: "MMM DD, YYYY", example: "Dec 31, 2025" },
] as const;

export type ImportDateFormat = (typeof DATE_FORMAT_OPTIONS)[number]["value"];

export function isImportDateFormat(value: unknown): value is ImportDateFormat {
  return DATE_FORMAT_OPTIONS.some((option) => option.value === value);
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function expandYear(year: number): number {
  return year <= 50 ? 2000 + year : 1900 + year;
}

function validUTCDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function parseTextDate(value: string, format: ImportDateFormat): Date | null {
  const match =
    format === "DD MMM YYYY"
      ? value.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})(?:[T\s].*)?$/i)
      : value.match(/^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})(?:[T\s].*)?$/i);

  if (!match) return null;

  const day = Number(format === "DD MMM YYYY" ? match[1] : match[2]);
  const monthName = (
    format === "DD MMM YYYY" ? match[2] : match[1]
  ).toLowerCase();
  const year = Number(match[3]);
  const month = MONTHS[monthName];
  return month ? validUTCDate(year, month, day) : null;
}

function parseCompactDate(
  value: string,
  format: ImportDateFormat,
): Date | null {
  if (!/^\d{8}$/.test(value)) return null;

  if (format === "YYYYMMDD") {
    return validUTCDate(
      Number(value.slice(0, 4)),
      Number(value.slice(4, 6)),
      Number(value.slice(6, 8)),
    );
  }
  if (format === "DDMMYYYY") {
    return validUTCDate(
      Number(value.slice(4, 8)),
      Number(value.slice(2, 4)),
      Number(value.slice(0, 2)),
    );
  }
  return validUTCDate(
    Number(value.slice(4, 8)),
    Number(value.slice(0, 2)),
    Number(value.slice(2, 4)),
  );
}

/** Parse a CSV date without relying on the host locale or timezone. */
export function parseImportDate(
  rawValue: string | null | undefined,
  format: ImportDateFormat,
): Date | null {
  if (typeof rawValue !== "string") return null;
  const value = rawValue.replace(/['"]/g, "").trim();
  if (!value) return null;

  if (format === "DD MMM YYYY" || format === "MMM DD, YYYY") {
    return parseTextDate(value, format);
  }
  if (format === "YYYYMMDD" || format === "DDMMYYYY" || format === "MMDDYYYY") {
    return parseCompactDate(value, format);
  }

  const separator = format.includes("-")
    ? "-"
    : format.includes("/")
      ? "/"
      : ".";
  const escapedSeparator = separator === "." ? "\\." : separator;
  const tokens = format.split(separator);
  const capture = tokens.map((token) =>
    token === "YYYY" ? "(\\d{4})" : "(\\d{1,2})",
  );
  const match = value.match(
    new RegExp(`^${capture.join(escapedSeparator)}(?:[T\\s].*)?$`),
  );
  if (!match) return null;

  const parts = Object.fromEntries(
    tokens.map((token, index) => [token, Number(match[index + 1])]),
  );
  const year = parts.YYYY ?? expandYear(parts.YY);
  return validUTCDate(year, parts.MM, parts.DD);
}

export function toInvariantDateTime(date: Date): string {
  return date.toISOString();
}

export function toInvariantDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
