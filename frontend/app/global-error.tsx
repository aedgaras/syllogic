"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error-boundary]", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <html>
      <body
        style={{
          display: "flex",
          height: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <p>Something went wrong.</p>
        {error.digest ? (
          <p style={{ color: "#666", fontSize: "0.875rem" }}>
            Error reference: {error.digest}
          </p>
        ) : null}
        <button onClick={() => reset()}>Retry</button>
      </body>
    </html>
  );
}
