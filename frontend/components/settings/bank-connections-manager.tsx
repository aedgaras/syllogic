"use client";
import { t as translate } from "@/i18n/translate";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  RiBankLine,
  RiRefreshLine,
  RiLinkUnlinkM,
  RiAddLine,
  RiAlertLine,
  RiPriceTag3Line,
} from "@remixicon/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  triggerSync,
  disconnectBank,
  triggerRecategorize,
  initiateAuth,
} from "@/lib/actions/bank-connections";
import { fetchBankConnectionStatus } from "@/lib/bank-connections/client";
import { logger } from "@/lib/logger";
type BankConnectionItem = {
  id: string;
  aspspName: string;
  aspspCountry: string;
  status: string;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  consentExpiresAt: Date | null;
  createdAt: Date | null;
};

interface BankConnectionsManagerProps {
  connections: BankConnectionItem[];
}

type SyncProgress = {
  stage: string;
  accounts_done: number;
  accounts_total: number;
  transactions_created: number;
  transactions_updated: number;
  started_at?: string;
};

export function BankConnectionsManager({
  connections,
}: BankConnectionsManagerProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [recategorizingIds, setRecategorizingIds] = useState<Set<string>>(
    new Set(),
  );
  const [disconnectingIds, setDisconnectingIds] = useState<Set<string>>(
    new Set(),
  );
  const [relinkingIds, setRelinkingIds] = useState<Set<string>>(new Set());
  const [relinkError, setRelinkError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pollingIds, setPollingIds] = useState<Set<string>>(new Set());
  const [syncProgress, setSyncProgress] = useState<Map<string, SyncProgress>>(
    new Map(),
  );
  const [elapsedSeconds, setElapsedSeconds] = useState<Map<string, number>>(
    new Map(),
  );
  const pollingTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const elapsedTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const initialSyncTimes = useRef<Map<string, string | null>>(new Map());

  // Cleanup all timers on unmount
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearInterval(clock);
      pollingTimers.current.forEach((timer) => clearTimeout(timer));
      elapsedTimers.current.forEach((timer) => clearInterval(timer));
    };
  }, []);

  const stopPolling = useCallback((connectionId: string) => {
    const timer = pollingTimers.current.get(connectionId);
    if (timer) {
      clearTimeout(timer);
      pollingTimers.current.delete(connectionId);
    }
    const elapsedTimer = elapsedTimers.current.get(connectionId);
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimers.current.delete(connectionId);
    }
    setPollingIds((prev) => {
      const next = new Set(prev);
      next.delete(connectionId);
      return next;
    });
    setSyncingIds((prev) => {
      const next = new Set(prev);
      next.delete(connectionId);
      return next;
    });
    setSyncProgress((prev) => {
      const next = new Map(prev);
      next.delete(connectionId);
      return next;
    });
    setElapsedSeconds((prev) => {
      const next = new Map(prev);
      next.delete(connectionId);
      return next;
    });
  }, []);

  const startPolling = useCallback(
    (connectionId: string, currentLastSyncedAt: string | null) => {
      initialSyncTimes.current.set(connectionId, currentLastSyncedAt);
      setPollingIds((prev) => new Set([...prev, connectionId]));

      // Start elapsed seconds ticker (clear any stale one first)
      const existingElapsed = elapsedTimers.current.get(connectionId);
      if (existingElapsed) clearInterval(existingElapsed);
      setElapsedSeconds((prev) => new Map(prev).set(connectionId, 0));
      const elapsedInterval = setInterval(() => {
        setElapsedSeconds((prev) => {
          const next = new Map(prev);
          next.set(connectionId, (next.get(connectionId) ?? 0) + 1);
          return next;
        });
      }, 1000);
      elapsedTimers.current.set(connectionId, elapsedInterval);

      let elapsed = 0;
      const poll = async () => {
        elapsed += 3000;
        if (elapsed > 600000) {
          stopPolling(connectionId);
          return;
        }

        try {
          const data = await queryClient.fetchQuery({
            queryKey: ["enable-banking", "status", connectionId],
            queryFn: () => fetchBankConnectionStatus(connectionId),
            staleTime: 0,
          });

          const syncProgressValue = data.sync_progress;
          if (syncProgressValue) {
            setSyncProgress((prev) =>
              new Map(prev).set(connectionId, syncProgressValue),
            );
          }

          const startedAt = initialSyncTimes.current.get(connectionId);
          if (data.last_synced_at && data.last_synced_at !== startedAt) {
            stopPolling(connectionId);
            router.refresh();
            return;
          }

          if (data.last_sync_error) {
            stopPolling(connectionId);
            router.refresh();
            return;
          }
        } catch {
          // Network error, keep polling
        }

        const timer = setTimeout(poll, 3000);
        pollingTimers.current.set(connectionId, timer);
      };

      const timer = setTimeout(poll, 3000);
      pollingTimers.current.set(connectionId, timer);
    },
    [queryClient, router, stopPolling],
  );

  // Auto-detect connections that are active but have never synced (initial sync after wizard)
  useEffect(() => {
    for (const conn of connections) {
      if (
        conn.status === "active" &&
        !conn.lastSyncedAt &&
        !pollingIds.has(conn.id)
      ) {
        startPolling(conn.id, null);
        setSyncingIds((prev) => new Set([...prev, conn.id]));
      }
    }
  }, [connections, pollingIds, startPolling]);

  const handleSync = async (connectionId: string) => {
    setSyncingIds((prev) => new Set(prev).add(connectionId));

    const conn = connections.find((c) => c.id === connectionId);
    const currentLastSyncedAt = conn?.lastSyncedAt?.toISOString() || null;

    try {
      const result = await triggerSync(connectionId);
      if (!result.success) {
        logger.error("Sync failed", { error: result.error });
        setSyncingIds((prev) => {
          const next = new Set(prev);
          next.delete(connectionId);
          return next;
        });
        return;
      }
      startPolling(connectionId, currentLastSyncedAt);
    } catch {
      setSyncingIds((prev) => {
        const next = new Set(prev);
        next.delete(connectionId);
        return next;
      });
    }
  };

  const handleRecategorize = async (connectionId: string) => {
    setRecategorizingIds((prev) => new Set(prev).add(connectionId));
    try {
      const result = await triggerRecategorize(connectionId);
      if (!result.success) {
        logger.error("Re-categorization failed", { error: result.error });
      }
    } finally {
      setRecategorizingIds((prev) => {
        const next = new Set(prev);
        next.delete(connectionId);
        return next;
      });
    }
  };

  const handleDisconnect = async (connectionId: string) => {
    setDisconnectingIds((prev) => new Set(prev).add(connectionId));
    try {
      const result = await disconnectBank(connectionId);
      if (!result.success) {
        logger.error("Disconnect failed", { error: result.error });
      }
      router.refresh();
    } finally {
      setDisconnectingIds((prev) => {
        const next = new Set(prev);
        next.delete(connectionId);
        return next;
      });
    }
  };

  const handleRelink = async (connection: BankConnectionItem) => {
    setRelinkError(null);
    setRelinkingIds((prev) => new Set(prev).add(connection.id));
    try {
      const result = await initiateAuth(
        connection.aspspName,
        connection.aspspCountry,
        connection.id,
      );
      if (result.success && result.url) {
        window.location.assign(result.url);
        return;
      }
      setRelinkError(result.error || translate("failedToRenewBankConsent"));
    } catch {
      setRelinkError(translate("failedToRenewBankConsentPleaseTryAgain"));
    }
    setRelinkingIds((prev) => {
      const next = new Set(prev);
      next.delete(connection.id);
      return next;
    });
  };

  const isConsentExpired = (connection: BankConnectionItem) =>
    connection.status === "expired" ||
    (!!connection.consentExpiresAt &&
      connection.consentExpiresAt.getTime() <= now);

  const getStatusBadge = (connection: BankConnectionItem) => {
    if (isConsentExpired(connection)) {
      return <Badge variant="destructive">{translate("consentExpired")}</Badge>;
    }
    switch (connection.status) {
      case "active":
        return <Badge variant="default">{translate("active")}</Badge>;
      case "error":
        return <Badge variant="destructive">{translate("error")}</Badge>;
      case "disconnected":
        return <Badge variant="secondary">{translate("disconnected")}</Badge>;
      default:
        return <Badge variant="secondary">{connection.status}</Badge>;
    }
  };

  const isConsentExpiringSoon = (connection: BankConnectionItem) => {
    if (!connection.consentExpiresAt) return false;
    const daysUntilExpiry = Math.ceil(
      (connection.consentExpiresAt.getTime() - now) / (1000 * 60 * 60 * 24),
    );
    return daysUntilExpiry <= 14 && daysUntilExpiry > 0;
  };

  const consentTimeRemaining = (connection: BankConnectionItem) => {
    if (!connection.consentExpiresAt) return null;
    const milliseconds = connection.consentExpiresAt.getTime() - now;
    if (milliseconds <= 0) return "expired";
    const minutes = Math.max(1, Math.ceil(milliseconds / 60_000));
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
    const hours = Math.ceil(minutes / 60);
    if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
    const days = Math.ceil(hours / 24);
    return `${days} day${days === 1 ? "" : "s"}`;
  };

  const activeConnections = connections.filter(
    (c) => c.status !== "disconnected",
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            {translate("bankConnections")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {translate("connectYourBankAccountsViaOpenBankingToAutomatically")}
          </p>
        </div>
        <Link
          href="/settings/connect-bank"
          className={buttonVariants({ variant: "default", size: "default" })}
        >
          <RiAddLine className="mr-1.5 h-4 w-4" />
          {translate("connectBank")}
        </Link>
      </div>

      {relinkError && (
        <div className="flex items-center gap-2 rounded-none border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
          <RiAlertLine className="h-4 w-4 shrink-0" />
          <span>{relinkError}</span>
        </div>
      )}

      {activeConnections.length === 0 ? (
        <div className="rounded-none border border-dashed p-8 text-center">
          <RiBankLine className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            {translate("noBankConnectionsYetConnectABankToStart")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeConnections.map((connection) => (
            <div key={connection.id} className="rounded-none border p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <RiBankLine className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="break-words font-medium">
                        {connection.aspspName}
                      </span>
                      {getStatusBadge(connection)}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{connection.aspspCountry}</span>
                      {connection.lastSyncedAt && (
                        <>
                          <span>·</span>
                          <span>
                            {translate("lastSynced")}{" "}
                            {new Date(
                              connection.lastSyncedAt,
                            ).toLocaleDateString()}
                          </span>
                        </>
                      )}
                    </div>
                    {connection.consentExpiresAt &&
                      !isConsentExpired(connection) && (
                        <div
                          className={`mt-1 flex items-center gap-1 text-xs ${
                            isConsentExpiringSoon(connection)
                              ? "text-warning"
                              : "text-muted-foreground"
                          }`}
                          title={translate("consentExpires", {
                            value1:
                              connection.consentExpiresAt.toLocaleString(),
                          })}
                        >
                          <RiAlertLine className="h-3 w-3" />
                          <span>
                            {translate("bankConsentExpiresIn")}{" "}
                            {consentTimeRemaining(connection)}.
                          </span>
                        </div>
                      )}
                    {isConsentExpired(connection) && (
                      <div className="mt-1 flex items-center gap-1 text-xs text-destructive">
                        <RiAlertLine className="h-3 w-3" />
                        <span>
                          {translate(
                            "bankConsentExpiredRenewItToResumeSyncing",
                          )}
                        </span>
                      </div>
                    )}
                    {connection.lastSyncError &&
                      connection.status === "error" && (
                        <p className="mt-1 text-xs text-destructive">
                          {connection.lastSyncError}
                        </p>
                      )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(isConsentExpired(connection) ||
                    isConsentExpiringSoon(connection)) && (
                    <Button
                      variant={
                        isConsentExpired(connection) ? "default" : "outline"
                      }
                      size="sm"
                      onClick={() => handleRelink(connection)}
                      disabled={relinkingIds.has(connection.id)}
                    >
                      <RiRefreshLine
                        className={`mr-1.5 h-4 w-4 ${
                          relinkingIds.has(connection.id) ? "animate-spin" : ""
                        }`}
                      />
                      {relinkingIds.has(connection.id)
                        ? translate("openingBank")
                        : translate("renewConsent")}
                    </Button>
                  )}
                  {connection.status === "active" &&
                    !isConsentExpired(connection) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSync(connection.id)}
                        disabled={syncingIds.has(connection.id)}
                      >
                        <RiRefreshLine
                          className={`mr-1.5 h-4 w-4 ${
                            syncingIds.has(connection.id) ? "animate-spin" : ""
                          }`}
                        />
                        {syncingIds.has(connection.id)
                          ? translate("syncinge5c772")
                          : translate("syncNow")}
                      </Button>
                    )}
                  {connection.status === "active" &&
                    !isConsentExpired(connection) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRecategorize(connection.id)}
                        disabled={recategorizingIds.has(connection.id)}
                      >
                        <RiPriceTag3Line
                          className={`mr-1.5 h-4 w-4 ${
                            recategorizingIds.has(connection.id)
                              ? "animate-spin"
                              : ""
                          }`}
                        />
                        {recategorizingIds.has(connection.id)
                          ? translate("reCategorizing")
                          : translate("fixCategories")}
                      </Button>
                    )}
                  <AlertDialog>
                    <AlertDialogTrigger
                      disabled={disconnectingIds.has(connection.id)}
                      render={
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={disconnectingIds.has(connection.id)}
                        >
                          <RiLinkUnlinkM className="mr-1.5 h-4 w-4" />
                          {translate("disconnect")}
                        </Button>
                      }
                    />
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {translate("disconnect")} {connection.aspspName}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {translate("thisWillRevokeAccessToYourBankDataYour")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>
                          {translate("cancel")}
                        </AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDisconnect(connection.id)}
                        >
                          {translate("disconnect")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
              {syncingIds.has(connection.id) && (
                <div className="mt-3 space-y-1.5">
                  <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      {(() => {
                        const progress = syncProgress.get(connection.id);
                        if (progress && progress.accounts_total > 0) {
                          return `Syncing account ${progress.accounts_done} of ${progress.accounts_total} · ${progress.transactions_created} transactions imported`;
                        }
                        return "Preparing sync...";
                      })()}
                    </span>
                    <span>
                      {elapsedSeconds.get(connection.id) ?? 0}
                      {translate("sElapsed")}
                    </span>
                  </div>
                  <Progress
                    value={(() => {
                      const progress = syncProgress.get(connection.id);
                      if (progress && progress.accounts_total > 0) {
                        return (
                          (progress.accounts_done / progress.accounts_total) *
                          100
                        );
                      }
                      return 0;
                    })()}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
