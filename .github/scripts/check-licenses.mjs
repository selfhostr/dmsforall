#!/usr/bin/env node
// Fails when a dependency (production or development) is under a licence that is not
// OSI-approved. Input: the JSON of `pnpm licenses list --json` on stdin.
//
//   pnpm licenses list --json | node .github/scripts/check-licenses.mjs
//
// SPDX expressions are evaluated: "A OR B" passes when one side is allowed, "A AND B" needs
// both. Exceptions need a package name and a reason.
import { readFileSync } from 'node:fs';

// OSI-approved licences found in permissive and weak-copyleft packages. Strong copyleft
// (GPL, AGPL) is OSI-approved too but is deliberately absent: it does not belong in a
// dependency of an MIT project. Add a licence here only after reading its text.
const ALLOWED = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'ISC',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'Python-2.0',
  'Unlicense',
  'Zlib',
]);

// package name -> reason. caniuse-lite is browser-support data used by the build tooling only,
// not code that ships in the images.
const EXCEPTIONS = new Map([['caniuse-lite', 'CC-BY-4.0 data, build tooling only']]);

function allowed(expression) {
  const clean = expression.replace(/[()]/g, ' ').trim();
  return clean
    .split(/\s+OR\s+/)
    .some((alternative) =>
      alternative
        .split(/\s+AND\s+/)
        .every((licence) => ALLOWED.has(licence.trim().replace(/\+$/, ''))),
    );
}

const report = JSON.parse(readFileSync(0, 'utf8'));
const failures = [];
let checked = 0;
for (const [licence, packages] of Object.entries(report)) {
  for (const pkg of packages) {
    checked += pkg.versions?.length ?? 1;
    if (allowed(licence) || EXCEPTIONS.has(pkg.name)) continue;
    failures.push(`${pkg.name} (${(pkg.versions ?? []).join(', ')}): ${licence}`);
  }
}

if (failures.length > 0) {
  console.error(`Licences outside the allowed list:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`${checked} package versions checked, all under allowed OSI-approved licences.`);
