/** @type {import('next').NextConfig} */
// `next dev` compiles with eval-based source maps and talks to its dev server
// over a websocket; production needs neither, so only allow them in dev.
const isDev = process.env.NODE_ENV !== "production";

const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js injects inline bootstrap scripts; 'wasm-unsafe-eval' is for pdf.js.
  // Google's sign-in and file picker (Add a book > From Google Drive) load from these two addresses only.
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://accounts.google.com https://apis.google.com${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://accounts.google.com",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // The browser downloads a PDF picked in Google Drive straight from Google's Drive API.
  `connect-src 'self' blob: data: https://www.googleapis.com https://content.googleapis.com${isDev ? " ws: wss:" : ""}`,
  // Google's picker and sign-in run in their own frames.
  "frame-src https://docs.google.com https://drive.google.com https://accounts.google.com https://content.googleapis.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" }
];

const nextConfig = {
  poweredByHeader: false,
  // Scriptorium shows no remote or optimized images; switching the image
  // optimizer off removes that attack surface (and the sharp dependency's).
  images: { unoptimized: true },
  // Every request passes through middleware (the sign-in check), and Next.js keeps only the first 10 MB
  // of a request body that does. A book bigger than that arrived cut off and the upload failed (HTTP 500).
  // Match the 75 MB limit the upload route itself enforces (and Caddy's 100 MB cap in front of it).
  experimental: { middlewareClientMaxBodySize: "100mb" },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // These ship native binaries or dynamically load worker/WASM files in
  // ways webpack can't statically bundle. Without this, webpack tries to
  // parse @napi-rs/canvas's platform .node binary as JavaScript and the
  // build fails outright. serverExternalPackages tells Next.js to leave
  // them as normal Node require()s at runtime instead of bundling them -
  // this only affects server-side code (API routes, "runtime = nodejs"),
  // which is the only place any of these are used.
  serverExternalPackages: [
    "@napi-rs/canvas",
    "@napi-rs/canvas-linux-x64-gnu",
    "@napi-rs/canvas-linux-arm64-gnu",
    "@napi-rs/canvas-darwin-x64",
    "@napi-rs/canvas-darwin-arm64",
    "tesseract.js",
    "tesseract.js-core",
    // WebAssembly runtime + tokenizer for search by meaning (loaded when first needed)
    "onnxruntime-web",
    "@huggingface/tokenizers",
    // The job queue (ESM, talks to PostgreSQL directly)
    "pg-boss",
    "pg"
  ],
  // Belt-and-suspenders on top of serverExternalPackages: if webpack ever
  // does try to touch a .node binary (whatever the reason - a different
  // pnpm resolution layout, a package name serverExternalPackages didn't
  // happen to cover), handle it by file extension instead of failing to
  // parse it as JavaScript.
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.module.rules.push({ test: /\.node$/, use: "node-loader" });
    }
    return config;
  }
};

export default nextConfig;
