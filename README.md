# c2paview.com

**Live: <https://c2paview.com/>**

Drop any image, video or audio file and inspect its C2PA Content Credentials - who signed it,
when, with what tool, whether it is AI-generated, and whether it has been altered since signing.
Free, runs entirely in your browser, no account, no adverts, and the file is never uploaded.

## What it does

- Reads the C2PA manifest store from JPEG, PNG, WebP, AVIF, GIF, TIFF, SVG, MP4, MOV, MP3, WAV,
  PDF and `.c2pa` sidecar files.
- Validates it locally: content hashes, claim signature and certificate chain, via the official
  [c2pa-js](https://github.com/contentauth/c2pa-js) SDK (the C2PA reference implementation,
  `c2pa-rs`, compiled to WebAssembly and self-hosted here).
- Shows the story in plain language: signer, signing time, claim generator, producer, the actions
  performed ("opened", "adjusted colour", "AI-generated"), and the ingredient tree with
  thumbnails - plus the raw manifest JSON for the curious.
- Explains failures: each C2PA validation code (for example `assertion.dataHash.mismatch`) comes
  with a plain-English line saying what it means.

A green result proves integrity (unchanged since signing), not identity - the issuer name is
shown so you can judge it yourself. The bundled sample is `CA.jpg` from the
[c2pa-rs test fixtures](https://github.com/contentauth/c2pa-rs), signed with the C2PA test
certificate.

## Privacy

No backend, no cookies, no analytics, no uploads. The WASM validator runs in a worker in your
tab; load the page, go offline, and it still works.

## Licence

MIT for this site's own code - see [LICENSE](LICENSE). Bundled: c2pa-js and its WASM toolkit
(MIT/Apache-2.0, Content Authenticity Initiative); sample image from the c2pa-rs test suite
(MIT/Apache-2.0).

Built by Adam Woodland with the assistance of AI (Anthropic Claude).
