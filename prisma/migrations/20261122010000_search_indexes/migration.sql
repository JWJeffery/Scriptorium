-- Faster search (hardening plan, workstream 7).
--
-- 1. Exact search runs `"TextSpan"."text" ILIKE '%term%'` for every typed word. Without an index that
--    reads every page of every book. A trigram (pg_trgm) GIN index answers ILIKE with a leading
--    wildcard for any term of three or more characters.
--
-- 2. Search by meaning stored each passage's vector only as raw bytes and compared them one by one in
--    Node. The vectors now also live in a pgvector column with an HNSW index, so the database finds the
--    nearest passages itself. The bytes column stays (it is still written): nothing is lost, an older
--    app version keeps working against this schema, and a row whose vector column is empty can always
--    be refilled from it (the app does that on the fly, see lib/meaning-index.ts).
--
-- Plain CREATE INDEX (not CONCURRENTLY, which cannot run inside a multi-statement script): in
-- production the migrate service finishes before the web server and worker start, so nothing is writing.

-- 1. Exact search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "TextSpan_text_trgm_idx" ON "TextSpan" USING gin ("text" gin_trgm_ops);

-- 2. Search by meaning
CREATE EXTENSION IF NOT EXISTS vector;

-- The stored bytes are a JavaScript Float32Array copied byte for byte (embedding-math.ts
-- vectorToBytes), i.e. IEEE-754 single precision in the server's native byte order. Node only runs on
-- little-endian machines here (x86-64, arm64), so each 4-byte group is read little-endian and decoded
-- exactly: sign, 8-bit exponent, 23-bit mantissa, including subnormals. Infinity/NaN (never produced by
-- the embedder) make the whole result NULL rather than fail the migration.
-- Vectors shorter than 384 numbers (the 64-number test embedder) are padded with zeros, which changes
-- neither dot products nor lengths. Anything malformed (empty, not a multiple of 4 bytes, longer than
-- 384 numbers) becomes NULL and is skipped by search.
CREATE OR REPLACE FUNCTION scriptorium_bytes_to_vector(bytes bytea) RETURNS vector
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  WITH parts AS (
    SELECT i,
           get_byte(bytes, 4 * i + 3) >> 7 AS sign,
           ((get_byte(bytes, 4 * i + 3) & 127) << 1) | (get_byte(bytes, 4 * i + 2) >> 7) AS exponent,
           ((get_byte(bytes, 4 * i + 2) & 127) << 16) | (get_byte(bytes, 4 * i + 1) << 8) | get_byte(bytes, 4 * i) AS mantissa
    FROM generate_series(0, LEAST(length(bytes), 1536) / 4 - 1) AS i
  )
  SELECT CASE
    WHEN length(bytes) = 0 OR length(bytes) % 4 <> 0 OR length(bytes) > 1536 THEN NULL
    WHEN bool_or(exponent = 255) THEN NULL
    ELSE (
      array_agg(
        -- (exponent 255 is decoded as 0 here only so that the cast cannot overflow: aggregates are
        -- computed before the CASE above discards the whole vector.)
        ((1 - 2 * sign) * CASE WHEN exponent = 0 THEN mantissa * power(2::float8, -149)
                               WHEN exponent = 255 THEN 0
                               ELSE (8388608 + mantissa) * power(2::float8, exponent - 150) END)::real
        ORDER BY i)
      || array_fill(0::real, ARRAY[384 - length(bytes) / 4])
    )::vector(384)
  END
  FROM parts
$$;

ALTER TABLE "PassageEmbedding" ADD COLUMN "embedding" vector(384);
UPDATE "PassageEmbedding" SET "embedding" = scriptorium_bytes_to_vector("vector");

-- Every vector the app stores is normalised to length 1 (or is all zeros for an empty passage), so
-- the inner product is the cosine similarity the app always used, and it stays 0 (not undefined) for
-- an all-zero vector. Search orders by `embedding <#> query` (the negative inner product).
CREATE INDEX "PassageEmbedding_embedding_hnsw_idx" ON "PassageEmbedding" USING hnsw ("embedding" vector_ip_ops) WITH (m = 16, ef_construction = 128);

-- Which books have an index for the active model, read without touching the vectors.
CREATE INDEX "PassageEmbedding_model_documentId_idx" ON "PassageEmbedding"("model", "documentId");
-- Rows still waiting for their vector column (written by an older app version): found instantly.
CREATE INDEX "PassageEmbedding_embedding_missing_idx" ON "PassageEmbedding"("model") WHERE "embedding" IS NULL;
