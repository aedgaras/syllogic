"use client";
import { t as translate } from "@/i18n/translate";


import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  RiUserLine,
  RiFolderLine,
  RiKeyLine,
  RiUploadLine,
  RiBankLine,
  RiGroupLine,
  RiSettings4Line,
  RiLockLine,
} from "@remixicon/react";
import { ProfileEditor } from "./profile-editor";
import { CategoryManager } from "./category-manager";
import { ApiKeysManager } from "./api-keys-manager";
import { ImportHistoryManager } from "./import-history-manager";
import { BankConnectionsManager } from "./bank-connections-manager";
import { HouseholdTab } from "./household-tab";
import { PreferencesTab } from "./preferences-tab";
import type { SettingsCategory, SettingsUser } from "@/features/settings/public";
import type { CsvImportWithStats } from "@/features/csv-import/public";
import type { OpenAiSettings } from "@/lib/actions/settings";
import type { OidcAdminSettings } from "@/lib/oidc-settings";
import type { RegistrationStatus } from "@/lib/registration-settings";
import { AuthenticationTab } from "./authentication-tab";

type Person = {
  id: string;
  name: string;
  kind: string;
  color?: string | null;
  avatarUrl?: string | null;
};

interface SettingsTabsProps {
  user: SettingsUser;
  categories: SettingsCategory[];
  mcpServerUrl: string;
  canCreateApiKeys: boolean;
  canDelete?: boolean;
  isDemoUser?: boolean;
  defaultTab?: string;
  apiKeys: Array<{
    id: string;
    name: string;
    keyPrefix: string;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date | null;
  }>;
  csvImports: CsvImportWithStats[];
  bankConnections: Array<{
    id: string;
    aspspName: string;
    aspspCountry: string;
    status: string;
    lastSyncedAt: Date | null;
    lastSyncError: string | null;
    consentExpiresAt: Date | null;
    createdAt: Date | null;
  }>;
  people: Person[];
  openAiSettings: OpenAiSettings & { error?: string };
  isAdmin?: boolean;
  oidcSettings?: OidcAdminSettings & { error?: string };
  signupSettings?: RegistrationStatus & { error?: string };
  oidcCallbackUrl?: string;
}

export function SettingsTabs({
  user,
  categories,
  apiKeys,
  mcpServerUrl,
  canCreateApiKeys,
  canDelete = true,
  isDemoUser = false,
  defaultTab = "profile",
  csvImports,
  bankConnections,
  people,
  openAiSettings,
  isAdmin = false,
  oidcSettings,
  signupSettings,
  oidcCallbackUrl = "/api/auth/oauth2/callback/oidc",
}: SettingsTabsProps) {
  return (
    <Tabs defaultValue={defaultTab} className="flex-1">
      <TabsList variant="line" className="mb-6 w-full">
        <TabsTrigger value="profile" data-walkthrough="walkthrough-profile">
          <RiUserLine className="mr-1.5 h-4 w-4" />
          {translate("profile")}
        </TabsTrigger>
        <TabsTrigger value="categories" data-walkthrough="walkthrough-categories">
          <RiFolderLine className="mr-1.5 h-4 w-4" />
          {translate("categories")}
        </TabsTrigger>
        <TabsTrigger value="api-keys" data-walkthrough="walkthrough-api-keys">
          <RiKeyLine className="mr-1.5 h-4 w-4" />
          {translate("apiKeys")}
        </TabsTrigger>
        <TabsTrigger value="import-history" data-walkthrough="walkthrough-import-history">
          <RiUploadLine className="mr-1.5 h-4 w-4" />
          {translate("importHistory")}
        </TabsTrigger>
        {!isDemoUser && (
          <TabsTrigger value="bank-connections">
            <RiBankLine className="mr-1.5 h-4 w-4" />
            {translate("bankConnections")}
          </TabsTrigger>
        )}
        <TabsTrigger value="household">
          <RiGroupLine className="mr-1.5 h-4 w-4" />
          {translate("household")}
        </TabsTrigger>
        <TabsTrigger value="preferences">
          <RiSettings4Line className="mr-1.5 h-4 w-4" />
          {translate("preferences")}
        </TabsTrigger>
        {isAdmin && (
          <TabsTrigger value="authentication">
            <RiLockLine className="mr-1.5 h-4 w-4" />
            {translate("authentication")}
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="profile">
        <ProfileEditor user={user} />
      </TabsContent>

      <TabsContent value="categories">
        <CategoryManager initialCategories={categories} />
      </TabsContent>

      <TabsContent value="api-keys">
        <ApiKeysManager
          initialKeys={apiKeys}
          mcpServerUrl={mcpServerUrl}
          canCreateApiKeys={canCreateApiKeys}
        />
      </TabsContent>

      <TabsContent value="import-history">
        <ImportHistoryManager initialImports={csvImports} canDelete={canDelete} />
      </TabsContent>

      {!isDemoUser && (
        <TabsContent value="bank-connections">
          <BankConnectionsManager connections={bankConnections} />
        </TabsContent>
      )}

      <TabsContent value="household">
        <HouseholdTab people={people} />
      </TabsContent>

      <TabsContent value="preferences">
        <PreferencesTab initialOpenAiSettings={openAiSettings} />
      </TabsContent>

      {isAdmin && oidcSettings && signupSettings && (
        <TabsContent value="authentication">
          <AuthenticationTab
            initialSettings={oidcSettings}
            initialSignupSettings={signupSettings}
            callbackUrl={oidcCallbackUrl}
          />
        </TabsContent>
      )}
    </Tabs>
  );
}
