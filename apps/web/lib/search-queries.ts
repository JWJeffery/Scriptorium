import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.ts";
import { escapeLike } from "./search-text.ts";

// The SQL behind the Search panel's page results, kept here so scripts/verify-search-indexes.mjs can
// EXPLAIN exactly the query the app runs.

export type PageRow = { id: string; versionId: string; documentId: string; text: string; pdfPageIndex: bigint | number | null };

export const MAX_PAGE_CANDIDATES = 400;

// Latest version of each document only (newest createdAt, then highest id): older versions would
// repeat every hit. Written as NOT EXISTS (an anti-join) rather than `v.id = (SELECT ... LIMIT 1)`:
// PostgreSQL guessed that the correlated `=` kept about one version in two hundred, so it always
// planned "for each version, read all its pages" and never used the trigram index on the text.
export function pageQuery(whereExtra: Prisma.Sql, limit: number) {
  return Prisma.sql`
    SELECT ts.id, ts."versionId", v."documentId", ts.text,
           (ts.anchor->>'pdfPageIndex')::int AS "pdfPageIndex"
    FROM "TextSpan" ts
    JOIN "DocumentVersion" v ON v.id = ts."versionId"
    JOIN "Document" d ON d.id = v."documentId" AND d."deletedAt" IS NULL
    WHERE NOT EXISTS (SELECT 1 FROM "DocumentVersion" v2 WHERE v2."documentId" = v."documentId" AND (v2."createdAt", v2.id) > (v."createdAt", v.id))
    ${whereExtra}
    ORDER BY v."documentId", "pdfPageIndex", ts.id
    LIMIT ${limit}`;
}

export const scopeFilter = (documentId: string) => (documentId ? Prisma.sql`AND v."documentId" = ${documentId}` : Prisma.empty);

// Every term must appear. Words broken across lines are rare enough that a LIKE on the raw column is a
// safe pre-filter; exact phrase ranking happens on cleaned text afterwards. Terms of three or more
// characters are answered by the trigram index "TextSpan_text_trgm_idx".
export function exactPageQuery(terms: string[], documentId: string, limit = MAX_PAGE_CANDIDATES) {
  const likes = terms.map((term) => Prisma.sql`AND ts.text ILIKE ${`%${escapeLike(term)}%`}`);
  return pageQuery(Prisma.sql`${scopeFilter(documentId)} ${Prisma.join(likes, " ")}`, limit);
}

/** True when at least one term has a run of three letters or digits, i.e. gives the trigram index something to look up. */
export const trigramSearchable = (terms: string[]) => terms.some((term) => /[\p{L}\p{N}]{3}/u.test(term));

/** Settings for the exact-search transaction; see exactPageRows. */
export const exactSearchSettings = (terms: string[]) => (trigramSearchable(terms) ? ["SET LOCAL enable_seqscan = off"] : []);

/**
 * Runs exactPageQuery. Page text is usually long enough to be stored out of line (TOAST), and the
 * planner does not count the cost of fetching and scanning it, so on a small or mid-sized library it
 * believes reading every page is cheaper than the trigram index (measured: 80 ms against 1 ms for
 * 5,000 pages). When the index can be used, sequential scans are therefore ruled out for this one
 * query (SET LOCAL lasts only for its transaction); the planner still chooses between the trigram
 * index and, for a search inside one book, that book's pages by their version index.
 */
export async function exactPageRows(terms: string[], documentId: string, limit = MAX_PAGE_CANDIDATES) {
  return prisma.$transaction(async (tx) => {
    for (const setting of exactSearchSettings(terms)) await tx.$executeRawUnsafe(setting);
    return tx.$queryRaw<PageRow[]>(exactPageQuery(terms, documentId, limit));
  });
}
