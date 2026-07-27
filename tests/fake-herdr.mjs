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
