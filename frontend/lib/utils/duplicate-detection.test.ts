import { describe, it, expect } from "vitest";
import {
  detectDuplicates,
  markDuplicates,
  createTransactionHash,
} from "./duplicate-detection";
import type { Transaction } from "@/lib/db/schema";
import type { PreviewTransaction } from "@/features/csv-import/public";

function existing(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "existing-1",
    bookedAt: new Date("2024-03-05T00:00:00.000Z"),
    amount: "-42.50",
    description: "Coffee Shop",
    ...overrides,
  } as Transaction;
}

function preview(overrides: Partial<PreviewTransaction> = {}): PreviewTransaction {
  return {
    rowIndex: 0,
    date: "2024-03-05",
    amount: -42.5,
    description: "Coffee Shop",
    ...overrides,
  } as PreviewTransaction;
}

describe("detectDuplicates", () => {
  it("matches on identical date, amount and description", () => {
    const matches = detectDuplicates([preview()], [existing()]);
    expect(matches.size).toBe(1);
    const match = matches.get(0);
    expect(match?.existingTransaction.id).toBe("existing-1");
    expect(match?.confidence).toBe(1);
  });

  it("does not match when the date differs", () => {
    const matches = detectDuplicates(
      [preview({ date: "2024-03-06" })],
      [existing()],
    );
    expect(matches.size).toBe(0);
  });

  it("does not match when the amount differs beyond tolerance", () => {
    const matches = detectDuplicates(
      [preview({ amount: -50 })],
      [existing()],
    );
    expect(matches.size).toBe(0);
  });

  it("matches when amounts differ only by floating point noise", () => {
    const matches = detectDuplicates(
      [preview({ amount: -42.505 })],
      [existing({ amount: "-42.50" })],
    );
    expect(matches.size).toBe(1);
  });

  it("compares amounts by absolute value (sign-insensitive)", () => {
    const matches = detectDuplicates(
      [preview({ amount: 42.5 })],
      [existing({ amount: "-42.50" })],
    );
    expect(matches.size).toBe(1);
  });

  it("does not match when descriptions are dissimilar", () => {
    const matches = detectDuplicates(
      [preview({ description: "Completely different merchant" })],
      [existing()],
    );
    expect(matches.size).toBe(0);
  });

  it("matches near-identical descriptions above the similarity threshold", () => {
    const matches = detectDuplicates(
      [preview({ description: "Coffee Shop " })],
      [existing({ description: "Coffee Shop" })],
    );
    expect(matches.size).toBe(1);
  });

  it("keeps only the highest-confidence match per preview row", () => {
    const matches = detectDuplicates(
      [preview()],
      [
        existing({ id: "worse", description: "Coffee Shopp" }),
        existing({ id: "better", description: "Coffee Shop" }),
      ],
    );
    expect(matches.get(0)?.existingTransaction.id).toBe("better");
  });

  it("respects a custom similarity threshold", () => {
    const matches = detectDuplicates(
      [preview({ description: "Coffee Sh" })],
      [existing({ description: "Coffee Shop" })],
      0.5,
    );
    expect(matches.size).toBe(1);
  });
});

describe("markDuplicates", () => {
  it("flags preview transactions found in the duplicate map", () => {
    const matches = detectDuplicates([preview()], [existing()]);
    const [marked] = markDuplicates([preview()], matches);
    expect(marked.isDuplicate).toBe(true);
    expect(marked.duplicateOf).toBe("existing-1");
  });

  it("leaves unmatched preview transactions unmodified", () => {
    const [marked] = markDuplicates([preview({ rowIndex: 1 })], new Map());
    expect(marked.isDuplicate).toBeUndefined();
    expect(marked.duplicateOf).toBeUndefined();
  });
});

describe("createTransactionHash", () => {
  it("combines the rounded amount (in cents) and UTC date", () => {
    expect(
      createTransactionHash(42.5, new Date("2024-03-05T12:00:00.000Z")),
    ).toBe("4250:2024-2-5");
  });

  it("produces the same hash regardless of time-of-day", () => {
    const a = createTransactionHash(10, new Date("2024-01-01T00:00:00.000Z"));
    const b = createTransactionHash(10, new Date("2024-01-01T23:59:59.000Z"));
    expect(a).toBe(b);
  });
});
