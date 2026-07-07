import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ledger = JSON.parse(await readFile("docs/development-ledger.json", "utf8"));
const dashboard = await readFile("docs/development-ledger.html", "utf8");

const allowedStatuses = new Set(["green", "yellow", "red"]);

assert.equal(ledger.schemaVersion, 1, "ledger schemaVersion must be 1");
assert.ok(ledger.integratedDeliverable, "ledger must name the final integrated deliverable");
assert.ok(ledger.workflowRule?.includes("One active gate at a time"), "workflow rule must preserve one-active-gate discipline");
assert.ok(Array.isArray(ledger.gates), "ledger.gates must be an array");
assert.ok(ledger.gates.length >= 10, "ledger must include the full gated project arc, not only the next task");

const ids = new Set();
const activeGates = [];
let previousSequence = 0;

for (const gate of ledger.gates) {
  assert.ok(gate.id, "every gate must have an id");
  assert.ok(!ids.has(gate.id), `duplicate gate id: ${gate.id}`);
  ids.add(gate.id);

  assert.ok(Number.isInteger(gate.sequence), `${gate.id} must have an integer sequence`);
  assert.ok(gate.sequence > previousSequence, `${gate.id} must be in increasing sequence order`);
  previousSequence = gate.sequence;

  assert.ok(gate.title, `${gate.id} must have a title`);
  assert.ok(allowedStatuses.has(gate.status), `${gate.id} has invalid status ${gate.status}`);
  assert.equal(typeof gate.active, "boolean", `${gate.id} must explicitly set active`);
  assert.ok(gate.rationale, `${gate.id} must include rationale`);
  assert.ok(gate.completionStandard, `${gate.id} must include completion standard`);

  if (gate.active) activeGates.push(gate);

  if (gate.status === "green") {
    assert.ok(Array.isArray(gate.evidence) && gate.evidence.length > 0, `${gate.id} is green but has no evidence`);
  }

  if (gate.status === "yellow") {
    assert.ok(gate.auditDebtNote || /audit|unaudited|unverified/i.test(gate.note || ""), `${gate.id} is yellow but lacks an audit-debt note`);
  }

  if (gate.status === "red") {
    assert.ok(gate.note, `${gate.id} is red but lacks a note explaining not started/failed/blocked status`);
  }

  assert.ok(dashboard.includes(`data-ledger-id="${gate.id}"`), `dashboard missing gate ${gate.id}`);
  assert.ok(dashboard.includes(`status-${gate.status}`), `dashboard missing status class for ${gate.status}`);
}

const allGatesGreen = ledger.gates.every((gate) => gate.status === "green" && gate.active === false);

if (allGatesGreen) {
  assert.equal(activeGates.length, 0, "completed ledger must not have an active gate");
  assert.equal(ledger.activeGateId, null, "completed ledger activeGateId must be null");
  assert.ok(dashboard.includes("All gates are green"), "completed dashboard must state that all gates are green");
} else {
  assert.equal(activeGates.length, 1, "exactly one gate must be active");
  assert.equal(activeGates[0].id, ledger.activeGateId, "activeGateId must match the active gate");
  assert.notEqual(activeGates[0].status, "green", "active gate must not already be green/closed");
  assert.ok(dashboard.includes(`data-ledger-id="${ledger.activeGateId}" data-active="true"`), "dashboard must mark the active gate");
}

assert.ok(dashboard.includes("Every yellow is audit debt"), "dashboard must state the yellow/audit-debt rule");

assert.ok(Array.isArray(ledger.history), "ledger.history must be an array");
assert.ok(ledger.history.length >= 4, "ledger history must include the backward path to current state");
for (const item of ledger.history) {
  assert.ok(item.id, "history item must have id");
  assert.ok(allowedStatuses.has(item.status), `${item.id} has invalid history status`);
  assert.ok(item.summary, `${item.id} must have summary`);
}

console.log("Development ledger verified: statuses, active/completed state, evidence, audit-debt rules, and dashboard sync are coherent.");
