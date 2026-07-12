const DEFAULT_OEMS = [
  { id: 'byd', name: 'BYD', country: 'China', logo: 'https://www.google.com/s2/favicons?sz=64&domain=byd.com' },
  { id: 'leapmotor', name: 'Leapmotor', country: 'China', logo: 'https://www.google.com/s2/favicons?sz=64&domain=leapmotor.com' },
  { id: 'gac', name: 'GAC / Aion', country: 'China', logo: 'https://www.google.com/s2/favicons?sz=64&domain=gac.com.cn' },
  { id: 'xpeng', name: 'XPeng', country: 'China', logo: 'https://www.google.com/s2/favicons?sz=64&domain=xpeng.com' },
  { id: 'geely', name: 'Geely', country: 'China', logo: 'https://www.google.com/s2/favicons?sz=64&domain=geely.com' }
];

let state = loadState();
let selectedOemId = state.oems[0]?.id || null;

const el = (id) => document.getElementById(id);

function loadState() {
  const saved = localStorage.getItem('oemSupplierResearchState');
  if (saved) {
    try { return JSON.parse(saved); } catch (_) {}
  }
  return { oems: DEFAULT_OEMS, findings: [] };
}
function saveState() { localStorage.setItem('oemSupplierResearchState', JSON.stringify(state)); }
function setStatus(message, isError=false) {
  const box = el('statusBox');
  box.hidden = false;
  box.textContent = message;
  box.style.borderColor = isError ? '#111' : '#d8d8d8';
}
function clearStatus() { el('statusBox').hidden = true; el('statusBox').textContent = ''; }

function renderOems() {
  const list = el('oemList');
  list.innerHTML = '';
  state.oems.forEach(oem => {
    const card = document.createElement('div');
    card.className = 'oem-card' + (oem.id === selectedOemId ? ' active' : '');
    card.innerHTML = `<img class="oem-logo" src="${oem.logo || ''}" alt="" onerror="this.style.display='none'"/><div><strong>${escapeHtml(oem.name)}</strong><div class="muted">${escapeHtml(oem.country || '')}</div></div>`;
    card.onclick = () => { selectedOemId = oem.id; render(); };
    list.appendChild(card);
  });
}

function renderFindings() {
  const oem = state.oems.find(x => x.id === selectedOemId);
  el('selectedOemTitle').textContent = oem ? oem.name : 'Select an OEM';
  el('selectedOemSubtitle').textContent = oem ? 'Supplier intelligence for this OEM only' : '';

  const search = el('searchInput').value.trim().toLowerCase();
  const statusFilter = el('statusFilter').value;
  let findings = state.findings.filter(f => f.oem_id === selectedOemId);
  if (statusFilter !== 'all') findings = findings.filter(f => (f.review_status || 'pending') === statusFilter);
  if (search) {
    findings = findings.filter(f => JSON.stringify(f).toLowerCase().includes(search));
  }

  const container = el('findings');
  container.innerHTML = '';
  if (!findings.length) {
    container.innerHTML = '<div class="empty">No findings yet for this OEM. Click Research selected OEM.</div>';
    return;
  }

  const grouped = groupBy(findings, f => f.category || 'uncategorized');
  Object.keys(grouped).sort().forEach(category => {
    const h = document.createElement('h3');
    h.className = 'category';
    h.textContent = labelCategory(category);
    container.appendChild(h);
    grouped[category].forEach(f => container.appendChild(renderFindingCard(f)));
  });
}

function renderFindingCard(f) {
  const card = document.createElement('div');
  card.className = 'finding';
  const evidence = Array.isArray(f.evidence) ? f.evidence : [];
  const badges = [f.relationship_status, `confidence ${f.confidence ?? 'n/a'}`, f.review_status || 'pending'].filter(Boolean);
  card.innerHTML = `
    <div class="finding-head">
      <div>
        <div class="supplier-name">${escapeHtml(f.supplier || 'Unknown supplier')}</div>
        <div>${badges.map(b => `<span class="badge">${escapeHtml(String(b))}</span>`).join('')}</div>
      </div>
      <button class="${f.review_status === 'accepted' ? 'secondary' : ''}" data-action="toggle">${f.review_status === 'accepted' ? 'Unaccept' : 'Accept'}</button>
    </div>
    <p style="margin-top:10px">${escapeHtml(f.claim || '')}</p>
    <p class="muted">${escapeHtml(f.reasoning_summary || '')}</p>
    <div class="evidence"><strong>Evidence</strong><br>${evidence.length ? evidence.map(ev => evidenceLine(ev)).join('') : '<span class="muted">No evidence supplied.</span>'}</div>
  `;
  card.querySelector('[data-action="toggle"]').onclick = () => {
    f.review_status = f.review_status === 'accepted' ? 'pending' : 'accepted';
    saveState(); render();
  };
  return card;
}
function evidenceLine(ev) {
  const title = escapeHtml(ev.title || ev.source || 'source');
  const url = ev.url ? String(ev.url) : '';
  const quote = ev.relevant_quote ? ` — “${escapeHtml(ev.relevant_quote)}”` : '';
  if (url) return `<div><a href="${escapeAttr(url)}" target="_blank" rel="noreferrer">${title}</a>${quote}</div>`;
  return `<div>${title}${quote}</div>`;
}

function buildPrompt(oem) {
  return `You are an automotive supplier intelligence analyst. Research ${oem.name} and produce a practical supplier intelligence list for Europe.

Task: identify suppliers relevant to ${oem.name} in Europe, grouped into these exact categories:
1. chinese_suppliers_currently_supplying_oem_in_europe
2. chinese_suppliers_that_followed_oem_to_europe
3. chinese_suppliers_with_active_europe_localization_plans
4. european_based_suppliers_supplying_chinese_oem_in_europe
5. watchlist_unverified_but_relevant_suppliers

Important rules:
- The findings must be about ${oem.name}. Do not include suppliers only related to another OEM unless there is also a ${oem.name} relevance.
- Include as many useful suppliers as you can find, not just one.
- Mark relationship_status as confirmed, probable, localization_only, watchlist, or weak.
- Use cautious language. Do not invent direct supplier relationships.
- Each finding needs supplier, category, relationship_status, confidence 0-100, claim, reasoning_summary, and evidence.
- Evidence should include title, url, source_type, date if known, and a short relevant_quote.
- Return ONLY valid JSON. No markdown.

JSON schema:
{
  "oem": "${oem.name}",
  "findings": [
    {
      "supplier": "",
      "category": "chinese_suppliers_currently_supplying_oem_in_europe | chinese_suppliers_that_followed_oem_to_europe | chinese_suppliers_with_active_europe_localization_plans | european_based_suppliers_supplying_chinese_oem_in_europe | watchlist_unverified_but_relevant_suppliers",
      "relationship_status": "confirmed | probable | localization_only | watchlist | weak",
      "confidence": 0,
      "claim": "",
      "reasoning_summary": "",
      "evidence": [{"title":"", "url":"", "source_type":"official | news | filing | government | job_posting | unknown", "date":"", "relevant_quote":""}]
    }
  ]
}`;
}

async function researchSelectedOem() {
  const oem = state.oems.find(x => x.id === selectedOemId);
  if (!oem) return;
  const key = el('apiKey').value.trim();
  if (!key) { setStatus('Enter your OpenAI API key first.', true); return; }
  if (el('rememberKey').checked) localStorage.setItem('openaiApiKey', key);

  const prompt = buildPrompt(oem);
  setStatus(`Researching ${oem.name}. This can take 1–4 minutes...`);
  el('researchBtn').disabled = true;
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        input: prompt,
        tools: [{ type: 'web_search_preview' }],
        temperature: 0.2
      })
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(raw);
    const data = JSON.parse(raw);
    const text = extractOutputText(data);
    const parsed = parseJsonText(text);
    importFindingsForOem(oem, parsed);
    setStatus(`Research complete. Imported ${parsed.findings?.length || 0} findings for ${oem.name}.`);
  } catch (err) {
    console.error(err);
    setStatus(`Research failed. This may be browser/CORS, API, or model access. Use the manual import fallback below.\n\n${err.message || err}`, true);
  } finally {
    el('researchBtn').disabled = false;
  }
}
function extractOutputText(data) {
  if (data.output_text) return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    for (const c of item.content || []) {
      if (c.text) parts.push(c.text);
    }
  }
  return parts.join('\n');
}
function parseJsonText(text) {
  const clean = text.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/,'').trim();
  try { return JSON.parse(clean); } catch (_) {}
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1));
  throw new Error('Could not parse AI JSON output. Paste it into manual import and check formatting.');
}
function importFindingsForOem(oem, parsed) {
  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const now = new Date().toISOString();
  const normalized = findings.map((f, idx) => ({
    id: `${oem.id}-${Date.now()}-${idx}-${Math.random().toString(36).slice(2)}`,
    oem_id: oem.id,
    oem_name: oem.name,
    supplier: f.supplier || 'Unknown supplier',
    category: f.category || 'watchlist_unverified_but_relevant_suppliers',
    relationship_status: f.relationship_status || 'watchlist',
    confidence: Number(f.confidence || 0),
    claim: f.claim || '',
    reasoning_summary: f.reasoning_summary || '',
    evidence: Array.isArray(f.evidence) ? f.evidence : [],
    review_status: 'pending',
    created_at: now
  }));
  state.findings = [...normalized, ...state.findings.filter(f => !(f.oem_id === oem.id && f.review_status !== 'accepted'))];
  saveState(); render();
}

function exportCsv(acceptedOnly=false) {
  const rows = (acceptedOnly ? state.findings.filter(f => f.review_status === 'accepted') : state.findings);
  const header = ['OEM','Supplier','Category','Status','Confidence','Review','Claim','Reasoning','Evidence URLs'];
  const lines = [header, ...rows.map(f => [
    f.oem_name, f.supplier, f.category, f.relationship_status, f.confidence, f.review_status, f.claim, f.reasoning_summary,
    (f.evidence || []).map(e => e.url).filter(Boolean).join(' | ')
  ])].map(row => row.map(csvCell).join(','));
  download(`oem_supplier_findings${acceptedOnly ? '_accepted' : ''}.csv`, lines.join('\n'), 'text/csv');
}
function exportJson() { download('oem_supplier_findings.json', JSON.stringify(state, null, 2), 'application/json'); }
function exportHtml() {
  const rows = state.findings.filter(f => f.review_status === 'accepted');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>OEM Supplier Report</title><style>body{font-family:Arial;padding:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top}</style></head><body><h1>OEM Supplier Report</h1><p>Generated ${new Date().toLocaleString()}</p><table><thead><tr><th>OEM</th><th>Supplier</th><th>Category</th><th>Status</th><th>Confidence</th><th>Claim</th></tr></thead><tbody>${rows.map(f => `<tr><td>${escapeHtml(f.oem_name)}</td><td>${escapeHtml(f.supplier)}</td><td>${escapeHtml(labelCategory(f.category))}</td><td>${escapeHtml(f.relationship_status)}</td><td>${escapeHtml(String(f.confidence))}</td><td>${escapeHtml(f.claim)}</td></tr>`).join('')}</tbody></table></body></html>`;
  download('oem_supplier_report.html', html, 'text/html');
}
function download(filename, text, type) {
  const blob = new Blob([text], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function csvCell(v) { return `"${String(v ?? '').replace(/"/g, '""')}"`; }
function groupBy(arr, fn) { return arr.reduce((acc, item) => { const k = fn(item); (acc[k] ||= []).push(item); return acc; }, {}); }
function labelCategory(c) { return String(c || '').replaceAll('_',' ').replace(/\b\w/g, m => m.toUpperCase()); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])); }
function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }
function render() { renderOems(); renderFindings(); }

el('researchBtn').onclick = researchSelectedOem;
el('exportCsvBtn').onclick = () => exportCsv(false);
el('exportJsonBtn').onclick = exportJson;
el('exportHtmlBtn').onclick = exportHtml;
el('searchInput').oninput = renderFindings;
el('statusFilter').onchange = renderFindings;
el('addOemBtn').onclick = () => {
  const name = el('newOemName').value.trim(); if (!name) return;
  const country = el('newOemCountry').value.trim() || 'China';
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  state.oems.push({ id, name, country, logo: `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(name.toLowerCase().replace(/\s+/g,''))}.com` });
  selectedOemId = id; el('newOemName').value=''; el('newOemCountry').value=''; saveState(); render();
};
el('clearKeyBtn').onclick = () => { localStorage.removeItem('openaiApiKey'); el('apiKey').value=''; el('rememberKey').checked=false; };
el('copyPromptBtn').onclick = async () => {
  const oem = state.oems.find(x => x.id === selectedOemId); if (!oem) return;
  await navigator.clipboard.writeText(buildPrompt(oem)); setStatus('Research prompt copied.');
};
el('importJsonBtn').onclick = () => {
  const oem = state.oems.find(x => x.id === selectedOemId); if (!oem) return;
  try { const parsed = parseJsonText(el('manualJson').value); importFindingsForOem(oem, parsed); setStatus('Imported pasted JSON.'); }
  catch (e) { setStatus(e.message, true); }
};

const savedKey = localStorage.getItem('openaiApiKey');
if (savedKey) { el('apiKey').value = savedKey; el('rememberKey').checked = true; }
render();
