import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const allowlist = JSON.parse(
  readFileSync(
    new URL("../security/npm-audit-allowlist.json", import.meta.url),
    "utf8"
  )
).advisories;

let report;
try {
  const output = execFileSync("npm", ["audit", "--omit=dev", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  report = JSON.parse(output);
} catch (error) {
  if (!error.stdout) {
    process.stderr.write(error.stderr ?? String(error));
    process.exit(2);
  }
  report = JSON.parse(error.stdout);
}

if (report.error) {
  console.error(
    `npm audit unavailable: ${report.error.summary || report.message}`
  );
  process.exit(2);
}

const found = new Map();
for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
  for (const advisory of vulnerability.via ?? []) {
    if (typeof advisory === "object" && advisory.url) {
      found.set(advisory.url, advisory);
    }
  }
}

const today = new Date().toISOString().slice(0, 10);
const failures = [];
for (const [url, advisory] of found) {
  const exception = allowlist[url];
  if (!exception) {
    failures.push(
      `UNREVIEWED ${advisory.severity}: ${url} — ${advisory.title}`
    );
  } else if (exception.expires < today) {
    failures.push(`EXPIRED ${exception.expires}: ${url} — ${exception.reason}`);
  }
}

for (const [url, exception] of Object.entries(allowlist)) {
  if (exception.expires < today && !found.has(url)) {
    failures.push(`STALE EXPIRED ${exception.expires}: ${url}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `runtime audit: ${found.size} known advisories are explicitly accepted until review; 0 unreviewed`
);
