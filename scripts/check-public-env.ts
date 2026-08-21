import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * CI secret gate (`SENS-SEC-014`).
 *
 * Two checks:
 *   1. No `NEXT_PUBLIC_` variable whose name suggests a secret appears anywhere in the source.
 *   2. If a production build exists, no value from the server-only environment schema has
 *      leaked into a client chunk.
 *
 * The second check is the one that matters: a secret can reach the client through a transitive
 * import without any `NEXT_PUBLIC_` name being involved.
 */

const root = process.cwd();
const problems: string[] = [];

const SECRET_NAME = /(SECRET|TOKEN|KEY|PASSWORD|SALT|CREDENTIAL)/;

function walk(dir: string, extensions: string[], onFile: (path: string) => void): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      walk(full, extensions, onFile);
      continue;
    }
    if (extensions.some((extension) => entry.endsWith(extension))) onFile(full);
  }
}

walk(join(root, "src"), [".ts", ".tsx"], (path) => {
  const content = readFileSync(path, "utf8");
  for (const match of content.match(/NEXT_PUBLIC_[A-Z0-9_]+/g) ?? []) {
    if (SECRET_NAME.test(match)) {
      problems.push(`${relative(root, path).split(sep).join("/")} declares ${match}`);
    }
  }
});

// Secret values from the local environment must never appear in a built client chunk.
const secretValues = [process.env["AUTH_SECRET"], process.env["ABUSE_HASH_SALT"]].filter(
  (value): value is string => typeof value === "string" && value.length >= 16,
);

let scannedChunks = 0;
if (secretValues.length > 0) {
  walk(join(root, ".next", "static"), [".js"], (path) => {
    scannedChunks += 1;
    const content = readFileSync(path, "utf8");
    for (const secret of secretValues) {
      if (content.includes(secret)) {
        problems.push(`${relative(root, path).split(sep).join("/")} contains a server secret`);
      }
    }
  });
}

if (problems.length === 0) {
  console.log(
    `[secrets] ok — source clean, ${scannedChunks} client chunk(s) scanned` +
      (scannedChunks === 0 ? " (build first for full coverage)" : ""),
  );
  process.exit(0);
}

console.error(`[secrets] ${problems.length} problem(s):`);
for (const problem of problems) console.error(`  - ${problem}`);
process.exit(1);
