import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const ignored = new Set([".git", "node_modules", "runtime", "coverage", "dist"]);
async function walk(dir) {
  const result = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name === ".env" || entry.name.endsWith(".log")) continue;
    if (entry.isSymbolicLink()) throw new Error("Release must not contain symbolic links");
    const file = path.join(dir, entry.name);
    result.push(...(entry.isDirectory() ? await walk(file) : [file]));
  }
  return result;
}
const files = await walk(root);
const leaks = [
  new RegExp("-----BEGIN " + "(?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----"),
  // ya29. is a Google OAuth access token (VERTEX_ACCESS_TOKEN).
  /(?:ghp_|github_pat_|AIza|sk-proj-|ya29\.)[A-Za-z0-9_-]{20,}/,
  // Service-account JSON fields and the camelCase secret fields of settings.json.
  /"(?:private_key(?:_id)?|access_token|refresh_token|accessToken|apiKey|gatewayKey|serviceAccountJson)"\s*:\s*"[^"\n]+"/,
  // A service-account email names its project. Starting at "@" keeps long word runs linear.
  /@[\w-]+\.iam\.gserviceaccount\.com/i,
  // Gateway keys from the console and the README recipe are 32 random bytes in hex.
  /(?<![A-Za-z0-9])[a-f0-9]{64}(?![A-Za-z0-9])/i,
  // User profile paths, also JSON-escaped and in Git Bash/WSL form (/c/Users/<name>).
  // Placeholders that start with <, %, $ or { are allowed.
  /(?:[A-Z]:|\/[a-z])[\\/]+Users[\\/]+[^\\/\s"'<>%${]+/i,
];
for (const file of files) {
  const text = await fs.readFile(file, "utf8");
  if (leaks.some(pattern => pattern.test(text))) {
    throw new Error("Potential credential/private path in " + path.relative(root, file));
  }
  if (/\.(mjs|js)$/.test(file)) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status) throw new Error("Syntax check failed: " + path.relative(root, file));
  }
}
for (const required of ["LICENSE", "NOTICE.md", "LICENSES/Antigravity-gateway-MIT.txt", "README.md", ".env.example"]) {
  await fs.access(path.join(root, required));
}
console.log(`Checked ${files.length} release files; syntax and credential/path checks passed.`);
