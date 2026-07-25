import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { appendAuditEvent, listAuditEvents, readAuditState } from '../skills/herdr-shepherd/scripts/core.mjs';
import { createAuditServer } from '../skills/herdr-shepherd/scripts/audit-server.mjs';
import { ensureAuditViewer } from '../skills/herdr-shepherd/scripts/hook-lib.mjs';

async function fixture() {
  const stateDir = await mkdtemp(join(tmpdir(), 'herdr-viewer-'));
  await appendAuditEvent(stateDir, {
    event_id: 'one', phase: 'attempted', runtime: 'codex', origin: 'proactive',
    action: 'herdr.exec', source: { type: 'agent', id: 'w1:pH' }, target: { type: 'agent', id: 'w2:p1' }, reason: 'test',
    message_redacted: 'resume', message_sha256: '0'.repeat(64),
  });
  return stateDir;
}

test('viewer binds loopback, requires token, and exposes filtered events', async (t) => {
  const stateDir = await fixture();
  const viewer = await createAuditServer({ stateDir, token: 'test-token', port: 0, autoExit: false });
  t.after(() => viewer.close());
  assert.equal(viewer.address.address, '127.0.0.1');
  assert.equal((await fetch(`${viewer.url}/api/events`)).status, 401);
  const response = await fetch(`${viewer.url}/api/events?token=test-token&origin=proactive`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).events.length, 1);
});

test('viewer resolves source and target panes to a plain-text route', async (t) => {
  const stateDir = await fixture();
  const snapshotProvider = async () => ({
    panes: [
      { pane_id: 'w1:pH', workspace_id: 'w1', tab_id: 'w1:tH' },
      { pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1' },
    ],
    workspaces: [
      { workspace_id: 'w1', label: 'example-repository' },
      { workspace_id: 'w2', label: 'backchannel' },
    ],
    tabs: [
      { tab_id: 'w1:tH', label: 'herdr-skill' },
      { tab_id: 'w2:t1', label: 'linear' },
    ],
  });
  const viewer = await createAuditServer({ stateDir, token: 'test-token', port: 0, autoExit: false, snapshotProvider });
  t.after(() => viewer.close());
  const response = await fetch(`${viewer.url}/api/events?token=test-token`);
  const [event] = (await response.json()).events;
  assert.equal(event.source_display, 'example-repository / herdr-skill');
  assert.equal(event.target_display, 'backchannel / linear');
});

test('viewer filters audit events by attempted, succeeded, or failed status', async (t) => {
  const stateDir = await fixture();
  await appendAuditEvent(stateDir, {
    event_id: 'two', phase: 'succeeded', runtime: 'codex', origin: 'proactive',
    action: 'herdr.exec', target: { type: 'agent', id: 'w2:p1' }, reason: 'test',
    message_redacted: 'resume', message_sha256: '0'.repeat(64),
  });
  const viewer = await createAuditServer({ stateDir, token: 'test-token', port: 0, autoExit: false });
  t.after(() => viewer.close());
  const response = await fetch(`${viewer.url}/api/events?token=test-token&status=succeeded`);
  assert.deepEqual((await response.json()).events.map((event) => event.phase), ['succeeded']);
});

test('events API returns newest events first', async (t) => {
  const stateDir = await fixture();
  await appendAuditEvent(stateDir, {
    event_id: 'two', phase: 'attempted', runtime: 'codex', origin: 'proactive',
    action: 'herdr.exec', target: { type: 'agent', id: 'w2:p2' }, reason: 'newer',
    message_redacted: 'resume', message_sha256: '1'.repeat(64),
  });
  const viewer = await createAuditServer({ stateDir, token: 'test-token', port: 0, autoExit: false });
  t.after(() => viewer.close());
  const response = await fetch(`${viewer.url}/api/events?token=test-token`);
  assert.deepEqual((await response.json()).events.map((event) => event.event_id), ['two', 'one']);
});

test('viewer reads filters from explicit elements instead of window.origin', async (t) => {
  const stateDir = await fixture();
  const viewer = await createAuditServer({ stateDir, token: 'test-token', port: 0, autoExit: false });
  t.after(() => viewer.close());
  const page = await (await fetch(`${viewer.url}/?token=test-token`)).text();
  assert.match(page, /document\.getElementById\('origin'\)/);
  assert.doesNotMatch(page, /origin\.value/);
});

test('viewer offers a status filter and formats local time with a short zone name', async (t) => {
  const stateDir = await fixture();
  const viewer = await createAuditServer({ stateDir, token: 'test-token', port: 0, autoExit: false });
  t.after(() => viewer.close());
  const page = await (await fetch(`${viewer.url}/?token=test-token`)).text();
  assert.match(page, /<select id="status"/);
  // Wire value stays the stored phase; the label is honest about what it proves.
  assert.match(page, /<option value="succeeded" selected>sent<\/option>/);
  assert.match(page, /document\.title=.*d\.events\.length/);
  assert.match(page, /timeZoneName:'short'/);
  assert.match(page, /e\.occurred_at/);
  assert.match(page, /e\.source_display/);
});

test('Viewed & close acknowledges the displayed sequence', async (t) => {
  const stateDir = await fixture();
  const viewer = await createAuditServer({ stateDir, token: 'test-token', port: 0, autoExit: false });
  t.after(() => viewer.close());
  const response = await fetch(`${viewer.url}/api/viewed-close?token=test-token`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sequence: 1 }),
  });
  assert.equal(response.status, 204);
  assert.equal((await readAuditState(stateDir)).acknowledged_sequence, 1);
});

test('delete endpoint removes one complete coordination action', async (t) => {
  const stateDir = await fixture();
  await appendAuditEvent(stateDir, {
    event_id: 'one', phase: 'succeeded', runtime: 'codex', origin: 'proactive',
    action: 'herdr.exec', target: { type: 'agent', id: 'w2:p1' }, reason: 'test',
    message_redacted: 'resume', message_sha256: '0'.repeat(64), outcome_summary: 'sent',
  });
  await appendAuditEvent(stateDir, {
    event_id: 'two', phase: 'attempted', runtime: 'codex', origin: 'proactive',
    action: 'herdr.exec', target: { type: 'agent', id: 'w2:p2' }, reason: 'test',
    message_redacted: 'resume', message_sha256: '1'.repeat(64),
  });
  const viewer = await createAuditServer({ stateDir, token: 'test-token', port: 0, autoExit: false });
  t.after(() => viewer.close());
  const response = await fetch(`${viewer.url}/api/events/one?token=test-token`, { method: 'DELETE' });
  assert.equal(response.status, 204);
  assert.deepEqual((await listAuditEvents(stateDir)).map((event) => event.event_id), ['two']);
});

test('delete all requires confirmation and empties audit history', async (t) => {
  const stateDir = await fixture();
  const viewer = await createAuditServer({ stateDir, token: 'test-token', port: 0, autoExit: false });
  t.after(() => viewer.close());
  let response = await fetch(`${viewer.url}/api/clear?token=test-token`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
  });
  assert.equal(response.status, 400);
  response = await fetch(`${viewer.url}/api/clear?token=test-token`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmed: true }),
  });
  assert.equal(response.status, 204);
  assert.deepEqual(await listAuditEvents(stateDir), []);
});

test('active page polling suppresses duplicate browser launches and stale presence permits one', async (t) => {
  const stateDir = await fixture();
  const viewer = await createAuditServer({ stateDir, token: 'test-token', port: 0, autoExit: false });
  t.after(() => viewer.close());
  await writeFile(join(stateDir, 'viewer.json'), `${JSON.stringify({
    pid: process.pid,
    token: viewer.token,
    url: viewer.url,
    last_seen_at: new Date().toISOString(),
  })}\n`, 'utf8');

  const opened = [];
  assert.equal(await ensureAuditViewer(stateDir, { openUrl: (url) => opened.push(url) }), `${viewer.url}/?token=${viewer.token}`);
  assert.equal(opened.length, 0);

  await writeFile(join(stateDir, 'viewer.json'), `${JSON.stringify({
    pid: process.pid,
    token: viewer.token,
    url: viewer.url,
    last_seen_at: new Date(Date.now() - 10_000).toISOString(),
  })}\n`, 'utf8');
  assert.equal(await ensureAuditViewer(stateDir, { openUrl: (url) => opened.push(url) }), `${viewer.url}/?token=${viewer.token}`);
  assert.deepEqual(opened, [`${viewer.url}/?token=${viewer.token}`]);
});

test('recorded viewer launch suppresses duplicate browser tabs before page polling', async (t) => {
  const stateDir = await fixture();
  const viewer = await createAuditServer({ stateDir, token: 'test-token', port: 0, autoExit: false });
  t.after(() => viewer.close());
  await writeFile(join(stateDir, 'viewer.json'), `${JSON.stringify({
    pid: process.pid,
    token: viewer.token,
    url: viewer.url,
  })}\n`, 'utf8');

  const opened = [];
  assert.equal(await ensureAuditViewer(stateDir, { openUrl: (url) => opened.push(url) }), `${viewer.url}/?token=${viewer.token}`);
  assert.deepEqual(opened, [`${viewer.url}/?token=${viewer.token}`]);
  assert.ok(JSON.parse(await readFile(join(stateDir, 'viewer.json'), 'utf8')).opened_at);

  assert.equal(await ensureAuditViewer(stateDir, { openUrl: (url) => opened.push(url) }), `${viewer.url}/?token=${viewer.token}`);
  assert.deepEqual(opened, [`${viewer.url}/?token=${viewer.token}`]);
});

test('concurrent proactive activations share one viewer process', async () => {
  const stateDir = await fixture();
  const urls = await Promise.all(Array.from({ length: 4 }, () => ensureAuditViewer(stateDir, { openBrowser: false })));
  const unique = [...new Set(urls)];
  try {
    assert.equal(unique.length, 1);
  } finally {
    await Promise.allSettled(unique.map((url) => fetch(url.replace('/?', '/api/viewed-close?'), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sequence: 1 }),
    })));
  }
});
