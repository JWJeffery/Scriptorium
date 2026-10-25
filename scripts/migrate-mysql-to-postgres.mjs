// Copies an existing Scriptorium MySQL database into the empty PostgreSQL database.
//
//   SCRIPTORIUM_MYSQL_SOURCE_URL=mysql://user:pass@host:3306/scriptorium \
//   DATABASE_URL=postgresql://user:pass@host:5432/scriptorium \
//   node scripts/migrate-mysql-to-postgres.mjs [--dry-run]
//
// What it guarantees:
//   * The MySQL database is only read, never changed.
//   * Every id and timestamp is copied exactly (nothing is regenerated).
//   * The target must be empty and already have the PostgreSQL schema (pnpm prisma:migrate:deploy).
//   * All rows are written in ONE transaction. Afterwards each table is read back and compared by
//     row count and SHA-256 checksum; any difference rolls everything back, leaving PostgreSQL empty.
//   * --dry-run does all of the above and then rolls back on purpose, so you can see the report first.
// A JSON report is written next to where you run it: migration-report-<time>.json.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

// Use the repository's .env for any setting not already given on the command line.
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*?)"?\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
} catch {
  // No .env file: rely on the environment.
}

const requireFromWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const mysql = requireFromWeb("mysql2/promise");
const { PrismaClient, Prisma } = requireFromWeb("@prisma/client");

const sourceUrl = process.env.SCRIPTORIUM_MYSQL_SOURCE_URL;
const dryRun = process.argv.includes("--dry-run");
if (!sourceUrl) {
  console.error("Set SCRIPTORIUM_MYSQL_SOURCE_URL to the MySQL database you are copying FROM.");
  process.exit(2);
}
if (!/^postgres(ql)?:/.test(process.env.DATABASE_URL ?? "")) {
  console.error("DATABASE_URL must be the PostgreSQL database you are copying TO.");
  process.exit(2);
}

const models = Prisma.dmmf.datamodel.models;
const modelByName = new Map(models.map((model) => [model.name, model]));

// Parents before children, so foreign keys are satisfied as rows are inserted.
function orderModels() {
  const ordered = [];
  const done = new Set();
  const visit = (model) => {
    if (done.has(model.name)) return;
    done.add(model.name);
    for (const field of model.fields) {
      if (field.kind === "object" && field.relationFromFields?.length) visit(modelByName.get(field.type));
    }
    ordered.push(model);
  };
  models.forEach(visit);
  return ordered;
}

const scalarFields = (model) => model.fields.filter((field) => field.kind === "scalar" || field.kind === "enum");
const delegateName = (model) => model.name[0].toLowerCase() + model.name.slice(1);

// A value as MySQL returned it -> the value Prisma expects for the PostgreSQL column.
function toPrismaValue(field, value) {
  if (value === null || value === undefined) return field.type === "Json" ? Prisma.DbNull : null;
  switch (field.type) {
    case "Boolean": return Boolean(value);
    case "DateTime": return value instanceof Date ? value : new Date(value);
    case "Bytes": return Buffer.from(value);
    case "BigInt": return BigInt(value);
    case "Int": case "Float": return Number(value);
    case "Json": return typeof value === "string" && !field.isRequired ? safeParse(value) : value;
    default: return value;
  }
}
const safeParse = (text) => { try { return JSON.parse(text); } catch { return text; } };

// One stable text form per value, used identically for both databases.
function canonical(field, value) {
  if (value === null || value === undefined || value === Prisma.DbNull || value === Prisma.JsonNull) return null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `hex:${Buffer.from(value).toString("hex")}`;
  if (typeof value === "bigint") return value.toString();
  if (field.type === "Json") return stable(value);
  return value;
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function tableDigest(model, rows) {
  const fields = scalarFields(model);
  const idField = fields.find((field) => field.isId) ?? fields[0];
  const lines = rows.map((row) => ({ key: String(canonical(idField, row[idField.name])), line: JSON.stringify(fields.map((field) => canonical(field, row[field.name]))) }));
  lines.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const hash = createHash("sha256");
  for (const { line } of lines) hash.update(line).update("\n");
  return hash.digest("hex");
}

const source = await mysql.createConnection({ uri: sourceUrl, timezone: "Z", dateStrings: false, supportBigNumbers: true });
const prisma = new PrismaClient();
const ordered = orderModels();
const report = { startedAt: new Date().toISOString(), dryRun, tables: [], orphans: [], samples: [], ok: false };

class Mismatch extends Error {}
const ROLLBACK = Symbol("dry-run rollback");

try {
  // Source rows, read once.
  const sourceRows = new Map();
  for (const model of ordered) {
    const [rows] = await source.query(`SELECT * FROM \`${model.name}\``);
    sourceRows.set(model.name, rows.map((row) => Object.fromEntries(scalarFields(model).map((field) => [field.name, toPrismaValue(field, row[field.name])]))));
  }

  // The target must be empty.
  for (const model of ordered) {
    const existing = await prisma[delegateName(model)].count();
    if (existing > 0) throw new Error(`PostgreSQL already has ${existing} row(s) in ${model.name}. Refusing to merge into a non-empty database.`);
  }

  await prisma.$transaction(async (tx) => {
    for (const model of ordered) {
      const rows = sourceRows.get(model.name);
      const batch = model.name === "TextSpan" || model.name === "PassageEmbedding" ? 100 : 500;
      for (let i = 0; i < rows.length; i += batch) await tx[delegateName(model)].createMany({ data: rows.slice(i, i + batch) });
    }

    for (const model of ordered) {
      const sourceList = sourceRows.get(model.name);
      const targetList = await tx[delegateName(model)].findMany();
      const sourceDigest = tableDigest(model, sourceList);
      const targetDigest = tableDigest(model, targetList);
      const entry = { table: model.name, sourceRows: sourceList.length, targetRows: targetList.length, sourceSha256: sourceDigest, targetSha256: targetDigest, match: sourceList.length === targetList.length && sourceDigest === targetDigest };
      report.tables.push(entry);
    }

    // Foreign keys are enforced by PostgreSQL, but report orphans explicitly anyway.
    for (const model of ordered) {
      for (const field of model.fields) {
        if (field.kind !== "object" || !field.relationFromFields?.length) continue;
        const parent = modelByName.get(field.type);
        const [fk] = field.relationFromFields;
        const [pk] = field.relationToFields;
        const rows = await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${model.name}" c LEFT JOIN "${parent.name}" p ON p."${pk}" = c."${fk}" WHERE c."${fk}" IS NOT NULL AND p."${pk}" IS NULL`);
        report.orphans.push({ child: model.name, column: fk, parent: parent.name, orphans: rows[0].n });
      }
    }

    // A few complete chains, spot-checked end to end: annotation -> version -> document -> citation.
    const annotations = await tx.annotation.findMany({ take: 3, orderBy: { createdAt: "asc" }, include: { citations: true } });
    for (const annotation of annotations) {
      const version = await tx.documentVersion.findUnique({ where: { id: annotation.versionId ?? "" } });
      const document = await tx.document.findUnique({ where: { id: annotation.documentId } });
      report.samples.push({ annotationId: annotation.id, selectedTextSha256: createHash("sha256").update(annotation.selectedText).digest("hex").slice(0, 16), versionFound: Boolean(version), documentTitle: document?.title ?? null, citations: annotation.citations.length });
    }

    const bad = report.tables.filter((entry) => !entry.match);
    const orphaned = report.orphans.filter((entry) => entry.orphans > 0);
    if (bad.length || orphaned.length) throw new Mismatch(`Verification failed for: ${[...bad.map((e) => e.table), ...orphaned.map((e) => `${e.child}.${e.column}`)].join(", ")}`);
    if (dryRun) throw ROLLBACK;
  }, { timeout: 30 * 60 * 1000, maxWait: 60 * 1000 });
  report.ok = true;
} catch (error) {
  if (error !== ROLLBACK) {
    report.error = error instanceof Error ? error.message : String(error);
  } else {
    report.ok = true;
    report.rolledBackOnPurpose = true;
  }
} finally {
  await source.end();
  await prisma.$disconnect();
}

report.finishedAt = new Date().toISOString();
const file = `migration-report-${report.startedAt.replace(/[:.]/g, "-")}.json`;
await writeFile(file, JSON.stringify(report, null, 2));

console.log(`\nTable                      MySQL rows  PostgreSQL rows  Checksum`);
for (const entry of report.tables) {
  console.log(`${entry.table.padEnd(26)} ${String(entry.sourceRows).padStart(10)}  ${String(entry.targetRows).padStart(15)}  ${entry.match ? "match" : "DIFFERENT"}`);
}
console.log(`Orphan check: ${report.orphans.every((entry) => entry.orphans === 0) ? "no orphaned rows" : "ORPHANS FOUND"} (${report.orphans.length} relations)`);
for (const sample of report.samples) console.log(`Sample chain: annotation ${sample.annotationId} -> version ${sample.versionFound ? "ok" : "MISSING"} -> "${sample.documentTitle}", ${sample.citations} citation(s)`);
console.log(`Report written to ${file}`);
if (report.error) {
  console.error(`\nFAILED. Nothing was changed in PostgreSQL (the copy is all-or-nothing).\n${report.error}`);
  process.exit(1);
}
console.log(dryRun ? "\nDry run complete: everything matched, and PostgreSQL was left empty on purpose." : "\nMigration complete: every table matched on row count and checksum.");
