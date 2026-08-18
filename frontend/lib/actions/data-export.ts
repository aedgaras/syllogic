"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  users,
  people,
  categories,
  accounts,
  accountOwners,
  properties,
  propertyOwners,
  vehicles,
  vehicleOwners,
  recurringTransactions,
  transactions,
  internalTransfers,
  categorizationRules,
  accountBalances,
  transactionLinks,
  subscriptionSuggestions,
  holdings,
  brokerTrades,
  holdingValuations,
  reports,
} from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth-helpers";
import { getSelfPersonId } from "@/lib/people/queries";
import { decryptValue, encryptValue, blindIndex } from "@/lib/security/data-encryption";

const EXPORT_FORMAT = "syllogic-data-export";
const EXPORT_VERSION = 1;

function safeDecrypt(value: string | null): string | null {
  if (!value) return null;
  try {
    return decryptValue(value);
  } catch {
    return null;
  }
}

// ============================================================================
// Export
// ============================================================================

export async function exportUserData(): Promise<{
  success: boolean;
  data?: string;
  fileName?: string;
  error?: string;
}> {
  const userId = await requireAuth();
  if (!userId) return { success: false, error: "Not authenticated" };

  try {
    const userRow = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { name: true, functionalCurrency: true },
    });

    const [
      peopleRows,
      categoryRows,
      accountRows,
      accountOwnerRows,
      propertyRows,
      propertyOwnerRows,
      vehicleRows,
      vehicleOwnerRows,
      recurringRows,
      transactionRows,
      transferRows,
      ruleRows,
      balanceRows,
      linkRows,
      suggestionRows,
      holdingRows,
      tradeRows,
      valuationRows,
      reportRows,
    ] = await Promise.all([
      db.select().from(people).where(eq(people.userId, userId)),
      db.select().from(categories).where(eq(categories.userId, userId)),
      db.select().from(accounts).where(eq(accounts.userId, userId)),
      db
        .select({
          accountId: accountOwners.accountId,
          personId: accountOwners.personId,
          share: accountOwners.share,
        })
        .from(accountOwners)
        .innerJoin(accounts, eq(accountOwners.accountId, accounts.id))
        .where(eq(accounts.userId, userId)),
      db.select().from(properties).where(eq(properties.userId, userId)),
      db
        .select({
          propertyId: propertyOwners.propertyId,
          personId: propertyOwners.personId,
          share: propertyOwners.share,
        })
        .from(propertyOwners)
        .innerJoin(properties, eq(propertyOwners.propertyId, properties.id))
        .where(eq(properties.userId, userId)),
      db.select().from(vehicles).where(eq(vehicles.userId, userId)),
      db
        .select({
          vehicleId: vehicleOwners.vehicleId,
          personId: vehicleOwners.personId,
          share: vehicleOwners.share,
        })
        .from(vehicleOwners)
        .innerJoin(vehicles, eq(vehicleOwners.vehicleId, vehicles.id))
        .where(eq(vehicles.userId, userId)),
      db
        .select()
        .from(recurringTransactions)
        .where(eq(recurringTransactions.userId, userId)),
      db.select().from(transactions).where(eq(transactions.userId, userId)),
      db
        .select()
        .from(internalTransfers)
        .where(eq(internalTransfers.userId, userId)),
      db
        .select()
        .from(categorizationRules)
        .where(eq(categorizationRules.userId, userId)),
      db
        .select({
          id: accountBalances.id,
          accountId: accountBalances.accountId,
          date: accountBalances.date,
          balanceInAccountCurrency: accountBalances.balanceInAccountCurrency,
          balanceInFunctionalCurrency:
            accountBalances.balanceInFunctionalCurrency,
        })
        .from(accountBalances)
        .innerJoin(accounts, eq(accountBalances.accountId, accounts.id))
        .where(eq(accounts.userId, userId)),
      db
        .select()
        .from(transactionLinks)
        .where(eq(transactionLinks.userId, userId)),
      db
        .select()
        .from(subscriptionSuggestions)
        .where(eq(subscriptionSuggestions.userId, userId)),
      db.select().from(holdings).where(eq(holdings.userId, userId)),
      db
        .select({
          id: brokerTrades.id,
          accountId: brokerTrades.accountId,
          symbol: brokerTrades.symbol,
          tradeDate: brokerTrades.tradeDate,
          side: brokerTrades.side,
          quantity: brokerTrades.quantity,
          price: brokerTrades.price,
          currency: brokerTrades.currency,
          externalId: brokerTrades.externalId,
        })
        .from(brokerTrades)
        .innerJoin(accounts, eq(brokerTrades.accountId, accounts.id))
        .where(eq(accounts.userId, userId)),
      db
        .select({
          id: holdingValuations.id,
          holdingId: holdingValuations.holdingId,
          date: holdingValuations.date,
          quantity: holdingValuations.quantity,
          price: holdingValuations.price,
          valueUserCurrency: holdingValuations.valueUserCurrency,
          isStale: holdingValuations.isStale,
        })
        .from(holdingValuations)
        .innerJoin(holdings, eq(holdingValuations.holdingId, holdings.id))
        .where(eq(holdings.userId, userId)),
      db.select().from(reports).where(eq(reports.userId, userId)),
    ]);

    const payload = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      profile: {
        name: userRow?.name ?? null,
        functionalCurrency: userRow?.functionalCurrency ?? null,
      },
      data: {
        people: peopleRows.map((p) => ({
          id: p.id,
          name: p.name,
          kind: p.kind,
          color: p.color,
        })),
        categories: categoryRows.map((c) => ({
          id: c.id,
          name: c.name,
          parentId: c.parentId,
          categoryType: c.categoryType,
          color: c.color,
          icon: c.icon,
          description: c.description,
          categorizationInstructions: c.categorizationInstructions,
          hideFromSelection: c.hideFromSelection,
        })),
        accounts: accountRows.map((a) => ({
          id: a.id,
          name: a.name,
          accountType: a.accountType,
          institution: a.institution,
          currency: a.currency,
          iban: safeDecrypt(a.ibanCiphertext),
          balanceAvailable: a.balanceAvailable,
          startingBalance: a.startingBalance,
          functionalBalance: a.functionalBalance,
          balanceIsAnchored: a.balanceIsAnchored,
          isActive: a.isActive,
          aliasPatterns: a.aliasPatterns,
          lastSyncedAt: a.lastSyncedAt,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        })),
        accountOwners: accountOwnerRows,
        properties: propertyRows.map((p) => ({
          id: p.id,
          name: p.name,
          propertyType: p.propertyType,
          address: p.address,
          currentValue: p.currentValue,
          currency: p.currency,
          isActive: p.isActive,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        })),
        propertyOwners: propertyOwnerRows,
        vehicles: vehicleRows.map((v) => ({
          id: v.id,
          name: v.name,
          vehicleType: v.vehicleType,
          make: v.make,
          model: v.model,
          year: v.year,
          currentValue: v.currentValue,
          currency: v.currency,
          isActive: v.isActive,
          createdAt: v.createdAt,
          updatedAt: v.updatedAt,
        })),
        vehicleOwners: vehicleOwnerRows,
        recurringTransactions: recurringRows.map((r) => ({
          id: r.id,
          accountId: r.accountId,
          name: r.name,
          merchant: r.merchant,
          amount: r.amount,
          currency: r.currency,
          categoryId: r.categoryId,
          importance: r.importance,
          frequency: r.frequency,
          isActive: r.isActive,
          description: r.description,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
        transactions: transactionRows.map((t) => ({
          id: t.id,
          accountId: t.accountId,
          transactionType: t.transactionType,
          amount: t.amount,
          currency: t.currency,
          functionalAmount: t.functionalAmount,
          description: t.description,
          merchant: t.merchant,
          creditor: t.creditor,
          debtor: t.debtor,
          counterpartyIban: safeDecrypt(t.counterpartyIbanCiphertext),
          internalTransferId: t.internalTransferId,
          categoryId: t.categoryId,
          categorySystemId: t.categorySystemId,
          bookedAt: t.bookedAt,
          pending: t.pending,
          categorizationInstructions: t.categorizationInstructions,
          enrichmentData: t.enrichmentData,
          recurringTransactionId: t.recurringTransactionId,
          includeInAnalytics: t.includeInAnalytics,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        })),
        internalTransfers: transferRows.map((it) => ({
          id: it.id,
          sourceTxnId: it.sourceTxnId,
          mirrorTxnId: it.mirrorTxnId,
          sourceAccountId: it.sourceAccountId,
          pocketAccountId: it.pocketAccountId,
          amount: it.amount,
          currency: it.currency,
          detectedAt: it.detectedAt,
          createdAt: it.createdAt,
        })),
        categorizationRules: ruleRows.map((r) => ({
          id: r.id,
          categoryId: r.categoryId,
          instructions: r.instructions,
          isActive: r.isActive,
          createdAt: r.createdAt,
        })),
        accountBalances: balanceRows,
        transactionLinks: linkRows.map((l) => ({
          groupId: l.groupId,
          transactionId: l.transactionId,
          linkRole: l.linkRole,
        })),
        subscriptionSuggestions: suggestionRows.map((s) => ({
          id: s.id,
          suggestedName: s.suggestedName,
          suggestedMerchant: s.suggestedMerchant,
          suggestedAmount: s.suggestedAmount,
          currency: s.currency,
          detectedFrequency: s.detectedFrequency,
          confidence: s.confidence,
          accountId: s.accountId,
          suggestedCategoryId: s.suggestedCategoryId,
          matchedTransactionIds: s.matchedTransactionIds,
          status: s.status,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
        holdings: holdingRows.map((h) => ({
          id: h.id,
          accountId: h.accountId,
          symbol: h.symbol,
          providerSymbol: h.providerSymbol,
          name: h.name,
          currency: h.currency,
          instrumentType: h.instrumentType,
          quantity: h.quantity,
          avgCost: h.avgCost,
          asOfDate: h.asOfDate,
          source: h.source,
          createdAt: h.createdAt,
          updatedAt: h.updatedAt,
        })),
        brokerTrades: tradeRows,
        holdingValuations: valuationRows,
        reports: reportRows.map((r) => ({
          id: r.id,
          name: r.name,
          accountIds: r.accountIds,
          transactionMode: r.transactionMode,
          transactionCount: r.transactionCount,
          transactionDirection: r.transactionDirection,
          frequency: r.frequency,
          sendTime: r.sendTime,
          sendDayOfWeek: r.sendDayOfWeek,
          sendDayOfMonth: r.sendDayOfMonth,
          timezone: r.timezone,
          recipientEmails: r.recipientEmails,
          isActive: r.isActive,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
      },
    };

    const stamp = new Date().toISOString().slice(0, 10);
    return {
      success: true,
      data: JSON.stringify(payload, null, 2),
      fileName: `syllogic-export-${stamp}.json`,
    };
  } catch (error) {
    console.error("Failed to export data:", error);
    return { success: false, error: "Failed to export data." };
  }
}

// ============================================================================
// Import
// ============================================================================

type ImportSummary = Record<string, number>;

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toDate(value: unknown): Date | null {
  if (!value || typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export async function importUserData(jsonText: string): Promise<{
  success: boolean;
  error?: string;
  summary?: ImportSummary;
}> {
  const userId = await requireAuth();
  if (!userId) return { success: false, error: "Not authenticated" };

  let payload: Row;
  try {
    payload = JSON.parse(jsonText);
  } catch {
    return { success: false, error: "That file is not valid JSON." };
  }

  if (
    payload?.format !== EXPORT_FORMAT ||
    !payload?.data ||
    typeof payload.data !== "object"
  ) {
    return {
      success: false,
      error: "That file is not a Syllogic data export.",
    };
  }
  if (typeof payload.version === "number" && payload.version > EXPORT_VERSION) {
    return {
      success: false,
      error: "This export was created by a newer version of Syllogic.",
    };
  }

  const d = payload.data as Row;
  const summary: ImportSummary = {};

  // Resolve (or create) the self person outside the transaction so the
  // partial-unique-index race handling in getSelfPersonId can do its thing.
  const selfPersonId = await getSelfPersonId(userId);

  try {
    await db.transaction(async (tx) => {
      // ---- People ----
      const personIdMap = new Map<string, string>();
      for (const p of toArray<Row>(d.people)) {
        if (p.kind === "self") {
          personIdMap.set(p.id, selfPersonId);
          continue;
        }
        const [inserted] = await tx
          .insert(people)
          .values({
            userId,
            name: p.name ?? "Household member",
            kind: "member",
            color: p.color ?? null,
          })
          .returning({ id: people.id });
        personIdMap.set(p.id, inserted.id);
      }
      summary.people = personIdMap.size;

      // ---- Categories (self-referencing; resolve parents iteratively) ----
      const categoryIdMap = new Map<string, string>();
      const findOrCreateCategory = async (
        c: Row,
        newParentId: string | null,
      ): Promise<string> => {
        const existing = await tx.query.categories.findFirst({
          where: newParentId
            ? and(
                eq(categories.userId, userId),
                eq(categories.name, c.name),
                eq(categories.parentId, newParentId),
              )
            : and(
                eq(categories.userId, userId),
                eq(categories.name, c.name),
                isNull(categories.parentId),
              ),
        });
        if (existing) return existing.id;
        const [inserted] = await tx
          .insert(categories)
          .values({
            userId,
            name: c.name,
            parentId: newParentId,
            categoryType: c.categoryType ?? "expense",
            color: c.color ?? null,
            icon: c.icon ?? null,
            description: c.description ?? null,
            categorizationInstructions: c.categorizationInstructions ?? null,
            isSystem: false,
            hideFromSelection: c.hideFromSelection ?? false,
          })
          .returning({ id: categories.id });
        return inserted.id;
      };

      let remaining = toArray<Row>(d.categories);
      let progressed = true;
      while (remaining.length && progressed) {
        progressed = false;
        const stillRemaining: Row[] = [];
        for (const c of remaining) {
          if (c.parentId && !categoryIdMap.has(c.parentId)) {
            stillRemaining.push(c);
            continue;
          }
          const newParentId = c.parentId
            ? categoryIdMap.get(c.parentId)!
            : null;
          categoryIdMap.set(c.id, await findOrCreateCategory(c, newParentId));
          progressed = true;
        }
        remaining = stillRemaining;
      }
      // Orphaned children (parent missing from export) become top-level.
      for (const c of remaining) {
        categoryIdMap.set(c.id, await findOrCreateCategory(c, null));
      }
      summary.categories = categoryIdMap.size;

      // ---- Accounts ----
      const accountIdMap = new Map<string, string>();
      for (const a of toArray<Row>(d.accounts)) {
        const iban = typeof a.iban === "string" ? a.iban : null;
        const [inserted] = await tx
          .insert(accounts)
          .values({
            userId,
            name: a.name,
            accountType: a.accountType,
            institution: a.institution ?? null,
            currency: a.currency ?? "EUR",
            provider: "manual",
            ibanCiphertext: iban ? encryptValue(iban) : null,
            ibanHash: iban ? blindIndex(iban) : null,
            balanceAvailable: a.balanceAvailable ?? null,
            startingBalance: a.startingBalance ?? "0",
            functionalBalance: a.functionalBalance ?? null,
            balanceIsAnchored: a.balanceIsAnchored ?? false,
            isActive: a.isActive ?? true,
            aliasPatterns: Array.isArray(a.aliasPatterns) ? a.aliasPatterns : [],
            lastSyncedAt: toDate(a.lastSyncedAt),
            createdAt: toDate(a.createdAt) ?? new Date(),
            updatedAt: toDate(a.updatedAt) ?? new Date(),
          })
          .returning({ id: accounts.id });
        accountIdMap.set(a.id, inserted.id);
      }
      summary.accounts = accountIdMap.size;

      // ---- Owners (accounts / properties / vehicles) ----
      for (const o of toArray<Row>(d.accountOwners)) {
        const accountId = accountIdMap.get(o.accountId);
        const personId = personIdMap.get(o.personId);
        if (!accountId || !personId) continue;
        await tx
          .insert(accountOwners)
          .values({ accountId, personId, share: o.share ?? null })
          .onConflictDoNothing();
      }

      // ---- Properties ----
      const propertyIdMap = new Map<string, string>();
      for (const p of toArray<Row>(d.properties)) {
        const [inserted] = await tx
          .insert(properties)
          .values({
            userId,
            name: p.name,
            propertyType: p.propertyType,
            address: p.address ?? null,
            currentValue: p.currentValue ?? "0",
            currency: p.currency ?? "EUR",
            isActive: p.isActive ?? true,
            createdAt: toDate(p.createdAt) ?? new Date(),
            updatedAt: toDate(p.updatedAt) ?? new Date(),
          })
          .returning({ id: properties.id });
        propertyIdMap.set(p.id, inserted.id);
      }
      summary.properties = propertyIdMap.size;

      for (const o of toArray<Row>(d.propertyOwners)) {
        const propertyId = propertyIdMap.get(o.propertyId);
        const personId = personIdMap.get(o.personId);
        if (!propertyId || !personId) continue;
        await tx
          .insert(propertyOwners)
          .values({ propertyId, personId, share: o.share ?? null })
          .onConflictDoNothing();
      }

      // ---- Vehicles ----
      const vehicleIdMap = new Map<string, string>();
      for (const v of toArray<Row>(d.vehicles)) {
        const [inserted] = await tx
          .insert(vehicles)
          .values({
            userId,
            name: v.name,
            vehicleType: v.vehicleType,
            make: v.make ?? null,
            model: v.model ?? null,
            year: v.year ?? null,
            currentValue: v.currentValue ?? "0",
            currency: v.currency ?? "EUR",
            isActive: v.isActive ?? true,
            createdAt: toDate(v.createdAt) ?? new Date(),
            updatedAt: toDate(v.updatedAt) ?? new Date(),
          })
          .returning({ id: vehicles.id });
        vehicleIdMap.set(v.id, inserted.id);
      }
      summary.vehicles = vehicleIdMap.size;

      for (const o of toArray<Row>(d.vehicleOwners)) {
        const vehicleId = vehicleIdMap.get(o.vehicleId);
        const personId = personIdMap.get(o.personId);
        if (!vehicleId || !personId) continue;
        await tx
          .insert(vehicleOwners)
          .values({ vehicleId, personId, share: o.share ?? null })
          .onConflictDoNothing();
      }

      // ---- Recurring transactions ----
      const recurringIdMap = new Map<string, string>();
      for (const r of toArray<Row>(d.recurringTransactions)) {
        const accountId = r.accountId
          ? accountIdMap.get(r.accountId) ?? null
          : null;
        const categoryId = r.categoryId
          ? categoryIdMap.get(r.categoryId) ?? null
          : null;
        const [inserted] = await tx
          .insert(recurringTransactions)
          .values({
            userId,
            accountId,
            name: r.name,
            merchant: r.merchant ?? null,
            amount: r.amount,
            currency: r.currency ?? "EUR",
            categoryId,
            importance: r.importance ?? 3,
            frequency: r.frequency,
            isActive: r.isActive ?? true,
            description: r.description ?? null,
            createdAt: toDate(r.createdAt) ?? new Date(),
            updatedAt: toDate(r.updatedAt) ?? new Date(),
          })
          .returning({ id: recurringTransactions.id });
        recurringIdMap.set(r.id, inserted.id);
      }
      summary.recurringTransactions = recurringIdMap.size;

      // ---- Transactions ----
      const txnIdMap = new Map<string, string>();
      for (const t of toArray<Row>(d.transactions)) {
        const accountId = accountIdMap.get(t.accountId);
        if (!accountId) continue;
        const counterpartyIban =
          typeof t.counterpartyIban === "string" ? t.counterpartyIban : null;
        const [inserted] = await tx
          .insert(transactions)
          .values({
            userId,
            accountId,
            transactionType: t.transactionType ?? null,
            amount: t.amount,
            currency: t.currency ?? "EUR",
            functionalAmount: t.functionalAmount ?? null,
            description: t.description ?? null,
            merchant: t.merchant ?? null,
            creditor: t.creditor ?? null,
            debtor: t.debtor ?? null,
            counterpartyIbanCiphertext: counterpartyIban
              ? encryptValue(counterpartyIban)
              : null,
            counterpartyIbanHash: counterpartyIban
              ? blindIndex(counterpartyIban)
              : null,
            categoryId: t.categoryId
              ? categoryIdMap.get(t.categoryId) ?? null
              : null,
            categorySystemId: t.categorySystemId
              ? categoryIdMap.get(t.categorySystemId) ?? null
              : null,
            recurringTransactionId: t.recurringTransactionId
              ? recurringIdMap.get(t.recurringTransactionId) ?? null
              : null,
            bookedAt: toDate(t.bookedAt) ?? new Date(),
            pending: t.pending ?? false,
            categorizationInstructions: t.categorizationInstructions ?? null,
            enrichmentData: t.enrichmentData ?? null,
            includeInAnalytics: t.includeInAnalytics ?? true,
            createdAt: toDate(t.createdAt) ?? new Date(),
            updatedAt: toDate(t.updatedAt) ?? new Date(),
          })
          .returning({ id: transactions.id });
        txnIdMap.set(t.id, inserted.id);
      }
      summary.transactions = txnIdMap.size;

      // ---- Internal transfers (+ backfill transactions.internalTransferId) ----
      const transferIdMap = new Map<string, string>();
      for (const it of toArray<Row>(d.internalTransfers)) {
        const sourceTxnId = txnIdMap.get(it.sourceTxnId);
        const sourceAccountId = accountIdMap.get(it.sourceAccountId);
        const pocketAccountId = accountIdMap.get(it.pocketAccountId);
        if (!sourceTxnId || !sourceAccountId || !pocketAccountId) continue;
        const mirrorTxnId = it.mirrorTxnId
          ? txnIdMap.get(it.mirrorTxnId) ?? null
          : null;
        const [inserted] = await tx
          .insert(internalTransfers)
          .values({
            userId,
            sourceTxnId,
            mirrorTxnId,
            sourceAccountId,
            pocketAccountId,
            amount: it.amount,
            currency: it.currency,
            detectedAt: toDate(it.detectedAt) ?? new Date(),
            createdAt: toDate(it.createdAt) ?? new Date(),
          })
          .returning({ id: internalTransfers.id });
        transferIdMap.set(it.id, inserted.id);
      }
      summary.internalTransfers = transferIdMap.size;

      for (const t of toArray<Row>(d.transactions)) {
        if (!t.internalTransferId) continue;
        const newTxnId = txnIdMap.get(t.id);
        const newTransferId = transferIdMap.get(t.internalTransferId);
        if (newTxnId && newTransferId) {
          await tx
            .update(transactions)
            .set({ internalTransferId: newTransferId })
            .where(eq(transactions.id, newTxnId));
        }
      }

      // ---- Categorization rules ----
      let ruleCount = 0;
      for (const r of toArray<Row>(d.categorizationRules)) {
        const categoryId = categoryIdMap.get(r.categoryId);
        if (!categoryId) continue;
        await tx.insert(categorizationRules).values({
          userId,
          categoryId,
          instructions: r.instructions ?? null,
          isActive: r.isActive ?? true,
          createdAt: toDate(r.createdAt) ?? new Date(),
        });
        ruleCount += 1;
      }
      summary.categorizationRules = ruleCount;

      // ---- Account balances ----
      let balanceCount = 0;
      for (const b of toArray<Row>(d.accountBalances)) {
        const accountId = accountIdMap.get(b.accountId);
        if (!accountId) continue;
        await tx
          .insert(accountBalances)
          .values({
            accountId,
            date: toDate(b.date) ?? new Date(),
            balanceInAccountCurrency: b.balanceInAccountCurrency,
            balanceInFunctionalCurrency: b.balanceInFunctionalCurrency,
          })
          .onConflictDoNothing();
        balanceCount += 1;
      }
      summary.accountBalances = balanceCount;

      // ---- Transaction links ----
      const groupIdMap = new Map<string, string>();
      let linkCount = 0;
      for (const l of toArray<Row>(d.transactionLinks)) {
        const transactionId = txnIdMap.get(l.transactionId);
        if (!transactionId) continue;
        let newGroupId = groupIdMap.get(l.groupId);
        if (!newGroupId) {
          newGroupId = randomUUID();
          groupIdMap.set(l.groupId, newGroupId);
        }
        await tx
          .insert(transactionLinks)
          .values({
            userId,
            groupId: newGroupId,
            transactionId,
            linkRole: l.linkRole,
          })
          .onConflictDoNothing();
        linkCount += 1;
      }
      summary.transactionLinks = linkCount;

      // ---- Subscription suggestions ----
      let suggestionCount = 0;
      for (const s of toArray<Row>(d.subscriptionSuggestions)) {
        let matchedIds: string[] = [];
        try {
          matchedIds = JSON.parse(s.matchedTransactionIds || "[]");
        } catch {
          matchedIds = [];
        }
        const remappedMatched = matchedIds
          .map((id) => txnIdMap.get(id))
          .filter((id): id is string => Boolean(id));
        await tx.insert(subscriptionSuggestions).values({
          userId,
          suggestedName: s.suggestedName,
          suggestedMerchant: s.suggestedMerchant ?? null,
          suggestedAmount: s.suggestedAmount,
          currency: s.currency ?? "EUR",
          detectedFrequency: s.detectedFrequency,
          confidence: s.confidence ?? 0,
          accountId: s.accountId ? accountIdMap.get(s.accountId) ?? null : null,
          suggestedCategoryId: s.suggestedCategoryId
            ? categoryIdMap.get(s.suggestedCategoryId) ?? null
            : null,
          matchedTransactionIds: JSON.stringify(remappedMatched),
          status: s.status ?? "pending",
          createdAt: toDate(s.createdAt) ?? new Date(),
          updatedAt: toDate(s.updatedAt) ?? new Date(),
        });
        suggestionCount += 1;
      }
      summary.subscriptionSuggestions = suggestionCount;

      // ---- Holdings / broker trades / holding valuations ----
      const holdingIdMap = new Map<string, string>();
      for (const h of toArray<Row>(d.holdings)) {
        const accountId = accountIdMap.get(h.accountId);
        if (!accountId) continue;
        const [inserted] = await tx
          .insert(holdings)
          .values({
            userId,
            accountId,
            symbol: h.symbol,
            providerSymbol: h.providerSymbol ?? null,
            name: h.name ?? null,
            currency: h.currency,
            instrumentType: h.instrumentType,
            quantity: h.quantity,
            avgCost: h.avgCost ?? null,
            asOfDate: h.asOfDate ?? null,
            source: h.source,
            createdAt: toDate(h.createdAt) ?? new Date(),
            updatedAt: toDate(h.updatedAt) ?? new Date(),
          })
          .onConflictDoNothing()
          .returning({ id: holdings.id });
        if (inserted) holdingIdMap.set(h.id, inserted.id);
      }
      summary.holdings = holdingIdMap.size;

      let tradeCount = 0;
      for (const bt of toArray<Row>(d.brokerTrades)) {
        const accountId = accountIdMap.get(bt.accountId);
        if (!accountId) continue;
        await tx
          .insert(brokerTrades)
          .values({
            accountId,
            symbol: bt.symbol,
            tradeDate: bt.tradeDate,
            side: bt.side,
            quantity: bt.quantity,
            price: bt.price,
            currency: bt.currency,
            externalId: bt.externalId,
          })
          .onConflictDoNothing();
        tradeCount += 1;
      }
      summary.brokerTrades = tradeCount;

      let valuationCount = 0;
      for (const v of toArray<Row>(d.holdingValuations)) {
        const holdingId = holdingIdMap.get(v.holdingId);
        if (!holdingId) continue;
        await tx
          .insert(holdingValuations)
          .values({
            holdingId,
            date: v.date,
            quantity: v.quantity,
            price: v.price,
            valueUserCurrency: v.valueUserCurrency,
            isStale: v.isStale ?? false,
          })
          .onConflictDoNothing();
        valuationCount += 1;
      }
      summary.holdingValuations = valuationCount;

      // ---- Reports (imported disabled so nothing emails automatically) ----
      let reportCount = 0;
      for (const r of toArray<Row>(d.reports)) {
        const accountIds = Array.isArray(r.accountIds)
          ? r.accountIds
              .map((id: string) => accountIdMap.get(id))
              .filter((id: string | undefined): id is string => Boolean(id))
          : [];
        await tx.insert(reports).values({
          userId,
          name: r.name,
          accountIds,
          transactionMode: r.transactionMode ?? "RECENT",
          transactionCount: r.transactionCount ?? 10,
          transactionDirection: r.transactionDirection ?? "ALL",
          frequency: r.frequency,
          sendTime: r.sendTime ?? "08:00:00",
          sendDayOfWeek: r.sendDayOfWeek ?? null,
          sendDayOfMonth: r.sendDayOfMonth ?? null,
          timezone: r.timezone ?? "UTC",
          recipientEmails: Array.isArray(r.recipientEmails)
            ? r.recipientEmails
            : [],
          isActive: false,
          nextRunAt: null,
          createdAt: toDate(r.createdAt) ?? new Date(),
          updatedAt: toDate(r.updatedAt) ?? new Date(),
        });
        reportCount += 1;
      }
      summary.reports = reportCount;
    });

    revalidatePath("/", "layout");
    return { success: true, summary };
  } catch (error) {
    console.error("Failed to import data:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? `Import failed: ${error.message}`
          : "Import failed.",
    };
  }
}
