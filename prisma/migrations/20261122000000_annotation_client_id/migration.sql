-- A highlight's browser-side id, so a retried save returns the existing highlight instead of creating a duplicate.
ALTER TABLE "Annotation" ADD COLUMN "clientId" VARCHAR(191);
CREATE UNIQUE INDEX "Annotation_clientId_key" ON "Annotation"("clientId");
