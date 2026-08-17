import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const sourceRoots = ["app", "components", "features", "emails"];
const visibleAttributes = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "description",
  "emptyMessage",
  "helperText",
  "label",
  "placeholder",
  "subtitle",
  "title",
  "tooltip",
]);
const findings = [];

function isUserFacingText(value) {
  const text = value.trim().replace(/\s+/g, " ");
  return text.length > 1 && /[A-Za-z]/.test(text) && !/^https?:\/\//.test(text);
}

function collectFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "api") return [];
      return collectFiles(target);
    }
    if (
      !entry.name.endsWith(".tsx") ||
      /(?:\.test|\.spec|\.characterization)\.tsx$/.test(entry.name)
    )
      return [];
    return [target];
  });
}

for (const file of sourceRoots.flatMap((directory) =>
  collectFiles(path.join(root, directory)),
)) {
  const source = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  function report(node, text) {
    const location = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    findings.push(
      `${path.relative(root, file)}:${location.line + 1}:${location.character + 1} ${JSON.stringify(text.trim().replace(/\s+/g, " "))}`,
    );
  }

  function visit(node) {
    if (ts.isJsxText(node) && isUserFacingText(node.getText(sourceFile))) {
      report(node, node.getText(sourceFile));
    }
    if (
      ts.isJsxAttribute(node) &&
      visibleAttributes.has(node.name.getText(sourceFile)) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      isUserFacingText(node.initializer.text)
    ) {
      report(node.initializer, node.initializer.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

if (findings.length) {
  console.error("Found user-facing text outside the locale catalog:\n");
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log("No untranslated JSX copy found.");
}
