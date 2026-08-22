import { readFileSync } from "node:fs";

const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const packages = Object.entries(lock.packages ?? {})
  .filter(([path, metadata]) => path.startsWith("node_modules/") && !metadata.dev)
  .map(([path, metadata]) => ({
    name: metadata.name ?? path.replace(/^node_modules\//, ""),
    version: metadata.version ?? "unknown",
    license: metadata.license ?? "UNKNOWN",
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const incompatible = packages.filter(({ license }) => {
  const value = String(license).toUpperCase();
  if (/\b(MIT|ISC|BSD|APACHE-2\.0|0BSD|CC0|UNLICENSE)\b/.test(value) && value.includes(" OR "))
    return false;
  return /AGPL|SSPL|(^|[^L])GPL-(?:2|3)/.test(value);
});

process.stdout.write(
  `${JSON.stringify({ generatedAt: new Date().toISOString(), packages, incompatible }, null, 2)}\n`
);
if (incompatible.length > 0) {
  process.stderr.write(
    `Incompatible production licenses: ${incompatible.map((item) => `${item.name}@${item.version} (${item.license})`).join(", ")}\n`
  );
  process.exitCode = 1;
}
