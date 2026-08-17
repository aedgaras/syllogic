import type { Instrumentation } from "next";

function errorDetails(error: unknown) {
  if (!(error instanceof Error)) {
    return { value: String(error) };
  }

  const extended = error as Error & {
    code?: unknown;
    digest?: unknown;
    cause?: unknown;
  };

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    code: extended.code,
    digest: extended.digest,
    cause:
      extended.cause instanceof Error
        ? {
            name: extended.cause.name,
            message: extended.cause.message,
            stack: extended.cause.stack,
          }
        : extended.cause,
  };
}

export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context,
) => {
  // Do not log request headers: they can contain session cookies and tokens.
  console.error("[request-error]", {
    method: request.method,
    path: request.path,
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
    error: errorDetails(error),
  });
};
