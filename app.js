// Content Credentials Viewer - inspect and validate C2PA manifests entirely in the browser,
// using the official c2pa-js SDK (the C2PA reference implementation compiled to WASM).
import { createC2pa, selectProducer } from './lib/c2pa.esm.min.js';

const $ = (q) => document.querySelector(q);

const c2paReady = createC2pa({
  wasmSrc: './lib/toolkit_bg.wasm',
  workerSrc: './lib/c2pa.worker.min.js',
});

// ------------------------------------------------------------------ helpers
function elc(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
const fmtBytes = (n) => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
};

// A friendly line for the machine-readable validation codes.
const CODE_HINTS = {
  'assertion.dataHash.mismatch': 'the pixels/bytes have been changed since signing',
  'assertion.hashedURI.mismatch': 'an assertion was altered after signing',
  'claimSignature.mismatch': 'the claim signature does not match',
  'signingCredential.untrusted': 'the signing certificate is not on the known-certificates list',
  'signingCredential.expired': 'the signing certificate had expired',
  'signingCredential.revoked': 'the signing certificate was revoked',
  'timeStamp.mismatch': 'the trusted timestamp does not match',
  'general.error': 'the manifest could not be read',
};

function kvRow(dl, k, v) {
  if (v === null || v === undefined || v === '') return;
  dl.appendChild(elc('dt', '', k));
  const dd = elc('dd');
  if (v instanceof Node) dd.appendChild(v); else dd.textContent = String(v);
  dl.appendChild(dd);
}

// ------------------------------------------------------------------ rendering
function renderManifest(manifest, heading) {
  const card = elc('section', 'card');
  card.appendChild(elc('h2', '', heading));
  const dl = elc('dl', 'kv');

  kvRow(dl, 'Title', manifest.title);
  kvRow(dl, 'Format', manifest.format);
  const producer = selectProducer(manifest);
  kvRow(dl, 'Produced by', producer && producer.name);
  kvRow(dl, 'Claim generator', (manifest.claimGenerator || '').split('(')[0].trim().replace(/[_/]/g, ' '));
  const sig = manifest.signatureInfo || {};
  kvRow(dl, 'Signed by', sig.issuer);
  kvRow(dl, 'Signed on', fmtDate(sig.time));
  kvRow(dl, 'Certificate serial', sig.cert_serial_number);
  card.appendChild(dl);

  // Actions assertion: what was done to the asset.
  const actions = manifest.assertions && (manifest.assertions.get('c2pa.actions') || []);
  const actList = [];
  for (const a of actions) {
    for (const act of (a.data && a.data.actions) || []) {
      let label = (act.action || '').replace(/^c2pa\./, '').replace(/([A-Z])/g, ' $1');
      if (act.parameters && act.parameters.name) label += ` (${act.parameters.name})`;
      if (act.softwareAgent) label += ` - ${typeof act.softwareAgent === 'string' ? act.softwareAgent : act.softwareAgent.name}`;
      if (act.digitalSourceType && /trainedAlgorithmicMedia/.test(act.digitalSourceType)) label += ' · AI-generated';
      actList.push(label);
    }
  }
  if (actList.length) {
    card.appendChild(elc('h2', '', 'What was done'));
    const ul = elc('ul', 'actions');
    for (const a of actList) ul.appendChild(elc('li', '', a));
    card.appendChild(ul);
  }

  // Ingredients: what it was made from.
  if (manifest.ingredients && manifest.ingredients.length) {
    card.appendChild(elc('h2', '', `Made from ${manifest.ingredients.length} ingredient${manifest.ingredients.length > 1 ? 's' : ''}`));
    const ul = elc('ul', 'ings');
    for (const ing of manifest.ingredients) {
      const li = elc('li');
      const thumb = ing.thumbnail && ing.thumbnail.getUrl && ing.thumbnail.getUrl();
      if (thumb) {
        const im = elc('img', 'ing-thumb');
        im.src = thumb.url; im.alt = '';
        li.appendChild(im);
      }
      li.appendChild(document.createTextNode(ing.title || '(untitled)'));
      const bad = (ing.validationStatus || []).length;
      const st = elc('span', 'ing-status' + (bad ? ' bad' : ''), bad ? ' · has validation issues' : (ing.manifest ? ' · carries its own credentials' : ''));
      li.appendChild(st);
      ul.appendChild(li);
      if (ing.manifest) {
        const sub = renderManifest(ing.manifest, `Ingredient: ${ing.title || ''}`);
        sub.classList.add('card');
        li.appendChild(sub);
      }
    }
    card.appendChild(ul);
  }
  return card;
}

function showResult(file, report) {
  $('#result').hidden = false;
  $('#fileName').textContent = file.name;
  $('#fileMeta').textContent = `${file.type || 'unknown type'} · ${fmtBytes(file.size)}`;
  const prev = $('#preview');
  prev.onerror = () => { prev.hidden = true; };
  if (file.type.startsWith('image/')) {
    prev.src = URL.createObjectURL(file);
    prev.hidden = false;
  } else prev.hidden = true;

  const banner = $('#banner');
  banner.replaceChildren();
  const manifestEl = $('#manifest');
  manifestEl.replaceChildren();
  const rawWrap = $('#rawWrap');
  rawWrap.hidden = true;

  if (report.error) {
    const b = elc('div', 'banner warn', `Could not read this file: ${report.error}`);
    banner.appendChild(b);
    return;
  }
  const store = report.manifestStore;
  if (!store || !store.activeManifest) {
    banner.appendChild(elc('div', 'banner warn', 'No Content Credentials found in this file - it carries no provenance information either way.'));
    return;
  }
  const status = store.validationStatus || [];
  if (status.length === 0) {
    banner.appendChild(elc('div', 'banner good', '✓ Content Credentials are present and valid - the file has not been changed since it was signed.'));
  } else {
    const b = elc('div', 'banner bad', '✗ Content Credentials are present but validation FAILED:');
    const ul = elc('ul');
    for (const s of status) {
      const li = elc('li');
      li.appendChild(elc('code', '', s.code));
      li.appendChild(document.createTextNode(` - ${CODE_HINTS[s.code] || s.explanation || ''}`));
      ul.appendChild(li);
    }
    b.appendChild(ul);
    banner.appendChild(b);
  }

  const count = Object.keys(store.manifests || {}).length;
  manifestEl.appendChild(renderManifest(store.activeManifest, count > 1 ? `Active manifest (of ${count} in the file)` : 'Manifest'));

  try {
    $('#raw').textContent = JSON.stringify(store, (k, v) => (k === 'parent' || k === 'node' ? undefined : v), 2);
    rawWrap.hidden = false;
  } catch (e) { /* circular - skip raw view */ }
}

// ------------------------------------------------------------------ reading
async function inspect(file) {
  $('#result').hidden = false;
  $('#banner').replaceChildren(elc('div', 'banner none', 'Reading…'));
  $('#manifest').replaceChildren();
  try {
    const c2pa = await c2paReady;
    const { manifestStore } = await c2pa.read(file);
    showResult(file, { manifestStore });
  } catch (e) {
    showResult(file, { error: e && e.message ? e.message : String(e) });
  }
}

// ------------------------------------------------------------------ wiring
const drop = $('#drop');
$('#browse').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', (e) => { if (e.target.files[0]) inspect(e.target.files[0]); });
for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); });
drop.addEventListener('drop', (e) => {
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) inspect(f);
});
$('#sample').addEventListener('click', async () => {
  const blob = await (await fetch('samples/signed.jpg')).blob();
  inspect(new File([blob], 'sample-signed.jpg', { type: 'image/jpeg' }));
});

// ------------------------------------------------------------------ PWA
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// Installed app opened via "Open with" (file_handlers): inspect the handed file directly.
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (params.files && params.files.length) inspect(await params.files[0].getFile());
  });
}
// Android share sheet: the service worker parked the shared file in a one-shot cache.
if (new URLSearchParams(location.search).get('shared')) {
  (async () => {
    try {
      const c = await caches.open('share-inbox');
      const res = await c.match('/shared-file');
      if (!res) return;
      await c.delete('/shared-file');
      const name = decodeURIComponent(res.headers.get('X-File-Name') || 'shared-file');
      const blob = await res.blob();
      inspect(new File([blob], name, { type: blob.type }));
      history.replaceState(null, '', '/');
    } catch (e) { /* ignore */ }
  })();
}

window.__C2PA = { inspect, ready: c2paReady };
