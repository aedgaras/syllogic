"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard-error-boundary]", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col items-center justify-center gap-4 p-4 text-center">
      <div className="space-y-1">
        <p className="font-medium">Something went wrong loading this page</p>
        <p className="text-muted-foreground text-sm">
          {error.digest ? `Error reference: ${error.digest}` : null}
        </p>
      </div>
      <Button onClick={() => reset()}>Retry</Button>
    </div>
  );
}
