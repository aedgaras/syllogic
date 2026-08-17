import { SubscriptionsClient } from "@/components/subscriptions/subscriptions-client";
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
    <SubscriptionsClient
      initialSubscriptions={subscriptions}
      accounts={accounts}
      categories={categories}
      suggestions={suggestions}
      kpis={kpis}
    />
  );
}
