import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Never part of a bot's build inputs, whatever its `.dockerignore` says. */
const ALWAYS_EXCLUDED = ['node_modules', 'dist', '.git', '.DS_Store'];

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped.split('\u0000').join('.*')}$`);
}

/** `.dockerignore`-style patterns (plain paths, `dir/`, `*` and `**` globs; `!` negations and
 * comments are skipped) — the subset needed to exclude what a Dockerfile never copies. */
function parseIgnorePatterns(text: string): RegExp[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('!'))
    .map((line) => line.replace(/^\.\//, '').replace(/\/$/, ''))
    .map(globToRegExp);
}

function isIgnored(relativePath: string, patterns: readonly RegExp[]): boolean {
  const segments = relativePath.split('/');
  if (segments.some((segment) => ALWAYS_EXCLUDED.includes(segment))) return true;
  // A pattern matching any leading directory excludes everything under it.
  for (let i = 1; i <= segments.length; i++) {
    const prefix = segments.slice(0, i).join('/');
    if (patterns.some((pattern) => pattern.test(prefix))) return true;
  }
  return false;
}

async function listFiles(
  root: string,
  dir: string,
  patterns: readonly RegExp[],
): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const relative = dir === '' ? entry.name : `${dir}/${entry.name}`;
    if (isIgnored(relative, patterns)) continue;
    if (entry.isDirectory()) files.push(...(await listFiles(root, relative, patterns)));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

/**
 * SHA-256 over a bot's Docker build inputs: every file in its build context (sorted by path, each
 * path and its bytes) except `.dockerignore`d ones and `node_modules`/`dist`/`.git`. Identical code
 * always hashes identically, unlike the Docker image id, which can change on a rebuild after a
 * cache prune — so this, not the image id, is what a pinned forward match checks on resume.
 */
export async function computeBotSourceSha256(botDir: string, context = '.'): Promise<string> {
  const root = path.resolve(botDir, context);
  let patterns: RegExp[] = [];
  try {
    patterns = parseIgnorePatterns(await readFile(path.join(root, '.dockerignore'), 'utf8'));
  } catch {
    // No .dockerignore — hash the whole context (minus ALWAYS_EXCLUDED).
  }
  const hash = createHash('sha256');
  for (const file of (await listFiles(root, '', patterns)).sort()) {
    hash
      .update(file)
      .update('\0')
      .update(await readFile(path.join(root, file)))
      .update('\0');
  }
  return hash.digest('hex');
}

/** `sha256:...` id of a local Docker image, or `undefined` if Docker can't report it. */
export async function dockerImageId(imageTag: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('docker', [
      'image',
      'inspect',
      '--format',
      '{{.Id}}',
      imageTag,
    ]);
    const id = stdout.trim();
    return id === '' ? undefined : id;
  } catch {
    return undefined;
  }
}

/** SHA-256 of a config's canonical JSON — recorded so a pinned match's stored config can be
 * audited against what it was created with. */
export function configSha256(config: unknown): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}
