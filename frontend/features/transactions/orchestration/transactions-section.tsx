import { getUserCategories } from "@/lib/actions/categories";
import { getUserAccounts } from "@/lib/actions/transactions";
import { getAuthenticatedSession } from "@/lib/auth-helpers";
import { isDemoRestrictedUserEmail } from "@/lib/demo-access";
import type { TransactionsQueryState } from "../public";
import { getTransactionPage } from "../server";
import { TransactionsScreen } from "./transactions-screen";

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
  const allowed = !isDemoRestrictedUserEmail(session?.user.email);

  return (
    <TransactionsScreen
      initialTransactions={pageData.rows}
      totalCount={pageData.totalCount}
      filteredTotals={pageData.filteredTotals}
      initialQueryState={queryState}
      categories={categories}
      accounts={accounts}
      canImportCsv={allowed}
      canDelete={allowed}
    />
  );
}
