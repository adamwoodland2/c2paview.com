// Content Credentials Viewer - inspect and validate C2PA manifests entirely in the browser,
// using the official c2pa-js SDK (the C2PA reference implementation compiled to WASM).
import { createC2pa, selectProducer } from './lib/c2pa.esm.min.js';

const $ = (q) => document.querySelector(q);

const c2paReady = createC2pa({
  wasmSrc: './lib/toolkit_bg.wasm',
  workerSrc: './lib/c2pa.worker.min.js',
});

// Trust lists (self-hosted snapshots): the official C2PA Conformance Program anchors, its
// TSA anchors, and the interim CAI list most production assets still chain to. With these,
// a valid-but-unknown signer surfaces as signingCredential.untrusted instead of passing green.
let trustEnabled = false;
const trustReady = (async () => {
  try {
    const [a1, a2, a3, allowed, cfg] = await Promise.all([
      'trust/c2pa-trust-list.pem', 'trust/c2pa-tsa-trust-list.pem', 'trust/interim-anchors.pem',
      'trust/interim-allowed.sha256.txt', 'trust/store.cfg',
    ].map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.text(); })));
    trustEnabled = true;
    return {
      trust: { trustAnchors: `${a1}\n${a2}\n${a3}`, allowedList: allowed, trustConfig: cfg },
      verify: { verifyTrust: true },
    };
  } catch (e) { return null; }   // offline before first cache: integrity-only
})();

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

// Where in the manifest a failure sits, from the jumbf path in the status url.
const WHERE_HINTS = {
  'c2pa.hash.data': 'the hash covering the actual image/audio content',
  'c2pa.hash.boxes': 'the hash covering the file structure',
  'c2pa.hash.bmff': 'the hash covering the video container',
  'c2pa.thumbnail.claim.jpeg': 'the embedded claim thumbnail',
  'c2pa.thumbnail.claim.png': 'the embedded claim thumbnail',
  'c2pa.thumbnail.ingredient.jpeg': "an ingredient's thumbnail",
  'c2pa.actions': 'the recorded edit history',
  'c2pa.ingredient': 'an ingredient reference',
};
function whereOf(url) {
  const m = /\/c2pa\.assertions\/([^/]+)/.exec(url || '');
  if (!m) return null;
  const name = m[1].replace(/__\d+$/, '');
  return WHERE_HINTS[name] || `the "${name}" assertion`;
}

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

  // Actions assertion, grouped into the consumer categories the C2PA UX guidance suggests.
  const ACTION_LABELS = {
    'c2pa.created': 'Created', 'c2pa.opened': 'Opened', 'c2pa.saved': 'Saved',
    'c2pa.color_adjustments': 'Colour adjustments (brightness, tone, filters)',
    'c2pa.filtered': 'Colour adjustments (brightness, tone, filters)',
    'c2pa.cropped': 'Cropped', 'c2pa.resized': 'Resized', 'c2pa.orientation': 'Rotated or flipped',
    'c2pa.edited': 'Edited', 'c2pa.drawing': 'Drawing or painting',
    'c2pa.placed': 'Compositing (merging, layering)', 'c2pa.removed': 'Content removed',
    'c2pa.transcoded': 'Format conversion', 'c2pa.converted': 'Format conversion',
    'c2pa.published': 'Published', 'c2pa.repackaged': 'Repackaged', 'c2pa.redacted': 'Information redacted',
  };
  const actions = manifest.assertions && (manifest.assertions.get('c2pa.actions') || []);
  const seen = new Map();
  for (const a of actions) {
    for (const act of (a.data && a.data.actions) || []) {
      let label = ACTION_LABELS[act.action] || (act.action || '').replace(/^c2pa\./, '').replace(/[_.]/g, ' ');
      if (act.softwareAgent) label += ` - ${typeof act.softwareAgent === 'string' ? act.softwareAgent : act.softwareAgent.name}`;
      if (act.digitalSourceType && /trainedAlgorithmicMedia/.test(act.digitalSourceType)) label += ' · fully AI-generated';
      else if (act.digitalSourceType && /compositeWithTrainedAlgorithmicMedia/.test(act.digitalSourceType)) label += ' · partly AI-generated';
      seen.set(label, (seen.get(label) || 0) + 1);
    }
  }
  const actList = [...seen.entries()].map(([label, n]) => n > 1 ? `${label} (×${n})` : label);
  if (actList.length) {
    card.appendChild(elc('h2', '', 'What was done'));
    const ul = elc('ul', 'actions');
    for (const a of actList) ul.appendChild(elc('li', '', a));
    card.appendChild(ul);
  }

  // Other assertions, tagged by origin: system-recorded vs entered by the creator
  // ("created" vs "gathered" in C2PA terms).
  const GATHERED = {
    'stds.schema-org.CreativeWork': 'Creator and attribution details',
    'stds.schema-org.CreativeWork__1': 'Creator and attribution details',
    'c2pa.training-mining': 'AI training and data-mining preferences',
    'cawg.training-mining': 'AI training and data-mining preferences',
  };
  const SYSTEM = {
    'stds.exif': 'Camera details (EXIF)',
    'c2pa.depthmap.GDepth': 'Depth map',
  };
  const SKIP = /^c2pa\.(actions|hash\.|thumbnail|ingredient|claim)/;
  const others = [];
  for (const a of (manifest.assertions && manifest.assertions.data) || []) {
    if (!a.label || SKIP.test(a.label)) continue;
    if (GATHERED[a.label]) others.push(`${GATHERED[a.label]} - entered by the creator`);
    else if (SYSTEM[a.label]) others.push(`${SYSTEM[a.label]} - recorded by the capture device`);
    else if (a.label === 'stds.exif') others.push('Camera details (EXIF) - recorded by the capture device');
    else others.push(`${a.label} - recorded by the signing app`);
  }
  if (others.length) {
    card.appendChild(elc('h2', '', 'Also recorded'));
    const ul = elc('ul', 'actions');
    for (const o of [...new Set(others)]) ul.appendChild(elc('li', '', o));
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
      const stats = ing.validationStatus || [];
      const bad = stats.filter((s) => s.code !== 'signingCredential.untrusted').length;
      const untrusted = stats.length > 0 && !bad;
      const st = elc('span', 'ing-status' + (bad ? ' bad' : ''),
        bad ? ' · has validation issues' : untrusted ? ' · signer not on the trust lists' : (ing.manifest ? ' · carries its own credentials' : ''));
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
    postMortem(file, banner);
    return;
  }
  const status = store.validationStatus || [];
  const untrustedOnly = status.length > 0 && status.every((s) => s.code === 'signingCredential.untrusted');
  if (status.length === 0) {
    banner.appendChild(elc('div', 'banner good', trustEnabled
      ? '✓ Content Credentials are present and valid - the file has not been changed since it was signed, and the signer is on the C2PA trust lists.'
      : '✓ Content Credentials are present and valid - the file has not been changed since it was signed. (Trust lists unavailable offline: signer identity not checked.)'));
  } else if (untrustedOnly) {
    const b = elc('div', 'banner warn', '✓ The file has not been changed since it was signed - but the signer is not on the C2PA trust lists, so the identity of the signer can\u2019t be verified. Judge the issuer name below as you would an unknown email sender.');
    banner.appendChild(b);
  } else {
    const b = elc('div', 'banner bad', '✗ Content Credentials are present but validation FAILED:');
    const ul = elc('ul');
    for (const s of status) {
      const li = elc('li');
      li.appendChild(elc('code', '', s.code));
      li.appendChild(document.createTextNode(` - ${CODE_HINTS[s.code] || s.explanation || ''}`));
      const where = whereOf(s.url);
      if (where) {
        li.appendChild(document.createElement('br'));
        li.appendChild(elc('span', 'where', `Where: ${where}.`));
      }
      ul.appendChild(li);
    }
    b.appendChild(ul);
    const total = Object.keys(store.manifests || {}).length;
    if (total > 1) {
      const affected = new Set();
      for (const s of status) {
        const m = /\/c2pa\/([^/]+)\//.exec(s.url || '');
        if (m) affected.add(m[1]);
      }
      const okCount = total - affected.size;
      if (affected.size && okCount > 0) {
        b.appendChild(elc('div', 'affected',
          `Affected: ${affected.size} of ${total} manifests (${[...affected].join(', ')}). The other ${okCount} report${okCount === 1 ? 's' : ''} no issues.`));
      }
    }
    banner.appendChild(b);
  }

  const count = Object.keys(store.manifests || {}).length;
  manifestEl.appendChild(renderManifest(store.activeManifest, count > 1 ? `Active manifest (of ${count} in the file)` : 'Manifest'));


  try {
    $('#raw').textContent = JSON.stringify(store, (k, v) => (k === 'parent' || k === 'node' ? undefined : v), 2);
    rawWrap.hidden = false;
  } catch (e) { /* circular - skip raw view */ }
}

// ------------------------------------------------------------------ stripping post-mortem
// When a file has no credentials, look for the debris a metadata stripper leaves behind:
// XMP provenance pointers and JUMBF fragments survive many pipelines that drop the manifest.
async function postMortem(file, banner) {
  let text;
  try {
    const cap = Math.min(file.size, 64 * 1048576);
    text = new TextDecoder('latin1').decode(new Uint8Array(await file.slice(0, cap).arrayBuffer()));
  } catch (e) { return; }
  const traces = [];
  if (text.includes('dcterms:provenance')) traces.push('The file\u2019s XMP metadata still contains a dcterms:provenance pointer to a C2PA manifest that is no longer in the file.');
  if (/https?:\/\/[^"'<>\s]{4,200}\.c2pa/.test(text)) traces.push('The metadata references a remote .c2pa manifest URL - the credentials may live there rather than in the file (this viewer only reads embedded manifests).');
  if (text.includes('contentauth:urn:uuid') || text.includes('c2pa_manifest')) traces.push('Fragments of a C2PA manifest identifier remain in the file.');
  if (/jumb.{0,32}c2pa/s.test(text)) traces.push('A leftover JUMBF/C2PA fragment is present but not readable as a manifest - it was probably truncated by an editor or converter.');
  const wrap = elc('div', 'banner ' + (traces.length ? 'warn' : 'none'));
  if (traces.length) {
    wrap.appendChild(document.createTextNode('But there is debris: this file very likely HAD Content Credentials that were stripped along the way.'));
    const ul = elc('ul');
    for (const t of traces) ul.appendChild(elc('li', '', t));
    wrap.appendChild(ul);
    wrap.appendChild(elc('div', '', 'Common culprits: image compressors, CMS/social-media uploads, screenshots, format conversion and "save for web" exports - most discard metadata by default.'));
  } else {
    wrap.appendChild(document.createTextNode('No traces of stripped credentials either. If this file once carried them, the removal was clean - re-encoding, screenshots and most upload pipelines leave nothing behind.'));
  }
  banner.appendChild(wrap);
}

// ------------------------------------------------------------------ reading
async function inspect(file) {
  $('#result').hidden = false;
  $('#banner').replaceChildren(elc('div', 'banner none', 'Reading…'));
  $('#manifest').replaceChildren();
  try {
    const c2pa = await c2paReady;
    const settings = await trustReady;
    const { manifestStore } = await c2pa.read(file, settings ? { settings } : undefined);
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
