#!/usr/bin/env node
import { execSync } from 'node:child_process';

function run(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
}

function safeRun(cmd) {
  try {
    return run(cmd);
  } catch {
    return '';
  }
}

function getChangedFiles() {
  const baseRef = process.env.GITHUB_BASE_REF;
  if (baseRef) {
    safeRun(`git fetch --no-tags --depth=1 origin ${baseRef}`);
    const out = safeRun(`git diff --name-only origin/${baseRef}...HEAD`);
    if (out) return out.split('\n').filter(Boolean);
  }

  const out = safeRun('git diff --name-only HEAD~1...HEAD');
  if (out) return out.split('\n').filter(Boolean);
  return [];
}

const changed = getChangedFiles();
if (changed.length === 0) {
  console.log('No changed files detected; skipping runbook guard.');
  process.exit(0);
}

const runbookPath = 'PROJECT_RUNBOOK.md';
const functionalRoots = ['apps/', 'packages/', 'infra/'];
const functionalFiles = new Set([
  'docker-compose.yml',
  '.env.example',
  'package.json',
  'README.md'
]);

const functionalChanges = changed.filter((file) => {
  if (file === runbookPath) return false;
  if (functionalFiles.has(file)) return true;
  return functionalRoots.some((root) => file.startsWith(root));
});

if (functionalChanges.length === 0) {
  console.log('No functional files changed; runbook update not required.');
  process.exit(0);
}

const runbookUpdated = changed.includes(runbookPath);
if (runbookUpdated) {
  console.log('Runbook guard passed: PROJECT_RUNBOOK.md updated.');
  process.exit(0);
}

console.error('Runbook guard failed.');
console.error('Functional changes detected without PROJECT_RUNBOOK.md update.');
console.error('Changed functional files:');
for (const file of functionalChanges) {
  console.error(`- ${file}`);
}
console.error('');
console.error('Please update PROJECT_RUNBOOK.md in this PR.');
process.exit(1);
