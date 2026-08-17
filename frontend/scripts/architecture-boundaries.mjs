import path from "node:path";

const normalizePath = (filePath) => filePath.split(path.sep).join("/");

const isFeatureServerImport = (source) =>
  /^@\/features\/[^/]+\/server(?:\/|$)/.test(source) ||
  /(?:^|\/)server(?:\/|$)/.test(source);

export function boundaryViolations(filePath, source, isClientModule) {
  const file = normalizePath(filePath);
  const violations = [];
  const add = (rule, message) => violations.push({ rule, message });

  if (/^features\/[^/]+\/domain\//.test(file)) {
    if (/^(react(?:\/|$)|next(?:\/|$)|drizzle-orm(?:\/|$)|@\/lib\/actions(?:\/|$))/.test(source)) {
      add("domain-dependencies", "Domain modules must remain framework and infrastructure independent.");
    }
  }

  if (/^features\/[^/]+\/components\//.test(file)) {
    if (
      source === "next/navigation" ||
      source === "sonner" ||
      /^@\/lib\/(?:db|actions)(?:\/|$)/.test(source) ||
      isFeatureServerImport(source)
    ) {
      add("presentation-dependencies", "Presentation modules may only receive data and intent callbacks.");
    }
  }

  if (isClientModule && /^@\/lib\/db(?:\/|$)/.test(source)) {
    add("client-db-import", "Client modules must use explicit feature contracts instead of database types.");
  }

  if (/^(?:shared\/|components\/ui\/)/.test(file) && /^@\/features(?:\/|$)/.test(source)) {
    add("shared-feature-import", "Shared modules and UI primitives must not depend on features.");
  }

  return violations;
}

export function isClientSource(text) {
  return /^\s*["']use client["'];?/m.test(text.slice(0, 300));
}

export function domainBrowserApiViolations(filePath, text) {
  const file = normalizePath(filePath);
  if (!/^features\/[^/]+\/domain\//.test(file)) return [];
  const browserGlobals = ["window", "document", "navigator", "localStorage", "sessionStorage", "EventSource", "FileReader"];
  return browserGlobals
    .filter((name) => new RegExp(`\\b${name}\\b`).test(text))
    .map((name) => ({ rule: "domain-browser-api", source: `<global:${name}>` }));
}
