"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  parseImportStatusEvent,
  type ImportCompletedEvent,
  type ImportFailedEvent,
  type ImportProgressEvent,
  type ImportStartedEvent,
  type ImportStatusEvent,
  type SubscriptionsCompletedEvent,
  type SubscriptionsStartedEvent,
} from "../domain/import-status-events";
import {
  importStatusReducer,
  initialImportStatusState,
} from "../domain/import-status-reducer";

export interface UseImportStatusOptions {
  onStarted?: (event: ImportStartedEvent) => void;
  onProgress?: (event: ImportProgressEvent) => void;
  onCompleted?: (event: ImportCompletedEvent) => void;
  onFailed?: (event: ImportFailedEvent) => void;
  onSubscriptionsStarted?: (event: SubscriptionsStartedEvent) => void;
  onSubscriptionsCompleted?: (event: SubscriptionsCompletedEvent) => void;
  onEvent?: (event: ImportStatusEvent) => void;
}

export function useImportStatus(
  userId: string | null | undefined,
  importId: string | null | undefined,
  options: UseImportStatusOptions = {},
) {
  const [state, dispatch] = useReducer(
    importStatusReducer,
    initialImportStatusState,
  );
  const [isConnected, setIsConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);
  const disconnect = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    setIsConnected(false);
  }, []);

  useEffect(() => {
    if (!userId || !importId) return;
    const source = new EventSource(`/api/events/import-status/${importId}`);
    sourceRef.current = source;
    source.onopen = () => setIsConnected(true);
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) setIsConnected(false);
    };
    const names: ImportStatusEvent["type"][] = [
      "import_started",
      "import_progress",
      "import_completed",
      "import_failed",
      "subscriptions_started",
      "subscriptions_completed",
    ];
    const listeners = names.map((name) => {
      const listener = (message: Event) => {
        const event = parseImportStatusEvent(
          (message as MessageEvent<string>).data,
        );
        if (!event || event.type !== name) return;
        dispatch(event);
        const callbacks = optionsRef.current;
        callbacks.onEvent?.(event);
        if (event.type === "import_started") callbacks.onStarted?.(event);
        if (event.type === "import_progress") callbacks.onProgress?.(event);
        if (event.type === "import_completed") callbacks.onCompleted?.(event);
        if (event.type === "import_failed") callbacks.onFailed?.(event);
        if (event.type === "subscriptions_started")
          callbacks.onSubscriptionsStarted?.(event);
        if (event.type === "subscriptions_completed")
          callbacks.onSubscriptionsCompleted?.(event);
        if (
          event.type === "import_failed" ||
          event.type === "subscriptions_completed"
        )
          disconnect();
      };
      source.addEventListener(name, listener);
      return [name, listener] as const;
    });
    source.addEventListener("heartbeat", () => undefined);
    return () => {
      for (const [name, listener] of listeners)
        source.removeEventListener(name, listener);
      source.close();
      if (sourceRef.current === source) sourceRef.current = null;
    };
  }, [disconnect, importId, userId]);
  const visibleState = userId && importId ? state : initialImportStatusState;
  return {
    ...visibleState,
    isConnected: Boolean(userId && importId && isConnected),
    disconnect,
  };
}

export type {
  ImportCompletedEvent,
  ImportFailedEvent,
  ImportProgressEvent,
  ImportStartedEvent,
  ImportStatusEvent,
  SubscriptionsCompletedEvent,
  SubscriptionsStartedEvent,
} from "../domain/import-status-events";
