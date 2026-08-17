// Cross-feature boundary: transaction UI supplies only transaction identifiers;
// subscription server actions own detection, creation, linking, and invalidation.
export {
  createSubscriptionFromTransaction,
  detectSubscriptionFromTransaction,
  linkTransactionToSubscription,
  unlinkTransactionFromSubscription,
} from "@/lib/actions/subscriptions";
