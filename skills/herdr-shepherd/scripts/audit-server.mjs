import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  acknowledgeThrough,
  defaultStateDir,
  deleteAllAuditHistory,
  deleteAuditAction,
  listAuditEvents,
  readAuditState,
} from './core.mjs';

const scriptPath = fileURLToPath(import.meta.url);

function readHerdrSnapshot() {
  const command = process.env.HERDR_BIN || (process.platform === 'win32' ? 'herdr.exe' : 'herdr');
  return new Promise((resolve) => execFile(command, ['api', 'snapshot'], { windowsHide: true }, (error, stdout) => {
    if (error) return resolve();
    try { resolve(JSON.parse(stdout).result?.snapshot); } catch { resolve(); }
  }));
}

function targetDisplay(snapshot, target) {
  const pane = snapshot?.panes?.find((value) => value.pane_id === target?.id || value.terminal_id === target?.id);
  const workspace = snapshot?.workspaces?.find((value) => value.workspace_id === pane?.workspace_id);
  const tab = snapshot?.tabs?.find((value) => value.tab_id === pane?.tab_id);
  return [workspace?.label, tab?.label].filter(Boolean).join(' / ') || target?.id;
}

function html(token) {
  const nonce = randomBytes(16).toString('base64');
  return { nonce, body: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Herdr Shepherd audit</title><style nonce="${nonce}">
:root{color-scheme:dark;font:14px/1.45 ui-sans-serif,system-ui,sans-serif;background:#101214;color:#edf0f2}body{margin:0}header{position:sticky;top:0;background:#171a1d;border-bottom:1px solid #30353a;padding:16px 24px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}h1{font-size:17px;margin:0 auto 0 0}select,button{font:inherit;color:inherit;background:#22272b;border:1px solid #41484e;border-radius:5px;padding:7px 10px}button.primary{background:#b7f36b;color:#111;border-color:#b7f36b;font-weight:650}button:focus-visible,select:focus-visible{outline:2px solid #b7f36b;outline-offset:2px}main{padding:18px 24px}.meta{color:#a9b0b6;margin-bottom:12px}.legend{color:#a9b0b6;margin:0 0 14px;max-width:78ch}.phasecell{display:flex;flex-direction:column;gap:2px}.dl{font-size:11px;letter-spacing:.02em}.dl-confirmed{color:#b7f36b}.dl-unconfirmed{color:#ffcc66}.dl-queued,.dl-unknown{color:#a9b0b6}.event{display:grid;grid-template-columns:54px minmax(190px,auto) 96px 110px minmax(340px,1.4fr) 2fr auto;gap:10px;border-top:1px solid #2b3034;padding:10px 0}.event:first-child{border-top:0}.seq,.time{font-family:ui-monospace,monospace;color:#a9b0b6;font-variant-numeric:tabular-nums}.route-label,.route-arrow{color:#a9b0b6}.failed{color:#ff8f8f}.succeeded{color:#b7f36b}@media(max-width:900px){.event{grid-template-columns:64px 1fr}.event>*:nth-child(n+3){grid-column:2}}</style></head>
<body><header><h1>Herdr Shepherd audit</h1><select id="origin" aria-label="Filter by origin"><option value="">All origins</option><option>proactive</option><option>user-directed</option></select><select id="runtime" aria-label="Filter by runtime"><option value="">All runtimes</option><option>codex</option><option>claude-code</option></select><select id="status" aria-label="Filter by event status"><option value="">All statuses</option><option value="attempted">attempted</option><option value="succeeded" selected>sent</option><option value="failed">failed</option></select><button id="clear">Delete all history</button><button class="primary" id="close">Viewed &amp; close</button></header><main><div class="meta" id="meta">Loading...</div><p class="legend"><strong>sent</strong> means the wrapper typed the message and pressed Enter. It does not confirm the target submitted or read it; a message can sit unsubmitted in the target composer. Confirm delivery by pane read.</p><div id="events"></div></main>
<script nonce="${nonce}">
const token=${JSON.stringify(token)};let highest=0;
const originFilter=document.getElementById('origin'),runtimeFilter=document.getElementById('runtime'),statusFilter=document.getElementById('status'),meta=document.getElementById('meta'),events=document.getElementById('events'),clearButton=document.getElementById('clear'),closeButton=document.getElementById('close');
const localDateTime=new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PHASE_LABEL={attempted:'attempted',succeeded:'sent',failed:'failed'};
const PHASE_TITLE={attempted:'Wrapper is about to run the coordination command.',succeeded:'Wrapper typed the message and pressed Enter. Delivery is unconfirmed until a pane read shows the target processing it.',failed:'Wrapper reported a non-zero exit.'};
const DELIVERY_TITLE={confirmed:'Target was idle before the send and started working after it, so the Enter submitted.',unconfirmed:'Target was idle before the send and stayed idle after it. Suspect a stuck composer: pane read, then resend.',queued:'Target was already working, so the message is queued. Delivery cannot be distinguished from a stuck composer; pane read later.',unknown:'Status probe failed, so delivery could not be assessed.'};
async function requestJson(url,options){const r=await fetch(url,options);if(!r.ok){let message=r.statusText;try{message=(await r.json()).error||message}catch{}throw new Error(message)}return r.status===204?null:r.json()}
function deleteFocused(){return document.activeElement&&document.activeElement.matches('[data-delete-event]')}
async function load(options={}){if(deleteFocused()&&!options.force)return;try{const q=new URLSearchParams({token,origin:originFilter.value,runtime:runtimeFilter.value,status:statusFilter.value});const d=await requestJson('/api/events?'+q);highest=d.events.reduce((m,e)=>Math.max(m,e.sequence||0),0);document.title=d.events.length?'Herdr Shepherd audit ('+d.events.length+')':'Herdr Shepherd audit';meta.textContent=d.events.length+' events - acknowledged through '+d.state.acknowledged_sequence;events.innerHTML=d.events.map(e=>'<div class="event"><span class="seq">#'+esc(e.sequence)+'</span><time class="time" datetime="'+esc(e.occurred_at)+'">'+esc(localDateTime.format(new Date(e.occurred_at)))+'</time><span class="phasecell"><span class="'+esc(e.phase)+'" title="'+esc(PHASE_TITLE[e.phase]||'')+'">'+esc(PHASE_LABEL[e.phase]||e.phase)+'</span>'+(e.delivery?'<span class="dl dl-'+esc(e.delivery)+'" title="'+esc(DELIVERY_TITLE[e.delivery]||'')+'">'+esc(e.delivery)+'</span>':'')+'</span><span>'+esc(e.runtime)+'</span><span><span class="route-label">Source:</span> '+esc(e.source_display||e.runtime)+' <span class="route-arrow">-&gt;</span> <span class="route-label">Target:</span> '+esc(e.target_display||e.target?.id||e.action)+'</span><span><strong>'+esc(e.reason)+'</strong><br>'+esc(e.message_redacted||e.outcome_summary||'')+'</span><button data-delete-event="'+esc(e.event_id)+'" aria-label="Delete coordination action #'+esc(e.sequence)+'">Delete</button></div>').join('')||'<p>No matching events.</p>'}catch(error){meta.textContent='Load failed: '+error.message}}
originFilter.onchange=runtimeFilter.onchange=statusFilter.onchange=()=>load({force:true});
events.onclick=async event=>{const button=event.target.closest?.('[data-delete-event]');if(!button)return;if(!confirm('Delete this coordination action?'))return;try{await requestJson('/api/events/'+encodeURIComponent(button.dataset.deleteEvent)+'?token='+encodeURIComponent(token),{method:'DELETE'});await load({force:true})}catch(error){meta.textContent='Delete failed: '+error.message}};
clearButton.onclick=async()=>{if(!confirm('Delete all audit history?'))return;try{await requestJson('/api/clear?token='+encodeURIComponent(token),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirmed:true})});await load({force:true})}catch(error){meta.textContent='Delete all failed: '+error.message}};
closeButton.onclick=async()=>{await requestJson('/api/viewed-close?token='+encodeURIComponent(token),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sequence:highest})});window.close();document.body.innerHTML='<main><h1>Audit acknowledged. You may close this tab.</h1></main>'};load({force:true});setInterval(load,2000);
</script></body></html>` };
}

async function bodyJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function markPageSeen(stateDir) {
  const viewerPath = join(stateDir, 'viewer.json');
  try {
    const current = JSON.parse(await readFile(viewerPath, 'utf8'));
    await writeFile(viewerPath, `${JSON.stringify({ ...current, last_seen_at: new Date().toISOString() })}\n`, 'utf8');
  } catch {
    // viewer.json is created by the standalone viewer process. Test servers may not have it.
  }
}

export async function createAuditServer({ stateDir = defaultStateDir(), token = randomBytes(24).toString('base64url'), port = 0, autoExit = true, snapshotProvider } = {}) {
  let close;
  // ponytail: labels are resolved once per viewer; restart it to pick up tab renames.
  const snapshot = snapshotProvider ? Promise.resolve().then(snapshotProvider).catch(() => undefined) : Promise.resolve();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.searchParams.get('token') !== token) return json(response, 401, { error: 'unauthorized' });
      if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ok: true });
      if (request.method === 'GET' && url.pathname === '/api/events') {
        await markPageSeen(stateDir);
        const origin = url.searchParams.get('origin');
        const runtime = url.searchParams.get('runtime');
        const status = url.searchParams.get('status');
        const currentSnapshot = await snapshot;
        const events = (await listAuditEvents(stateDir))
          .filter((event) => (!origin || event.origin === origin) && (!runtime || event.runtime === runtime) && (!status || event.phase === status))
          .sort((left, right) => (right.sequence || 0) - (left.sequence || 0))
          .map((event) => ({
            ...event,
            source_display: targetDisplay(currentSnapshot, event.source) || event.runtime,
            target_display: targetDisplay(currentSnapshot, event.target) || event.action,
          }));
        return json(response, 200, { events, state: await readAuditState(stateDir) });
      }
      if (request.method === 'POST' && url.pathname === '/api/viewed-close') {
        const body = await bodyJson(request);
        await acknowledgeThrough(stateDir, body.sequence);
        response.writeHead(204).end();
        if (autoExit) setTimeout(() => close(), 75);
        return;
      }
      if (request.method === 'DELETE' && url.pathname.startsWith('/api/events/')) {
        const eventId = decodeURIComponent(url.pathname.slice('/api/events/'.length));
        if (!eventId) return json(response, 400, { error: 'event_id required' });
        await deleteAuditAction(stateDir, eventId);
        response.writeHead(204).end();
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/clear') {
        const body = await bodyJson(request);
        if (!body.confirmed) return json(response, 400, { error: 'confirmation required' });
        await deleteAllAuditHistory(stateDir);
        response.writeHead(204).end();
        return;
      }
      if (request.method === 'GET' && url.pathname === '/') {
        const page = html(token);
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
          'content-security-policy': `default-src 'none'; style-src 'nonce-${page.nonce}'; script-src 'nonce-${page.nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
          'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
        });
        response.end(page.body);
        return;
      }
      json(response, 404, { error: 'not found' });
    } catch (error) {
      json(response, 500, { error: error.message });
    }
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve));
  const address = server.address();
  close = async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(join(stateDir, 'viewer.json'), { force: true });
  };
  const url = `http://127.0.0.1:${address.port}`;
  return { address, close, server, token, url };
}

async function main() {
  const stateDir = defaultStateDir();
  const viewer = await createAuditServer({ stateDir, token: process.env.HERDR_COORDINATION_VIEWER_TOKEN, snapshotProvider: readHerdrSnapshot });
  await writeFile(join(stateDir, 'viewer.json'), `${JSON.stringify({ pid: process.pid, token: viewer.token, url: viewer.url })}\n`, 'utf8');
}

if (process.argv[1] && basename(process.argv[1]) === basename(scriptPath)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
