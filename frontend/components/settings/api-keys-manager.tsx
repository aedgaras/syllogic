"use client";
import { t as translate } from "@/i18n/translate";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  RiKeyLine,
  RiAddLine,
  RiDeleteBinLine,
  RiFileCopyLine,
  RiCheckLine,
  RiAlertLine,
} from "@remixicon/react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createApiKey, deleteApiKey } from "@/lib/actions/api-keys";
import { DEMO_RESTRICTED_ACTION_ERROR } from "@/lib/demo-access";
import { stringifyClaudeDesktopMcpConfig } from "@/lib/mcp/claude-desktop-config";

interface ApiKeysManagerProps {
  mcpServerUrl: string;
  canCreateApiKeys: boolean;
  initialKeys: Array<{
    id: string;
    name: string;
    keyPrefix: string;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date | null;
  }>;
}

type ExpirationOption = "never" | "30days" | "90days" | "1year";

function getExpirationDate(option: ExpirationOption): Date | null {
  if (option === "never") return null;
  const now = new Date();
  switch (option) {
    case "30days":
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    case "90days":
      return new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    case "1year":
      return new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}

function formatDate(date: Date | null): string {
  if (!date) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

function formatRelativeTime(date: Date | null): string {
  if (!date) return "Never";
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

function isExpired(date: Date | null): boolean {
  if (!date) return false;
  return new Date(date) < new Date();
}

export function ApiKeysManager({
  initialKeys,
  mcpServerUrl,
  canCreateApiKeys,
}: ApiKeysManagerProps) {
  const router = useRouter();
  const [keys, setKeys] = useState(initialKeys);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [showKeyDialogOpen, setShowKeyDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingKey, setDeletingKey] = useState<(typeof keys)[0] | null>(null);

  // Form state
  const [keyName, setKeyName] = useState("");
  const [expiration, setExpiration] = useState<ExpirationOption>("never");
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Created key state (shown once)
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState<string | null>(null);

  const handleCreateKey = async () => {
    if (!canCreateApiKeys) {
      toast.error(DEMO_RESTRICTED_ACTION_ERROR);
      return;
    }

    if (!keyName.trim()) {
      toast.error(translate("pleaseEnterANameForTheApiKey"));
      return;
    }

    setIsCreating(true);
    try {
      const result = await createApiKey({
        name: keyName.trim(),
        expiresAt: getExpirationDate(expiration),
      });

      if (result.success && result.apiKey && result.keyData) {
        setKeys([
          {
            id: result.keyData.id,
            name: result.keyData.name,
            keyPrefix: result.keyData.keyPrefix,
            lastUsedAt: null,
            expiresAt: result.keyData.expiresAt,
            createdAt: result.keyData.createdAt,
          },
          ...keys,
        ]);
        setCreatedKey(result.apiKey);
        setCreateDialogOpen(false);
        setShowKeyDialogOpen(true);
        setKeyName("");
        setExpiration("never");
        router.refresh();
      } else {
        toast.error(result.error || translate("failedToCreateApiKey"));
      }
    } catch {
      toast.error(translate("anErrorOccurredPleaseTryAgain"));
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteKey = async () => {
    if (!deletingKey) return;

    setIsDeleting(true);
    try {
      const result = await deleteApiKey(deletingKey.id);
      if (result.success) {
        setKeys(keys.filter((k) => k.id !== deletingKey.id));
        toast.success(translate("apiKeyDeleted"));
        router.refresh();
      } else {
        toast.error(result.error || translate("failedToDeleteApiKey"));
      }
    } catch {
      toast.error(translate("anErrorOccurredPleaseTryAgain"));
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setDeletingKey(null);
    }
  };

  const copyToClipboard = async (text: string, target?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setCopiedTarget(target ?? null);
      toast.success(translate("copiedToClipboard"));
      setTimeout(() => {
        setCopied(false);
        setCopiedTarget(null);
      }, 2000);
    } catch {
      toast.error(translate("failedToCopyToClipboard"));
    }
  };

  const configSnippet = createdKey
    ? stringifyClaudeDesktopMcpConfig(createdKey, mcpServerUrl)
    : "";

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{translate("apiKeys")}</CardTitle>
          <CardDescription>
            {translate("connectClaudeToYourFinancialDataUseTheCustom")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Custom connector (OAuth) — web and mobile */}
            <div className="space-y-2 rounded border bg-muted/40 p-3">
              <Label>{translate("claudeOnTheWebIosOrAndroid")}</Label>
              <p className="text-xs text-muted-foreground">
                {translate("inClaudeSettingsOpen")}{" "}
                <strong>{translate("connectorsAddCustomConnector")}</strong>{" "}
                {translate("andPasteThisUrlYouLlBeRedirectedHere")}
              </p>
              <div className="relative min-w-0">
                <pre className="overflow-x-auto rounded bg-background p-3 pr-10 text-xs">
                  {mcpServerUrl}
                </pre>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-2 top-2"
                  onClick={() => copyToClipboard(mcpServerUrl, "mcp-url")}
                >
                  {copied && copiedTarget === "mcp-url" ? (
                    <RiCheckLine className="h-4 w-4 text-success" />
                  ) : (
                    <RiFileCopyLine className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {/* Key list */}
            {keys.length === 0 ? (
              <div className="flex h-24 items-center justify-center rounded border border-dashed">
                <p className="text-sm text-muted-foreground">
                  {translate("noApiKeysYetCreateOneToGetStarted")}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {keys.map((key) => (
                  <div
                    key={key.id}
                    className="flex flex-col gap-3 rounded border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
                        <RiKeyLine className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="break-words text-sm font-medium">
                            {key.name}
                          </p>
                          {isExpired(key.expiresAt) && (
                            <span className="text-xs text-destructive">
                              {translate("expired")}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <code className="rounded bg-muted px-1">
                            {key.keyPrefix}...
                          </code>
                          <span>·</span>
                          <span>
                            {key.lastUsedAt
                              ? translate("lastUsed", {
                                  value1: formatRelativeTime(key.lastUsedAt),
                                })
                              : translate("neverUsed")}
                          </span>
                          <span>·</span>
                          <span>
                            {key.expiresAt
                              ? translate("expires", {
                                  value1: formatDate(key.expiresAt),
                                })
                              : translate("noExpiration")}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="self-end sm:self-auto"
                      onClick={() => {
                        setDeletingKey(key);
                        setDeleteDialogOpen(true);
                      }}
                    >
                      <RiDeleteBinLine className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Create button */}
            {!canCreateApiKeys && (
              <p className="text-sm text-muted-foreground">
                {translate("apiKeyCreationIsDisabledForTheSharedDemo")}
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                if (!canCreateApiKeys) {
                  return;
                }
                setCreateDialogOpen(true);
              }}
              disabled={!canCreateApiKeys}
            >
              <RiAddLine className="mr-2 h-4 w-4" />
              {translate("createApiKey")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Create API Key Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{translate("createApiKey")}</DialogTitle>
            <DialogDescription>
              {translate("createANewApiKeyToAccessYourFinancial")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="key-name">{translate("name")}</Label>
              <Input
                id="key-name"
                placeholder={translate("myApiKey")}
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {translate("aDescriptiveNameToIdentifyThisKey")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="expiration">{translate("expiration")}</Label>
              <Select
                value={expiration}
                onValueChange={(value) =>
                  setExpiration(value as ExpirationOption)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={translate("selectExpiration")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">{translate("never")}</SelectItem>
                  <SelectItem value="30days">
                    {translate("message30Days")}
                  </SelectItem>
                  <SelectItem value="90days">
                    {translate("message90Days")}
                  </SelectItem>
                  <SelectItem value="1year">
                    {translate("message1Year")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateDialogOpen(false)}
            >
              {translate("cancel")}
            </Button>
            <Button onClick={handleCreateKey} disabled={isCreating}>
              {isCreating ? translate("creating") : translate("createKey")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show Created Key Dialog */}
      <Dialog
        open={showKeyDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreatedKey(null);
            setCopied(false);
          }
          setShowKeyDialogOpen(open);
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-w-[calc(100%-2rem)] sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle>{translate("apiKeyCreated")}</DialogTitle>
            <DialogDescription>
              {translate("copyYourApiKeyNowYouWonTBe")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 overflow-hidden">
            <div className="flex items-center gap-2 rounded bg-muted p-3 min-w-0">
              <code className="flex-1 break-all text-xs min-w-0">
                {createdKey}
              </code>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                onClick={() => createdKey && copyToClipboard(createdKey)}
              >
                {copied ? (
                  <RiCheckLine className="h-4 w-4 text-success" />
                ) : (
                  <RiFileCopyLine className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="flex items-start gap-2 rounded border border-warning/30 bg-warning/10 p-3 text-warning">
              <RiAlertLine className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-xs">
                {translate("makeSureToCopyYourApiKeyNowFor")}
              </p>
            </div>
            <div className="space-y-2 min-w-0">
              <Label>{translate("claudeDesktopConfiguration")}</Label>
              <p className="text-xs text-muted-foreground">
                {translate("addThisToYourClaudeDesktopConfigFile")}
              </p>
              <p className="text-xs text-muted-foreground">
                {translate("thisUsesALocal")}{" "}
                <code className="rounded bg-muted px-1 font-mono">
                  {translate("npx")}
                </code>{" "}
                {translate("bridge")}
                {" ("}
                <code className="rounded bg-muted px-1 font-mono">
                  {translate("mcpRemote")}
                </code>
                {") "}
                {translate("toConnectClaudeDesktopToTheRemoteSyllogicMcp")}
              </p>
              <div className="relative min-w-0">
                <pre className="max-h-48 overflow-x-auto overflow-y-auto rounded bg-muted p-3 pr-10 text-xs whitespace-pre">
                  {configSnippet}
                </pre>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-2 top-2"
                  onClick={() => copyToClipboard(configSnippet)}
                >
                  <RiFileCopyLine className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowKeyDialogOpen(false)}>
              {translate("done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{translate("deleteApiKey")}</AlertDialogTitle>
            <AlertDialogDescription>
              {translate("areYouSureYouWantToDelete")}
              {deletingKey?.name}
              {translate("anyApplicationsUsingThisKeyWillNoLongerBe")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{translate("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteKey}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? translate("deleting") : translate("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
