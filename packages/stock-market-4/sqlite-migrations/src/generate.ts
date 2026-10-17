import { readdirSync } from 'node:fs';

/** The next `NNNN` migration number for `migrationsDir` — one past the highest `NNNN_*.ts` file
 * already there (`index.ts` itself has no leading digits, so the filter already skips it). Shared
 * by every domain's migration-generator script (`research/fusion/scripts/applyResearchUpdate.ts`,
 * `market-data`'s ingestion scripts, ...) so the numbering convention is defined once. */
export function nextMigrationNumber(migrationsDir: string): string {
  const numbered = readdirSync(migrationsDir)
    .map((file) => /^(\d{4})_.+\.ts$/.exec(file))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]));
  const next = numbered.length > 0 ? Math.max(...numbered) + 1 : 1;
  return String(next).padStart(4, '0');
}

/**
 * Escapes `text` so it can be embedded verbatim inside a JS template literal (backtick string)
 * and evaluate back to the EXACT original text. Critical for migration-file generator scripts:
 * generated SQL routinely embeds `JSON.stringify`d data, which itself contains backslash escapes
 * (`\n`, `\"`, ...) — embedded into a raw template literal unescaped, the JS engine would
 * re-interpret those escapes on load (e.g. turning a literal `\n` into an actual newline byte),
 * silently corrupting the stored JSON. Also escapes backticks and `${` for the same reason.
 */
export function escapeForTemplateLiteral(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

/**
 * Renders a whole migration file's TypeScript source — the one place every domain package's
 * migration-generator script produces this shape, so `escapeForTemplateLiteral` is never
 * hand-rolled (or forgotten) per script. `docComment` is inserted as-is, so callers pass a
 * complete `/** ... *\/`-style block already indented for top-level placement.
 */
export function renderMigrationFileSource(options: {
  exportName: string;
  id: string;
  sql: string;
  docComment: string;
}): string {
  const { exportName, id, sql, docComment } = options;
  return `import type { Migration } from '@quant-fusion/sqlite-migrations';

${docComment}
export const ${exportName}: Migration = {
  id: ${JSON.stringify(id)},
  sql: \`
${escapeForTemplateLiteral(sql)}
\`,
};
`;
}
