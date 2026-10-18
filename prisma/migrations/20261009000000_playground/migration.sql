CREATE TYPE "ApiRequestSource" AS ENUM ('API', 'PLAYGROUND');
ALTER TABLE "ApiRequest" ADD COLUMN "source" "ApiRequestSource" NOT NULL DEFAULT 'API';

CREATE TABLE "PlaygroundRun" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "submissionId" UUID NOT NULL,
  "rejectedAt" TIMESTAMPTZ(3),
  "errorCode" VARCHAR(64),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlaygroundRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlaygroundRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "PlaygroundRun_userId_submissionId_key" ON "PlaygroundRun"("userId", "submissionId");
CREATE INDEX "PlaygroundRun_userId_createdAt_idx" ON "PlaygroundRun"("userId", "createdAt");

CREATE FUNCTION aihub_playground_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."userId" IS DISTINCT FROM OLD."userId"
     OR NEW."submissionId" IS DISTINCT FROM OLD."submissionId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Playground submission identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PlaygroundRun_identity_guard" BEFORE UPDATE ON "PlaygroundRun"
  FOR EACH ROW EXECUTE FUNCTION aihub_playground_identity_guard();

CREATE FUNCTION aihub_request_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."source" IS DISTINCT FROM OLD."source" THEN RAISE EXCEPTION 'Request source is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ApiRequest_source_guard" BEFORE UPDATE ON "ApiRequest"
  FOR EACH ROW EXECUTE FUNCTION aihub_request_source_guard();
