"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { getTransactionProcessingStatus } from "@/lib/actions/transactions";

const POLL_INTERVAL_MS = 1500;
const MAX_WAIT_MS = 60_000;

/**
 * Watches the worker pipeline queued by a deferred transaction create.
 *
 * The row itself is already committed when the create returns, so the screen
 * can show it right away. The category, functional amount, account balance and
 * subscription links are filled in by a Celery worker moments later; this
 * refreshes the route once that finishes so those values appear without the
 * user reloading. Polling stops on completion, on error, after MAX_WAIT_MS, or
 * when the component unmounts.
 */
export function useTransactionProcessingWatcher() {
  const router = useRouter();
  const cancelledRef = React.useRef(false);

  React.useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  return React.useCallback(
    (taskId: string | undefined) => {
      if (!taskId) return;

      const deadline = Date.now() + MAX_WAIT_MS;

      const poll = async () => {
        while (!cancelledRef.current && Date.now() < deadline) {
          await new Promise((resolve) =>
            setTimeout(resolve, POLL_INTERVAL_MS),
          );
          if (cancelledRef.current) return;

          const status = await getTransactionProcessingStatus(taskId);
          if (status.done) {
            if (!cancelledRef.current) router.refresh();
            return;
          }
        }
      };

      void poll();
    },
    [router],
  );
}
