import { TransactionsClient } from "./transactions-client";
import { getUserAccounts } from "@/lib/actions/transactions";
import { getTransactionPage } from "@/features/transactions/server";
import { getUserCategories } from "@/lib/actions/categories";
import { getAuthenticatedSession } from "@/lib/auth-helpers";
import { isDemoRestrictedUserEmail } from "@/lib/demo-access";
import type { TransactionsQueryState } from "@/features/transactions/public";

export async function TransactionsSection({
  queryState,
}: {
  queryState: TransactionsQueryState;
}) {
  const [session, pageData, categories, accounts] = await Promise.all([
    getAuthenticatedSession(),
    getTransactionPage(queryState),
    getUserCategories(),
    getUserAccounts(),
  ]);

  const canImportCsv = !isDemoRestrictedUserEmail(session?.user.email);
  const canDelete = !isDemoRestrictedUserEmail(session?.user.email);

  return (
    <TransactionsClient
      initialTransactions={pageData.rows}
      totalCount={pageData.totalCount}
      filteredTotals={pageData.filteredTotals}
      initialQueryState={queryState}
      categories={categories}
      accounts={accounts}
      canImportCsv={canImportCsv}
      canDelete={canDelete}
    />
  );
}
