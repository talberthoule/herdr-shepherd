import { appendFileSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_HERDR_LOG, `${JSON.stringify(args)}\n`);
if (process.env.FAKE_HERDR_MISSING && args[0] === 'agent' && args[1] === 'get') {
  process.stderr.write('agent not found\n');
  process.exit(1);
}
if (process.env.FAKE_HERDR_KEYS_FAILURE && args[0] === 'pane' && args[1] === 'send-keys') {
  process.stderr.write('send keys failed\n');
  process.exit(1);
}
if (process.env.FAKE_HERDR_PROMPT_FAILURE && args[0] === 'agent' && args[1] === 'prompt') {
  process.stderr.write('prompt failed\n');
  process.exit(1);
}
if (process.env.FAKE_HERDR_RUN_FAILURE && args[0] === 'pane' && args[1] === 'run') {
  process.stderr.write('pane run failed\n');
  process.exit(1);
}
// Mirrors the live `agent explain --json` shape: every evaluated rule is
// reported, and the composer lives in the prompt_box_body region preview
// whether or not that rule won the detection race.
if (args[0] === 'agent' && args[1] === 'explain') {
  if (process.env.FAKE_HERDR_EXPLAIN_FAILURE) {
    process.stderr.write('explain failed\n');
    process.exit(1);
  }
  const draft = process.env.FAKE_HERDR_COMPOSER || '';
  process.stdout.write(JSON.stringify({
    agent: 'claude',
    state: 'idle',
    manifest_version: '2026.07.13.1',
    matched_rule: { id: 'live_prompt_box', priority: 950, region: 'prompt_box_body', state: 'idle' },
    evaluated_rules: [
      { id: 'osc_title_working', matched: false, priority: 1100, region: 'osc_title', state: 'working', evidence: { region_preview: '✳ a task title' } },
      { id: 'live_prompt_box', matched: true, priority: 950, region: 'prompt_box_body', state: 'idle', evidence: { region_preview: draft ? `❯ ${draft}\n` : '❯\n' } },
    ],
  }));
  process.exit(0);
}
if (args[0] === 'agent' && args[1] === 'wait') {
  // Models the live 0.7.2-preview behavior: the wait resolves with agent info
  // when the state arrives (or is already true) and otherwise blocks forever,
  // ignoring --timeout; the hang must be killed by the wrapper's watchdog.
  if (process.env.FAKE_HERDR_WAIT_HANG) {
    setTimeout(() => process.exit(1), 30_000);
    await new Promise(() => {});
  } else {
    process.stdout.write(JSON.stringify({
      id: 'cli:agent:wait:resolve',
      result: { agent: { pane_id: args[2], agent_status: 'working' }, type: 'agent_info' },
    }));
    process.exit(0);
  }
}
// Models the assumed live behavior of an expired `--wait`: the prompt has
// submitted, the wait exits nonzero with a structured timeout diagnostic.
if (process.env.FAKE_HERDR_PROMPT_WAIT_TIMEOUT && args[0] === 'agent' && args[1] === 'prompt' && args.includes('--wait')) {
  process.stderr.write(`${JSON.stringify({
    error: { code: 'wait_timeout', message: `timed out waiting for ${args[2]} to reach working` },
    id: 'cli:agent:prompt',
  })}\n`);
  process.exit(1);
}
const priorGets = () => readFileSync(process.env.FAKE_HERDR_LOG, 'utf8')
  .trim().split(/\r?\n/).map(JSON.parse)
  .filter((call) => call[0] === 'agent' && call[1] === 'get').length;

// The real CLI reports a genuinely absent target as structured JSON on stderr.
if (process.env.FAKE_HERDR_MISSING_JSON && args[0] === 'agent' && args[1] === 'get') {
  process.stderr.write(`${JSON.stringify({
    error: { code: 'agent_not_found', message: `agent target ${args[2]} not found` },
    id: 'cli:agent:get',
  })}\n`);
  process.exit(1);
}
// Transient control-socket fault: fails the first N probes, then recovers.
if (process.env.FAKE_HERDR_TRANSPORT_FAILURES && args[0] === 'agent' && args[1] === 'get'
  && priorGets() <= Number(process.env.FAKE_HERDR_TRANSPORT_FAILURES)) {
  process.stderr.write('Error: Os { code: 232, kind: BrokenPipe, message: "The pipe is being closed." }\n');
  process.exit(1);
}
// Statuses are consumed in call order so a test can script "idle then working".
if (args[0] === 'agent' && args[1] === 'get' && process.env.FAKE_HERDR_STATUSES) {
  const statuses = process.env.FAKE_HERDR_STATUSES.split(',');
  const status = statuses[Math.min(priorGets() - 1, statuses.length - 1)];
  process.stdout.write(
    status === 'none'
      ? JSON.stringify({ result: {} })
      : JSON.stringify({ result: { agent: { pane_id: args[2], agent_status: status } } }),
  );
  process.exit(0);
}
if (args[0] === 'tab' && args[1] === 'get') {
  process.stdout.write(JSON.stringify({ result: { tab: { label: process.env.FAKE_HERDR_TAB_LABEL } } }));
  process.exit(0);
}
process.stdout.write(JSON.stringify({ ok: true, args }));
