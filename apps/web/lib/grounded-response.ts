export type GroundedEvidence = {
  id: string;
  kind: "text-span" | "annotation-passage";
  title: string;
  snippet: string;
  score: number;
  documentId: string;
  sourceId?: string;
  annotationId?: string;
  citationId?: string;
  locator?: string;
};

export type GroundedResponse = {
  supported: boolean;
  response: string;
  points: { text: string; evidenceIds: string[] }[];
  evidence: GroundedEvidence[];
  unsupported?: string;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function sentenceFromSnippet(value: string) {
  const text = clean(value);
  if (!text) return "";
  const sentence = text.split(/(?<=[.!?])\s+/)[0] ?? text;
  return sentence.slice(0, 320);
}

function evidenceLabel(index: number) {
  return `E${index + 1}`;
}

export function buildGroundedResponse(query: string, evidence: GroundedEvidence[], maxPoints = 4): GroundedResponse {
  const usableEvidence = evidence
    .filter((item) => item.score > 0 && clean(item.snippet) && item.documentId && (item.locator || item.annotationId || item.citationId))
    .slice(0, Math.max(1, Math.min(maxPoints, 6)));

  if (!usableEvidence.length) {
    return {
      supported: false,
      response: "The current Scriptorium corpus does not provide enough recovered passage evidence to answer this query.",
      points: [],
      evidence: [],
      unsupported: clean(query) || "No supported query supplied."
    };
  }

  const points = usableEvidence.map((item, index) => {
    const label = evidenceLabel(index);
    const locator = item.locator ? ` (${item.locator})` : "";
    const text = `${sentenceFromSnippet(item.snippet)} [${label}${locator}]`;
    return { text, evidenceIds: [item.id] };
  });

  return {
    supported: true,
    response: points.map((point) => point.text).join("\n"),
    points,
    evidence: usableEvidence
  };
}
