import { SubscriptionList } from "@/features/subscriptions/public";
import {
  getSubscriptions,
  getSubscriptionKpis,
  getPendingSuggestions,
} from "@/features/subscriptions/server";
import { getUserCategories } from "@/lib/actions/categories";
import { getAccounts } from "@/features/accounts/server";

export async function SubscriptionsSection() {
  const [subscriptions, accounts, categories, suggestions, kpis] =
    await Promise.all([
      getSubscriptions(),
      getAccounts(),
      getUserCategories(),
      getPendingSuggestions(),
      getSubscriptionKpis(),
    ]);

  return (
    <SubscriptionList
      initialSubscriptions={subscriptions}
      accounts={accounts}
      categories={categories}
      suggestions={suggestions}
      kpis={kpis}
    />
  );
}
