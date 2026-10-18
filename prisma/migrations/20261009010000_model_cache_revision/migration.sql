CREATE TABLE "ModelCacheRevision" (
  "id" INTEGER PRIMARY KEY CHECK ("id" = 1),
  "revision" BIGINT NOT NULL DEFAULT 0
);
INSERT INTO "ModelCacheRevision" ("id") VALUES (1);
CREATE FUNCTION aihub_invalidate_model_cache() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "ModelCacheRevision" SET revision = revision + 1 WHERE id = 1;
  RETURN NULL;
END;
$$;
CREATE TRIGGER model_cache_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "Model"
  FOR EACH STATEMENT EXECUTE FUNCTION aihub_invalidate_model_cache();
