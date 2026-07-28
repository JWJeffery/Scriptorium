/** @type {import('next').NextConfig} */
const nextConfig = {
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
    "pdfjs-dist"
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
