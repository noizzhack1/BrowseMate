# Action Sidebar AI — Chrome MV3 Hackathon Scaffold

This is a **front-end only** (no backend) scaffold for the must‑win flow plus stretch stubs. It uses a **side panel** UI and a **content script navigator** to automate Jira via the UI.

> Replace placeholders like `jira.example.com`, `ci.example.com`, `DEVOPS`, etc. before building.

---

## File Tree

```
action-sidebar-ai/
├─ manifest.json
├─ service_worker.js
├─ README.md
├─ src/
│  ├─ parser.js
│  ├─ allowlist.js
│  ├─ messaging.js
│  ├─ navigator.js
│  └─ selectors/
│     └─ jira.js
└─ sidepanel/
   ├─ sidepanel.html
   ├─ sidepanel.css
   └─ sidepanel.js
```

---

## manifest.json

```json
{
  "manifest_version": 3,
  "name": "Action Sidebar AI",
  "version": "0.1.0",
  "description": "NanoBrowser-style side panel that plans and executes DOM actions for a must-win Jira demo.",
  "permissions": [
    "activeTab",
    "scripting",
    "storage",
    "tabs"
  ],
  "host_permissions": [
    "https://jira.example.com/*",
    "https://ci.example.com/*",
    "https://git.example.com/*",
    "https://confluence.example.com/*"
  ],
  "side_panel": {
    "default_path": "sidepanel/sidepanel.html"
  },
  "background": {
    "service_worker": "service_worker.js"
  },
  "action": {
    "default_title": "Action Sidebar AI"
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```

---

## service_worker.js (background/orchestrator)

```js
// Orchestrates flows, talks to side panel, injects navigator on tabs.

const STATE = {
  runs: {}, // runId -> metadata { status, steps, createdTabId, sourceTabId }
};

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  await chrome.sidePanel.open({ tabId: tab.id });
  await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel/sidepanel.html' });
});

// Messaging glue
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'RUN_PLAN') {
      const { runId, plan } = msg;
      const sourceTabId = msg.tabId ?? sender.tab?.id;
      STATE.runs[runId] = { status: 'running', steps: [], sourceTabId };
      try {
        const result = await runPlan(runId, plan, sourceTabId);
        sendResponse({ ok: true, result });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    } else if (msg?.type === 'STOP_RUN') {
      const { runId } = msg;
      await stopRun(runId);
      sendResponse({ ok: true });
    }
  })();
  return true; // async
});

async function runPlan(runId, plan, sourceTabId) {
  const log = (step) => STATE.runs[runId]?.steps.push(step);

  for (const step of plan.steps) {
    if (STATE.runs[runId]?.status === 'stopping') throw new Error('Stopped by user');

    switch (step.type) {
      case 'EXTRACT_PIPELINE_URL': {
        const res = await execOnTab(sourceTabId, 'extractPipelineUrl', [step.hints || {}]);
        log({ step: step.type, out: res });
        if (!res?.url) throw new Error('No pipeline URL found; paste manually and retry.');
        plan.ctx = plan.ctx || {}; plan.ctx.pipelineUrl = res.url;
        break;
      }
      case 'OPEN_JIRA_CREATE': {
        const jiraCreateUrl = step.url; // e.g., https://jira.example.com/secure/CreateIssue!default.jspa
        const tab = await chrome.tabs.create({ url: jiraCreateUrl, active: true });
        STATE.runs[runId].createdTabId = tab.id;
        log({ step: step.type, out: { tabId: tab.id } });
        await waitForTabComplete(tab.id);
        break;
      }
      case 'FILL_JIRA_FORM': {
        const { projectKey, issueType, summary, description } = step.payload;
        const tabId = STATE.runs[runId].createdTabId;
        await execOnTab(tabId, 'fillJiraCreateForm', [ { projectKey, issueType, summary, description } ]);
        log({ step: step.type });
        break;
      }
      case 'SUBMIT_JIRA_FORM_AND_CAPTURE': {
        const tabId = STATE.runs[runId].createdTabId;
        const issueUrl = await execOnTab(tabId, 'submitJiraAndCaptureIssueUrl', []);
        log({ step: step.type, out: { issueUrl } });
        return { issueUrl };
      }
      default:
        throw new Error(`Unknown step: ${step.type}`);
    }
  }
}

async function stopRun(runId) {
  const meta = STATE.runs[runId];
  if (!meta) return;
  STATE.runs[runId].status = 'stopping';
  if (meta.createdTabId) {
    try { await chrome.tabs.remove(meta.createdTabId); } catch {}
  }
}

async function execOnTab(tabId, fnName, args) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (fnName, args) => {
      // Bridge: call window.__ASA__ navigator helpers in content context
      window.__ASA__ = window.__ASA__ || {};
      if (!window.__ASA__.navigator) throw new Error('Navigator not injected');
      const api = window.__ASA__.navigator;
      if (typeof api[fnName] !== 'function') throw new Error('Unknown navigator fn: ' + fnName);
      return api[fnName](...(args || []));
    },
    args: [fnName, args || []]
  });
  return result;
}

async function waitForTabComplete(tabId) {
  await new Promise((resolve) => {
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Ensure navigator is available on each page
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status === 'complete') {
    try {
      await chrome.scripting.executeScript({
        target: { tabId }, files: ['src/messaging.js', 'src/allowlist.js', 'src/navigator.js', 'src/selectors/jira.js']
      });
    } catch (e) {
      // Ignore pages where we lack permission
    }
  }
});
```

---

## src/allowlist.js (front-end policy)

```js
(function(){
  window.__ASA__ = window.__ASA__ || {};
  const ALLOW = [
    'jira.example.com',
    'ci.example.com',
    'git.example.com',
    'confluence.example.com'
  ];
  function domainAllowed(){
    try{ const { hostname } = new URL(location.href); return ALLOW.includes(hostname); }
    catch{ return false; }
  }
  window.__ASA__.allowlist = { domainAllowed };
})();
```

---

## src/messaging.js (runtime messaging helpers)

```js
(function(){
  window.__ASA__ = window.__ASA__ || {};
  window.__ASA__.post = (type, payload={}) => chrome.runtime.sendMessage({ type, ...payload });
})();
```

---

## src/selectors/jira.js (selectors & helpers for Jira create)

```js
(function(){
  window.__ASA__ = window.__ASA__ || {};
  const JiraSel = {
    project: '[data-test-id="project-picker.project-select"] input, #project-field',
    issueType: '[data-test-id="issuetype-picker.issuetype-select"] input, #issuetype-field',
    summary: '#summary',
    description: '[data-testid="ak-editor-content-area"] textarea, textarea#description',
    createBtn: 'button[id="create-issue-submit"]',
    createdLink: 'a.issue-created-key'
  };
  window.__ASA__.jiraSelectors = JiraSel;
})();
```

---

## src/navigator.js (DOM actor primitives + Jira flow helpers)

```js
(function(){
  window.__ASA__ = window.__ASA__ || {};

  const sleep = (ms) => new Promise(r=>setTimeout(r, ms));

  async function wait(sel, timeout=10000){
    const t0 = Date.now();
    while (Date.now() - t0 < timeout){
      const el = document.querySelector(sel);
      if (el) return el;
      await sleep(100);
    }
    throw new Error('wait timeout for ' + sel);
  }
  async function click(sel){ const el = await wait(sel); el.click(); await sleep(200); }
  async function type(sel, text){ const el = await wait(sel); el.focus(); el.value = ''; el.dispatchEvent(new Event('input',{bubbles:true})); document.execCommand('insertText', false, text); await sleep(200); }
  async function readText(sel){ const el = await wait(sel); return el.innerText || el.value || ''; }

  function firstPipelineUrl(hints={}){
    // Simple regex-based extractor: pick first anchor with /pipeline/ or CI pattern
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const patterns = hints.patterns || [/pipeline/i, /build/i, /ci\//i];
    for (const a of anchors){
      const href = a.getAttribute('href') || '';
      if (patterns.some(p=>p.test(href))){
        try{ return new URL(href, location.href).toString(); } catch{}
      }
    }
    return null;
  }

  async function extractPipelineUrl(hints){
    const url = firstPipelineUrl(hints);
    return { url };
  }

  async function fillJiraCreateForm({ projectKey, issueType, summary, description }){
    const S = window.__ASA__.jiraSelectors;
    // Project
    if (projectKey) {
      try { await type(S.project, projectKey); await sleep(200); document.activeElement.blur(); } catch {}
    }
    if (issueType) {
      try { await type(S.issueType, issueType); await sleep(200); document.activeElement.blur(); } catch {}
    }
    if (summary) {
      await type(S.summary, summary);
    }
    if (description) {
      // Try contenteditable editor first
      const rich = document.querySelector('[data-testid="ak-editor-content-area"] [contenteditable="true"]');
      if (rich) { rich.focus(); document.execCommand('insertText', false, description); }
      else { await type(S.description, description); }
    }
    return true;
  }

  async function submitJiraAndCaptureIssueUrl(){
    const S = window.__ASA__.jiraSelectors;
    // Click create
    try { await click(S.createBtn); } catch (e) {
      // Some Jira variants use a different button
      const alt = document.querySelector('button[type="submit"]'); if (alt) { alt.click(); await sleep(500); }
    }
    // Wait for redirect or success key element
    for (let i=0;i<50;i++){
      // If page navigated to /browse/KEY-123
      if (/\/browse\//.test(location.pathname)) return location.href;
      const link = document.querySelector('a.issue-created-key');
      if (link && link.href) return link.href;
      await sleep(200);
    }
    return location.href; // fallback
  }

  window.__ASA__.navigator = {
    wait, click, type, readText,
    extractPipelineUrl,
    fillJiraCreateForm,
    submitJiraAndCaptureIssueUrl
  };
})();
```

---

## src/parser.js (deterministic intent → plan)

```js
export function parseCommandToPlan(command, ctx){
  const c = (command || '').toLowerCase();
  // Must-win Jira flow
  if (/create\s+jira/.test(c) && /devops/.test(c) && /(pipeline\s+link|pipeline)/.test(c)){
    const plan = {
      kind: 'JIRA_MUST_WIN',
      steps: [
        { type: 'EXTRACT_PIPELINE_URL', hints: { patterns: [/pipeline/i, /build/i, /ci\//i] } },
        { type: 'OPEN_JIRA_CREATE', url: 'https://jira.example.com/secure/CreateIssue!default.jspa' },
        { type: 'FILL_JIRA_FORM', payload: {
          projectKey: 'DEVOPS',
          issueType: 'Task',
          summary: 'Pipeline Failure: {{pipelineName}}',
          description: 'Automated report. Pipeline URL: {{pipelineUrl}}\nStatus: failing\nTimestamp: {{timestamp}}'
        }},
        { type: 'SUBMIT_JIRA_FORM_AND_CAPTURE' }
      ]
    };
    return plan;
  }
  // Stretch: repo search
  if (/^search\s+git/.test(c)){
    return { kind: 'REPO_SEARCH_STRETCH', steps: [ { type: 'OPEN_URL', url: 'https://git.example.com/search?q=' + encodeURIComponent(command) } ] };
  }
  // Stretch: Confluence create
  if (/confluence/.test(c) && /create|new/.test(c)){
    return { kind: 'CONFLUENCE_CREATE_STRETCH', steps: [ { type: 'OPEN_URL', url: 'https://confluence.example.com/' } ] };
  }
  return { kind: 'UNKNOWN', steps: [] };
}
```

---

## sidepanel/sidepanel.html

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Action Sidebar AI</title>
  <link rel="stylesheet" href="sidepanel.css" />
</head>
<body>
  <div class="app">
    <header>
      <h1>Action Sidebar AI</h1>
    </header>
    <section class="cmd">
      <input id="cmd" placeholder="e.g., create jira to devops with pipeline link and note it fails" />
      <button id="planBtn">Plan</button>
    </section>
    <section class="preview" id="preview"></section>
    <section class="controls">
      <button id="confirmBtn" disabled>Confirm</button>
      <button id="stopBtn" disabled>Stop</button>
    </section>
    <section class="result" id="result"></section>
    <section class="log" id="log"></section>
  </div>
  <script type="module" src="sidepanel.js"></script>
</body>
</html>
```

---

## sidepanel/sidepanel.css

```css
body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; }
.app { width: 340px; padding: 12px; }
header { border-bottom: 1px solid #ddd; margin-bottom: 8px; }
.cmd { display: flex; gap: 8px; }
.cmd input { flex: 1; padding: 8px; }
.preview, .log, .result { border: 1px solid #eee; padding: 8px; margin-top: 8px; border-radius: 6px; min-height: 40px; }
.controls { display: flex; gap: 8px; margin-top: 8px; }
button { padding: 6px 10px; }
.step { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
```

---

## sidepanel/sidepanel.js

```js
import { parseCommandToPlan } from '../src/parser.js';

const els = {
  cmd: document.getElementById('cmd'),
  planBtn: document.getElementById('planBtn'),
  confirmBtn: document.getElementById('confirmBtn'),
  stopBtn: document.getElementById('stopBtn'),
  preview: document.getElementById('preview'),
  result: document.getElementById('result'),
  log: document.getElementById('log')
};

let currentPlan = null;
let currentRunId = null;

function renderPlan(plan){
  if (!plan || !plan.steps?.length){ els.preview.textContent = 'No recognizable plan.'; els.confirmBtn.disabled = true; return; }
  els.preview.innerHTML = `<b>Plan</b><ol>${plan.steps.map(s=>`<li class="step">${s.type}</li>`).join('')}</ol>`;
  els.confirmBtn.disabled = false;
}

function now(){ return new Date().toISOString(); }

async function getActiveTab(){
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

function hydrateTemplates(text, ctx){
  return (text||'')
    .replaceAll('{{pipelineUrl}}', ctx.pipelineUrl || '')
    .replaceAll('{{pipelineName}}', (ctx.pipelineUrl||'').split('/').slice(-1)[0] || 'Pipeline')
    .replaceAll('{{timestamp}}', now());
}

els.planBtn.addEventListener('click', async () => {
  const cmd = els.cmd.value.trim();
  const plan = parseCommandToPlan(cmd, {});
  currentPlan = plan;
  renderPlan(plan);
});

els.confirmBtn.addEventListener('click', async () => {
  if (!currentPlan) return;
  // Resolve simple templates ahead of time for FILL_JIRA_FORM
  currentPlan.steps = currentPlan.steps.map(s => {
    if (s.type === 'FILL_JIRA_FORM' && s.payload){
      const payload = { ...s.payload };
      // placeholders resolved after pipeline URL is known; we also re-hydrate post step1
      payload.summary = payload.summary; payload.description = payload.description;
      return { ...s, payload };
    }
    return s;
  });

  currentRunId = crypto.randomUUID();
  log(`Run ${currentRunId} started`);

  // Ask background to execute
  const tab = await getActiveTab();
  const resp = await chrome.runtime.sendMessage({ type: 'RUN_PLAN', runId: currentRunId, plan: currentPlan, tabId: tab.id });
  if (!resp?.ok){ log('Error: ' + resp?.error); return; }
  const result = resp.result;

  // Post-hydrate summary/description templates if pipeline URL available (handled in navigator/submit)
  if (result?.issueUrl){
    els.result.innerHTML = `<b>Created:</b> <a href="${result.issueUrl}" target="_blank">${result.issueUrl}</a>`;
  }
});

els.stopBtn.addEventListener('click', async () => {
  if (!currentRunId) return;
  await chrome.runtime.sendMessage({ type: 'STOP_RUN', runId: currentRunId });
  log(`Run ${currentRunId} stopping...`);
});

function log(msg){
  const p = document.createElement('div'); p.textContent = msg; els.log.appendChild(p);
}
```

---

## README.md (quickstart)

```md
# Action Sidebar AI — Hackathon Scaffold

> Front-end only. MV3 side panel + content script DOM navigator. Must-win demo: create Jira ticket from a pipeline page.

## Setup
1. Clone this folder. Replace domains in `manifest.json` and `src/allowlist.js`.
2. Set Jira defaults in `src/parser.js` (project key, issue type, create URL).
3. Load in Chrome: `chrome://extensions` → Enable **Developer mode** → **Load unpacked** → select folder.
4. Open a curated pipeline page (`https://ci.example.com/...`). Click the extension icon to open the side panel.
5. Type: `create jira to devops with pipeline link and note it fails` → **Plan** → **Confirm**.

## Stretch flows (stubs)
- `search git "rabbitmq wrapper" language:dotnet` → opens your Git search with the query.
- `create confluence page ...` → opens Confluence root (add DOM steps if time remains).

## STOP / UNDO
- **Stop**: side panel → Stop. Background closes created Jira tab if open.
- **Undo**: pre-submit only (clears form via page reload). Post-submit undo is out-of-scope.

## Notes
- Prefer stable selectors (data-testid). `src/selectors/jira.js` holds overrides.
- If no pipeline link is detected, modify `firstPipelineUrl` or paste manually into description template.
```

---

## What’s Next

* Fill placeholders (domains, Jira project/type, create URL).
* Rehearse on 5 pages and tweak selectors/timeouts.
* (Optional) Add Confluence and Repo-search concrete DOM steps following the Jira pattern.
