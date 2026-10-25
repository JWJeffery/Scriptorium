// Runs once when the web server starts. The Node-only work lives in instrumentation-node.ts, behind this
// runtime check, so that Next never tries to compile it for the edge runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
