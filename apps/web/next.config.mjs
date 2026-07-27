/** @type {import('next').NextConfig} */
const nextConfig = {
  // These ship native binaries or dynamically load worker/WASM files in
  // ways webpack can't statically bundle. Without this, webpack tries to
  // parse @napi-rs/canvas's platform .node binary as JavaScript and the
  // build fails outright. serverExternalPackages tells Next.js to leave
  // them as normal Node require()s at runtime instead of bundling them -
  // this only affects server-side code (API routes, "runtime = nodejs"),
  // which is the only place any of these are used.
  serverExternalPackages: ["@napi-rs/canvas", "tesseract.js", "tesseract.js-core"]
};

export default nextConfig;
