import { readFile, writeFile } from 'node:fs/promises';

/** Shared by every Phase B action that generates a new migration file and needs to do the "ONE
 * manual step left" its generating script prints (adding the import + array entry to that
 * package's own `migrations/index.ts`) — see `marketData.ts`'s original, single-purpose version
 * of this, generalized once `research.ts`'s apply-update route needed the identical edit against
 * a different index file. Idempotent: an import statement already present is left alone rather
 * than duplicated, so re-registering the same migration twice is harmless. */
export async function registerMigration(
  indexPath: string,
  importStatement: string,
  exportName: string,
): Promise<void> {
  const source = await readFile(indexPath, 'utf8');
  if (source.includes(importStatement)) return;

  const lines = source.split('\n');
  const lastImportIndex = lines.reduce(
    (acc, line, i) => (line.startsWith('import { migration') ? i : acc),
    -1,
  );
  if (lastImportIndex === -1) {
    throw new Error(`could not find an existing migration import in ${indexPath} to anchor on`);
  }
  lines.splice(lastImportIndex + 1, 0, importStatement);

  const arrayCloseIndex = lines.findIndex((line) => line.trim() === '];');
  if (arrayCloseIndex === -1) {
    throw new Error(`could not find the migrations array's closing "];" in ${indexPath}`);
  }
  lines.splice(arrayCloseIndex, 0, `  ${exportName},`);

  await writeFile(indexPath, lines.join('\n'), 'utf8');
}
