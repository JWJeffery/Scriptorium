const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "has", "have", "he", "her", "his", "in", "is", "it", "its", "of", "on", "or", "she", "that", "the", "their", "this", "to", "was", "were", "with"
]);

function stem(token: string) {
  return token
    .replace(/'(s)?$/g, "")
    .replace(/(ing|ed|es|s)$/g, "");
}

export function tokenizeForSimilarity(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .map(stem)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

export function weightedTermVector(text: string) {
  const vector = new Map<string, number>();
  for (const token of tokenizeForSimilarity(text)) {
    vector.set(token, (vector.get(token) ?? 0) + 1);
  }
  return vector;
}

export function cosineSimilarity(query: string, candidate: string) {
  const queryVector = weightedTermVector(query);
  const candidateVector = weightedTermVector(candidate);
  if (!queryVector.size || !candidateVector.size) return 0;

  let dot = 0;
  let queryMagnitude = 0;
  let candidateMagnitude = 0;

  for (const value of Array.from(queryVector.values())) queryMagnitude += value * value;
  for (const value of Array.from(candidateVector.values())) candidateMagnitude += value * value;

  for (const [term, value] of Array.from(queryVector.entries())) {
    dot += value * (candidateVector.get(term) ?? 0);
  }

  return dot / (Math.sqrt(queryMagnitude) * Math.sqrt(candidateMagnitude));
}

export function similaritySnippet(text: string, query: string) {
  const cleanText = text.replace(/\s+/g, " ").trim();
  const queryTokens = tokenizeForSimilarity(query);
  const lower = cleanText.toLowerCase();
  const index = queryTokens.map((token) => lower.indexOf(token)).filter((value) => value >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(index - 90, 0);
  const end = Math.min(index + 260, cleanText.length);
  return cleanText.slice(start, end);
}
