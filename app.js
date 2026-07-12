const OEMS = ['BYD', 'Leapmotor', 'GAC/Aion', 'XPeng', 'Geely'];
let selectedOEM = OEMS[0];
let findings = JSON.parse(localStorage.getItem('findings') || '[]');

const oemsEl = document.getElementById('oems');
const resultsEl = document.getElementById('results');
const statusEl = document.getElementById('status');
const apiKeyEl = document.getElementById('apiKey');
const manualJsonEl = document.getElementById('manualJson');

apiKeyEl.value = localStorage.getItem('openai_api_key') || '';
apiKeyEl.addEventListener('input', () => localStorage.setItem('openai_api_key', apiKeyEl.value.trim()));

function renderOEMs() {
  oemsEl.innerHTML = '';
  OEMS.forEach(oem => {
    const btn = document.createElement('button');
    btn.textContent = oem;
    btn.className = oem === selectedOEM ? 'active' : 'secondary';
    btn.onclick = () => { selectedOEM = oem; renderOEMs(); renderResults(); };
    oemsEl.appendChild(btn);
  });
}

function researchPrompt(oem) {
  return `You are an automotive supplier intelligence analyst. Research ONLY ${oem} in Europe.

Find suppliers in these buckets:
1. Chinese suppliers currently supplying ${oem} in Europe.
2. Chinese suppliers that followed / came with ${oem} to Europe.
3. Chinese suppliers with active plans to localize production in Europe connected to ${oem}, or relevant to ${oem} where the exact link is not verified.
4. European-based suppliers supplying ${oem} or Chinese OEMs in Europe.
5. Watchlist suppliers where the OEM relationship is not verified yet.

Rules:
- Do not include findings for another OEM unless the finding clearly says it is relevant to ${oem}.
- If the source does not prove a supplier-OEM relationship, set status to localization_only or watchlist.
- Prefer 8 to 20 useful findings if evidence exists.
- Every finding must include at least one source URL.
- Return ONLY valid JSON. No markdown. No comments. No trailing commas.

JSON shape exactly:
{
  "findings": [
    {
      "oem": "${oem}",
      "supplier": "",
      "supplier_origin": "China or Europe or Other",
      "category": "currently_supplying_europe or followed_oem_to_europe or planned_localization or european_supplier or watchlist",
      "status": "confirmed or probable or localization_only or european_supplier or watchlist",
      "component": "",
      "europe_location": "",
      "claim": "",
      "confidence": 0,
      "sources": [
        { "title": "", "url": "", "short_evidence": "" }
      ]
    }
  ]
}`;
}

async function runResearch() {
  const key = apiKeyEl.value.trim();
  if (!key) { showStatus('Add your OpenAI API key first.', true); return; }
  showStatus(`Researching ${selectedOEM}. This can take a little while...`, false);

  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        input: researchPrompt(selectedOEM),
        tools: [{ type: 'web_search_preview' }],
        text: { format: { type: 'json_object' } }
      })
    });

    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error(raw.slice(0, 600)); }
    if (!res.ok) throw new Error(data.error?.message || JSON.stringify(data).slice(0, 600));

    const text = getOutputText(data);
    const parsed = parseResearchJson(text);
    saveFindings(parsed.findings || []);
  } catch (err) {
    showStatus(`Research failed: ${escapeHtml(err.message)}<br><br>Use the manual fallback: click “Copy research prompt”, run it in ChatGPT/OpenAI, paste the JSON below, then click Import JSON.`, true);
  }
}

function getOutputText(data) {
  if (data.output_text) return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    for (const c of item.content || []) {
      if (c.text) parts.push(c.text);
      if (c.type === 'output_text' && c.text) parts.push(c.text);
    }
  }
  return parts.join('\n').trim();
}

function parseResearchJson(text) {
  if (!text) throw new Error('OpenAI returned no text.');
  let cleaned = text.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  const direct = tryJson(cleaned);
  if (direct) return normalizeParsed(direct);

  const extracted = extractJsonBlock(cleaned);
  const extractedParsed = tryJson(extracted);
  if (extractedParsed) return normalizeParsed(extractedParsed);

  const repaired = basicJsonRepair(extracted || cleaned);
  const repairedParsed = tryJson(repaired);
  if (repairedParsed) return normalizeParsed(repairedParsed);

  manualJsonEl.value = cleaned;
  throw new Error('The AI returned malformed JSON. I pasted it into the manual import box so you can inspect or repair it.');
}

function tryJson(s) { try { return JSON.parse(s); } catch { return null; } }

function extractJsonBlock(s) {
  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  let start = -1;
  if (firstObj >= 0 && firstArr >= 0) start = Math.min(firstObj, firstArr);
  else start = Math.max(firstObj, firstArr);
  if (start < 0) return '';
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inString = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open) depth++;
    if (ch === close) depth--;
    if (depth === 0) return s.slice(start, i + 1);
  }
  return s.slice(start);
}

function basicJsonRepair(s) {
  return s
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function normalizeParsed(parsed) {
  if (Array.isArray(parsed)) return { findings: parsed };
  if (parsed.findings && Array.isArray(parsed.findings)) return parsed;
  if (parsed.results && Array.isArray(parsed.results)) return { findings: parsed.results };
  return { findings: [] };
}

function importManualJson() {
  try {
    const parsed = parseResearchJson(manualJsonEl.value);
    saveFindings(parsed.findings || []);
  } catch (err) {
    showStatus(`Import failed: ${escapeHtml(err.message)}`, true);
  }
}

function saveFindings(rawFindings) {
  const cleaned = rawFindings
    .filter(f => String(f.oem || '').toLowerCase().includes(selectedOEM.toLowerCase().split('/')[0]) || !f.oem || String(f.oem).trim() === selectedOEM)
    .map(f => ({
      id: crypto.randomUUID(),
      accepted: true,
      created_at: new Date().toISOString(),
      oem: selectedOEM,
      supplier: f.supplier || '',
      supplier_origin: f.supplier_origin || '',
      category: f.category || 'watchlist',
      status: f.status || 'watchlist',
      component: f.component || '',
      europe_location: f.europe_location || '',
      claim: f.claim || '',
      confidence: Number(f.confidence || 0),
      sources: Array.isArray(f.sources) ? f.sources : []
    }))
    .filter(f => f.supplier && f.claim);

  findings = [...findings.filter(f => f.oem !== selectedOEM), ...cleaned];
  localStorage.setItem('findings', JSON.stringify(findings));
  showStatus(`Added ${cleaned.length} findings for ${selectedOEM}.`, false);
  renderResults();
}

function renderResults() {
  const q = (document.getElementById('searchBox')?.value || '').toLowerCase();
  const cat = document.getElementById('categoryFilter')?.value || 'all';
  let data = findings.filter(f => f.oem === selectedOEM);
  if (cat !== 'all') data = data.filter(f => f.category === cat || f.status === cat);
  if (q) data = data.filter(f => JSON.stringify(f).toLowerCase().includes(q));

  if (!data.length) { resultsEl.innerHTML = '<p>No findings yet for this OEM. Click Research selected OEM or import JSON.</p>'; return; }
  resultsEl.innerHTML = data.map(f => `
    <div class="finding">
      <h3>${escapeHtml(f.supplier || 'Unknown supplier')}</h3>
      <div class="meta">${escapeHtml(f.category || '')} · ${escapeHtml(f.status || '')} · Confidence: ${escapeHtml(String(f.confidence ?? ''))}</div>
      <div><strong>Origin:</strong> ${escapeHtml(f.supplier_origin || '')}</div>
      <div><strong>Component:</strong> ${escapeHtml(f.component || '')}</div>
      <div><strong>Europe location:</strong> ${escapeHtml(f.europe_location || '')}</div>
      <p>${escapeHtml(f.claim || '')}</p>
      <div class="sources"><strong>Sources:</strong><br>${(f.sources || []).map(s => `${escapeHtml(s.title || 'Source')} ${s.url ? `— <a href="${escapeAttr(s.url)}" target="_blank">link</a>` : ''}<br><em>${escapeHtml(s.short_evidence || '')}</em>`).join('<br>')}</div>
    </div>
  `).join('');
}

function showStatus(msg, isError) { statusEl.innerHTML = msg; statusEl.className = isError ? 'error' : 'ok'; }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}

function exportCsv() {
  const rows = findings.filter(f => f.oem === selectedOEM);
  const header = ['OEM','Supplier','Origin','Category','Status','Component','Europe Location','Confidence','Claim','Sources'];
  const csv = [header, ...rows.map(f => [f.oem, f.supplier, f.supplier_origin, f.category, f.status, f.component, f.europe_location, f.confidence, f.claim, (f.sources||[]).map(s => s.url).join(' | ')])]
    .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  download(`${selectedOEM.replace(/\W+/g,'_')}_suppliers.csv`, csv, 'text/csv');
}
function exportJson() { download(`${selectedOEM.replace(/\W+/g,'_')}_suppliers.json`, JSON.stringify(findings.filter(f => f.oem === selectedOEM), null, 2), 'application/json'); }
function exportHtml() { download(`${selectedOEM.replace(/\W+/g,'_')}_report.html`, `<!doctype html><html><body><h1>${selectedOEM} Supplier Report</h1>${resultsEl.innerHTML}</body></html>`, 'text/html'); }

function copyPrompt() { navigator.clipboard.writeText(researchPrompt(selectedOEM)); showStatus('Research prompt copied.', false); }
function clearFindings() { findings = findings.filter(f => f.oem !== selectedOEM); localStorage.setItem('findings', JSON.stringify(findings)); renderResults(); showStatus(`Cleared ${selectedOEM} findings.`, false); }

function addOem() {
  const name = document.getElementById('newOemName').value.trim();
  if (!name) return;
  if (!OEMS.includes(name)) OEMS.push(name);
  selectedOEM = name;
  renderOEMs(); renderResults();
}

document.getElementById('researchBtn').onclick = runResearch;
document.getElementById('copyPromptBtn').onclick = copyPrompt;
document.getElementById('importJsonBtn').onclick = importManualJson;
document.getElementById('exportCsvBtn').onclick = exportCsv;
document.getElementById('exportJsonBtn').onclick = exportJson;
document.getElementById('exportHtmlBtn').onclick = exportHtml;
document.getElementById('clearBtn').onclick = clearFindings;
document.getElementById('addOemBtn').onclick = addOem;
document.getElementById('searchBox').oninput = renderResults;
document.getElementById('categoryFilter').onchange = renderResults;
renderOEMs(); renderResults();
