import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleHookPayload } from './hook-lib.mjs';

async function stdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export function runtimeFromEnvironment(env = process.env) {
  if (env.PLUGIN_ROOT) return 'codex';
  if (env.CLAUDE_PLUGIN_ROOT) return 'claude-code';
  return 'unknown';
}

async function main() {
  const runtime = process.argv[2] || runtimeFromEnvironment();
  const payload = JSON.parse(await stdin());
  const result = await handleHookPayload(payload, { runtime });
  if (result.output) process.stdout.write(JSON.stringify(result.output));
}

if (process.argv[1] && basename(process.argv[1]) === basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`Herdr coordination hook failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
