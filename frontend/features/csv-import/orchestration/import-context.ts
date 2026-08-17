import type { ColumnMapping, ImportContext } from "../domain/contracts";
import { sanitizeMappingForContext } from "../domain/workflow";

export interface ImportContextPolicy {
  context: ImportContext;
  rootPath: string;
  mappingPath: (importId: string) => string;
  previewPath: (importId: string) => string;
  uploadBackPath: string;
  completionPath: (importId: string) => string | null;
  sanitizeMapping: (mapping: ColumnMapping) => ColumnMapping;
}

const policies: Record<ImportContext, ImportContextPolicy> = {
  dashboard: {
    context: "dashboard",
    rootPath: "/transactions/import",
    mappingPath: (id) => `/transactions/import/mapping?id=${id}`,
    previewPath: (id) => `/transactions/import/preview?id=${id}`,
    uploadBackPath: "/transactions",
    completionPath: (id) => `/transactions?importing=${id}`,
    sanitizeMapping: (mapping) =>
      sanitizeMappingForContext(mapping, "dashboard"),
  },
  onboarding: {
    context: "onboarding",
    rootPath: "/step-4",
    mappingPath: (id) => `/step-4/mapping?id=${id}`,
    previewPath: (id) => `/step-4/preview?id=${id}`,
    uploadBackPath: "/step-3",
    completionPath: () => null,
    sanitizeMapping: (mapping) =>
      sanitizeMappingForContext(mapping, "onboarding"),
  },
};

export function getImportContextPolicy(
  context: ImportContext,
): ImportContextPolicy {
  return policies[context];
}
