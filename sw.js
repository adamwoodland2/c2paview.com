// Service worker for c2paview.com (fleet pattern: network-first code, cache-first big assets).
//
//  - The WASM validator and SDK are precached, so the whole tool works offline.
//  - Bump CACHE on deploys that change any precached file.
//  - Also receives Android share-sheet files (share_target POST /share): the shared file is
//    parked in a one-shot cache and the client picks it up after redirect.
const CACHE = 'cv-v6';
const CORE = [
	'/',
	'/index.html',
	'/styles.css',
	'/app.js',
	'/lib/c2pa.esm.min.js',
	'/lib/c2pa.worker.min.js',
	'/lib/toolkit_bg.wasm',
	'/favicon.svg',
	'/manifest.json',
	'/samples/signed.jpg',
	'/trust/c2pa-trust-list.pem',
	'/trust/c2pa-tsa-trust-list.pem',
	'/trust/interim-anchors.pem',
	'/trust/interim-allowed.sha256.txt',
	'/trust/store.cfg'
];

self.addEventListener('install', (e) => {
	e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
	e.waitUntil(
		caches.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== 'share-inbox').map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (e) => {
	const req = e.request;
	const url = new URL(req.url);
	if (url.origin !== location.origin) return;

	// Android share sheet: stash the file, then land the client on /?shared=1.
	if (req.method === 'POST' && url.pathname === '/share') {
		e.respondWith((async () => {
			const form = await req.formData();
			const file = form.get('file');
			if (file) {
				const c = await caches.open('share-inbox');
				await c.put('/shared-file', new Response(file, {
					headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'shared-file') },
				}));
			}
			return Response.redirect('/?shared=1', 303);
		})());
		return;
	}

	if (req.method !== 'GET') return;

	// The big immutable assets: cache-first.
	if (url.pathname.startsWith('/lib/') || url.pathname.startsWith('/samples/')) {
		e.respondWith(
			caches.open(CACHE).then(async (c) => {
				const hit = await c.match(req);
				if (hit) return hit;
				const res = await fetch(req);
				if (res.ok) c.put(req, res.clone());
				return res;
			})
		);
		return;
	}

	// Everything else: network-first so a redeploy shows up at once.
	e.respondWith(
		fetch(req)
			.then((res) => {
				if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
				return res;
			})
			.catch(async () => {
				const hit = await caches.match(req);
				if (hit) return hit;
				if (req.mode === 'navigate') { const shell = await caches.match('/index.html'); if (shell) return shell; }
				return Response.error();
			})
	);
});
