import { redirect } from "next/navigation";
import { RegisterFormWithFallback } from "./register-form";
import { getRegistrationStatus } from "@/lib/registration-settings";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const registration = await getRegistrationStatus();
  if (!registration.enabled) {
    redirect("/login?registration=disabled");
  }

  return (
    <RegisterFormWithFallback
      firstUserWillBeAdmin={registration.firstUserWillBeAdmin}
    />
  );
}
