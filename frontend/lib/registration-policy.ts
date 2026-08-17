export type RegistrationPolicyInput = {
  hasUsers: boolean;
  environmentDisabled: boolean;
  databaseEnabled: boolean;
};

export function resolveRegistrationEnabled({
  hasUsers,
  environmentDisabled,
  databaseEnabled,
}: RegistrationPolicyInput): boolean {
  // Never allow a fresh deployment to become permanently locked out.
  if (!hasUsers) return true;
  return !environmentDisabled && databaseEnabled;
}
