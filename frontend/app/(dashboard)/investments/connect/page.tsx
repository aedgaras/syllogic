import { t as translate } from "@/i18n/translate";
import { redirect } from "next/navigation";
import { listInvestmentAccounts } from "@/lib/api/investments";
import { getUserAccounts } from "@/lib/actions/dashboard";
import { INVESTMENT_ACCOUNT_TYPES } from "@/lib/constants/account-types";
import { Header } from "@/components/layout/header";
import { ManualForm } from "@/components/investments/ManualForm";
import { getCurrentUserProfile } from "@/lib/actions/settings";
import { isDemoRestrictedUserEmail } from "@/lib/demo-access";

export const dynamic = "force-dynamic";

export default async function ConnectPage() {
  const user = await getCurrentUserProfile();
  if (!user) redirect("/login");
  if (isDemoRestrictedUserEmail(user.email)) redirect("/investments");

  const [accounts, allAccounts] = await Promise.all([
    listInvestmentAccounts(),
    getUserAccounts(),
  ]);
  const fundingAccounts = allAccounts
    .filter((a) => !INVESTMENT_ACCOUNT_TYPES.has(a.accountType))
    .map((a) => ({ id: a.id, name: a.name, currency: a.currency }));

  return (
    <>
      <Header title={translate("connectInvestments")} />
      <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
        <div className="p-8 max-w-3xl space-y-5">
          <ManualForm
            accounts={accounts}
            fundingAccounts={fundingAccounts}
            onCancel={undefined}
          />
        </div>
      </div>
    </>
  );
}
