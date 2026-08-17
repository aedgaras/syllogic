import { boundaryViolations, isClientSource } from "../scripts/architecture-boundaries.mjs";

const architectureBoundaries = {
  meta: {
    type: "problem",
    docs: { description: "enforce frontend architecture dependency direction" },
    schema: [],
  },
  create(context) {
    const filename = context.filename.replace(`${process.cwd()}/`, "");
    const clientModule = isClientSource(context.sourceCode.text);

    const inspect = (node) => {
      const source = node.source?.value;
      if (typeof source !== "string") return;

      for (const violation of boundaryViolations(filename, source, clientModule)) {
        context.report({ node, message: `[${violation.rule}] ${violation.message}` });
      }
    };

    return {
      ImportDeclaration: inspect,
      ExportNamedDeclaration: inspect,
      ExportAllDeclaration: inspect,
    };
  },
};

const plugin = { rules: { boundaries: architectureBoundaries } };

export default plugin;
