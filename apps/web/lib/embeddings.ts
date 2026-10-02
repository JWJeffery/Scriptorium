import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalize } from "./embedding-math.ts";
import { getStorageRoot } from "./server-storage.ts";

// Search by meaning. A small sentence-embedding model (all-MiniLM-L6-v2, 23 MB,
// English) turns a passage into 384 numbers; passages about the same thing end up
// with similar numbers. It runs on this computer through the WebAssembly build of
// ONNX Runtime, so nothing is sent anywhere and no native code is installed.
//
// The model files are fetched once from huggingface.co (fixed address, checked
// against pinned SHA-256 sums) into SCRIPTORIUM_MODEL_DIR.

export const MODEL_NAME = "all-MiniLM-L6-v2";
const REPOSITORY = "Xenova/all-MiniLM-L6-v2";
const MODEL_FILES = [
  { path: "tokenizer.json", sha256: "da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0" },
  { path: "tokenizer_config.json", sha256: "9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3" },
  { path: "onnx/model_quantized.onnx", sha256: "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1" }
];
const MAX_TOKENS = 256;

/** A deterministic stand-in (hashed bag of words) used by automated tests; never in normal use. */
const FAKE = () => process.env.SCRIPTORIUM_FAKE_EMBEDDINGS === "1";
export const activeModelName = () => (FAKE() ? "fake-bag-of-words-64" : MODEL_NAME);

export function modelDirectory() {
  const configured = process.env.SCRIPTORIUM_MODEL_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(path.dirname(getStorageRoot()), "scriptorium-models", MODEL_NAME);
}

export async function modelStatus() {
  if (FAKE()) return { ready: true, model: activeModelName(), directory: "(built-in test embedder)", bytes: 0 };
  const directory = modelDirectory();
  let bytes = 0;
  let ready = true;
  for (const file of MODEL_FILES) {
    const target = path.join(directory, file.path);
    if (!existsSync(target)) { ready = false; continue; }
    bytes += (await stat(target)).size;
  }
  return { ready, model: MODEL_NAME, directory, bytes };
}

async function sha256File(file: string) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

/** Download any missing model files, verifying each against its pinned checksum. */
export async function ensureModel(onStep?: (message: string) => void) {
  if (FAKE()) return;
  const directory = modelDirectory();
  for (const file of MODEL_FILES) {
    const target = path.join(directory, file.path);
    if (existsSync(target) && (await sha256File(target)) === file.sha256) continue;
    onStep?.(`Downloading ${file.path}…`);
    await mkdir(path.dirname(target), { recursive: true });
    const response = await fetch(`https://huggingface.co/${REPOSITORY}/resolve/main/${file.path}`);
    if (!response.ok) throw new Error(`The model file ${file.path} could not be downloaded (${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error(`The downloaded ${file.path} did not match its expected checksum, so it was discarded.`);
    const partial = `${target}.partial`;
    await writeFile(partial, bytes);
    await rename(partial, target);
  }
}

type Runtime = {
  embed: (texts: string[]) => Promise<Float32Array[]>;
};
let runtimePromise: Promise<Runtime> | null = null;

async function loadRuntime(): Promise<Runtime> {
  await ensureModel();
  const directory = modelDirectory();
  const ort = await import("onnxruntime-web");
  const { Tokenizer } = await import("@huggingface/tokenizers");
  const tokenizer = new Tokenizer(JSON.parse(await readFile(path.join(directory, "tokenizer.json"), "utf8")), JSON.parse(await readFile(path.join(directory, "tokenizer_config.json"), "utf8")));
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(await readFile(path.join(directory, "onnx/model_quantized.onnx")), { executionProviders: ["wasm"] });

  async function embedOne(text: string): Promise<Float32Array> {
    const ids = tokenizer.encode(text).ids.slice(0, MAX_TOKENS);
    if (ids.length === 0) return new Float32Array(384);
    const length = ids.length;
    const out = await session.run({
      input_ids: new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, length]),
      attention_mask: new ort.Tensor("int64", BigInt64Array.from(ids.map(() => BigInt(1))), [1, length]),
      token_type_ids: new ort.Tensor("int64", new BigInt64Array(length), [1, length])
    });
    const hidden = out[session.outputNames[0]];
    const [, sequence, width] = hidden.dims as number[];
    const data = hidden.data as Float32Array;
    const mean = new Float32Array(width);
    for (let i = 0; i < sequence; i += 1) for (let d = 0; d < width; d += 1) mean[d] += data[i * width + d] / sequence;
    return normalize(mean);
  }
  return { embed: async (texts) => { const result: Float32Array[] = []; for (const text of texts) result.push(await embedOne(text)); return result; } };
}

function fakeEmbed(text: string): Float32Array {
  const vector = new Float32Array(64);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    let hash = 0;
    for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    vector[hash % 64] += 1;
  }
  return normalize(vector);
}

/** Embed passages (or a query). Throws if the model cannot be loaded. */
export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  if (FAKE()) return texts.map(fakeEmbed);
  runtimePromise ??= loadRuntime().catch((error) => { runtimePromise = null; throw error; });
  return (await runtimePromise).embed(texts);
}
