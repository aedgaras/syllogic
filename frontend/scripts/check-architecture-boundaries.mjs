import fs from "node:fs";
import path from "node:path";
import {
  boundaryViolations,
  domainBrowserApiViolations,
  isClientSource,
} from "./architecture-boundaries.mjs";

const root = process.cwd();
const baselinePath = path.join(root, "architecture-boundaries-baseline.json");
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const ignoredDirectories = new Set([
  ".git",
  ".next",
  "node_modules",
  "test-results",
]);
const importPattern =
  /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;

function sourceFiles(directory, relative = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const nextRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (
        ignoredDirectories.has(entry.name) ||
        nextRelative.startsWith(`scripts${path.sep}__fixtures__`)
      )
        return [];
      return sourceFiles(path.join(directory, entry.name), nextRelative);
    }
    return extensions.has(path.extname(entry.name)) ? [nextRelative] : [];
  });
}

function scan(files) {
  const findings = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    const clientModule = isClientSource(text);
    for (const match of text.matchAll(importPattern)) {
      for (const violation of boundaryViolations(
        file,
        match[1],
        clientModule,
      )) {
        findings.push({
          file: file.split(path.sep).join("/"),
          source: match[1],
          rule: violation.rule,
        });
      }
    }
    for (const violation of domainBrowserApiViolations(file, text)) {
      findings.push({
        file: file.split(path.sep).join("/"),
        source: violation.source,
        rule: violation.rule,
      });
    }
  }
  return findings.sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
}

function signature(finding) {
  return `${finding.rule}|${finding.file}|${finding.source}`;
}

function verifyFixture() {
  const fixtureRoot = path.join(
    root,
    "scripts",
    "__fixtures__",
    "architecture-boundaries",
  );
  const fixtureFiles = [
    "features/example/domain/invalid.ts.txt",
    "features/example/components/invalid.tsx.txt",
    "components/invalid-client.tsx.txt",
    "shared/client/invalid.ts.txt",
  ];
  const caught = new Set();
  for (const fixtureFile of fixtureFiles) {
    const fixturePath = path.join(fixtureRoot, fixtureFile);
    const text = fs.readFileSync(fixturePath, "utf8");
    const virtualPath = fixtureFile
      .replace(/\.txt$/, "")
      .split(path.sep)
      .join("/");
    for (const match of text.matchAll(importPattern)) {
      for (const item of boundaryViolations(
        virtualPath,
        match[1],
        isClientSource(text),
      ))
        caught.add(item.rule);
    }
    for (const item of domainBrowserApiViolations(virtualPath, text))
      caught.add(item.rule);
  }
  const expected = [
    "domain-dependencies",
    "domain-browser-api",
    "presentation-dependencies",
    "client-db-import",
    "shared-feature-import",
  ];
  const missed = expected.filter((rule) => !caught.has(rule));
  if (missed.length)
    throw new Error(`Boundary fixture was not rejected: ${missed.join(", ")}`);
}

verifyFixture();
const findings = scan(sourceFiles(root));

if (process.argv.includes("--print-baseline")) {
  process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`);
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const allowed = new Set(baseline.map(signature));
const newFindings = findings.filter(
  (finding) => !allowed.has(signature(finding)),
);

if (newFindings.length) {
  console.error("New frontend architecture boundary violations:");
  for (const finding of newFindings) {
    console.error(`- ${finding.file}: ${finding.source} (${finding.rule})`);
  }
  process.exit(1);
}

console.log(
  `Architecture boundaries passed (${findings.length} legacy violation${findings.length === 1 ? "" : "s"} allowlisted).`,
);
