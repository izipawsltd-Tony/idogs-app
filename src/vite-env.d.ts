/// <reference types="vite/client" />

// libheif-js ships no TypeScript types for its pre-bundled WASM entry
// point (src/lib/imageCompression.ts's client-side HEIC/HEIF decoder —
// dynamically imported so it never affects the main bundle). Untyped by
// design: this module's actual shape depends on which Emscripten build
// variant is loaded, which imageCompression.ts's own loadLibheif()
// already handles defensively at runtime rather than relying on a type.
declare module 'libheif-js/wasm-bundle'
