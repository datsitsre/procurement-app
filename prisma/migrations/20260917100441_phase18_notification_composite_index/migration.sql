-- Phase 18, section 14: replaces Notification(userId, createdAt) with Notification(userId,
-- createdAt, id), which lets Postgres serve the cursor-paginated GET /api/notifications query's
-- full `ORDER BY createdAt DESC, id DESC` directly from the index instead of needing an
-- Incremental Sort on top of an index scan. Real EXPLAIN ANALYZE evidence against a 1000-row
-- fixture: 0.242ms (with Incremental Sort) -> 0.039ms (pure Index Scan) - see
-- PHASE18_FINAL_REPORT.md's Notification Index section.
DROP INDEX "Notification_userId_createdAt_idx";

CREATE INDEX "Notification_userId_createdAt_id_idx" ON "Notification"("userId", "createdAt", "id");
