-- =============================================================
-- PulsePro Project Recovery Script
-- =============================================================
-- Usage:
--   1. Create a Neon branch from BEFORE the deletion at console.neon.tech
--   2. Connect to that branch with psql — this script uses \set and :'project_id',
--      which are psql meta-commands and will error in the Neon SQL Editor
--   3. Run Section 1 to find your project
--   4. Replace YOUR_PROJECT_ID below with the actual ID
--   5. Run Sections 2-7 to extract all data
--   6. Use the INSERT statements from Section 8 to restore into production
-- =============================================================

-- =============================================================
-- SECTION 1: Find the deleted project
-- =============================================================
-- Search by name (adjust the search term as needed)
SELECT id, name, description, status, priority, "clientId", "createdAt"
FROM "Project"
WHERE name ILIKE '%fonz%ai%'
   OR name ILIKE '%fonz%'
ORDER BY "createdAt" DESC;

-- Also check all projects for your user ID to jog your memory
-- Replace YOUR_USER_ID with your Clerk user ID
-- SELECT id, name, status, "createdAt" FROM "Project"
-- WHERE "userId" = 'YOUR_USER_ID' ORDER BY "createdAt" DESC;


-- =============================================================
-- SET THIS after finding your project in Section 1
-- =============================================================
-- Replace with the actual project ID from the query above
-- Example: SET session.project_id = 'cml5abc123';

\set project_id 'YOUR_PROJECT_ID'


-- =============================================================
-- SECTION 2: Get the project record
-- =============================================================
SELECT * FROM "Project" WHERE id = :'project_id';


-- =============================================================
-- SECTION 3: Get all tasks (including bookmarks)
-- =============================================================
SELECT id, title, description, notes, status, "sortOrder", priority,
       "startDate", "dueDate", "projectId", url, "bookmarkType",
       "thumbnailUrl", tags, "createdAt", "updatedAt"
FROM "Task"
WHERE "projectId" = :'project_id'
ORDER BY "createdAt";

-- Bookmarks specifically (tasks with URLs)
SELECT id, title, url, "bookmarkType", "thumbnailUrl", tags, "createdAt"
FROM "Task"
WHERE "projectId" = :'project_id' AND url IS NOT NULL
ORDER BY "createdAt";


-- =============================================================
-- SECTION 4: Get task images
-- =============================================================
SELECT ti.* FROM "TaskImage" ti
JOIN "Task" t ON ti."taskId" = t.id
WHERE t."projectId" = :'project_id';


-- =============================================================
-- SECTION 5: Get task files
-- =============================================================
SELECT tf.* FROM "TaskFile" tf
JOIN "Task" t ON tf."taskId" = t.id
WHERE t."projectId" = :'project_id';


-- =============================================================
-- SECTION 6: Get task comments
-- =============================================================
SELECT tc.* FROM "TaskComment" tc
JOIN "Task" t ON tc."taskId" = t.id
WHERE t."projectId" = :'project_id';


-- =============================================================
-- SECTION 7: Get time entries and project images
-- =============================================================
SELECT * FROM "TimeEntry" WHERE "projectId" = :'project_id';
SELECT * FROM "ProjectImage" WHERE "projectId" = :'project_id';
SELECT * FROM "ProjectAccess" WHERE "projectId" = :'project_id';


-- =============================================================
-- SECTION 8: Generate INSERT statements for production restore
-- =============================================================
-- Run these queries on the Neon branch to generate INSERT statements.
-- Then run the generated INSERT statements on production.

-- 8a. Project INSERT
SELECT format(
  'INSERT INTO "Project" (id, "userId", name, description, notes, status, priority, "dueDate", budget, "hourlyRate", "clientId", "createdAt", "updatedAt") VALUES (%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L);',
  id, "userId", name, description, notes, status, priority, "dueDate", budget, "hourlyRate", "clientId", "createdAt", "updatedAt"
) AS insert_sql
FROM "Project" WHERE id = :'project_id';

-- 8b. Tasks INSERT (including bookmarks)
SELECT format(
  'INSERT INTO "Task" (id, "userId", title, description, notes, status, "sortOrder", priority, "startDate", "dueDate", "projectId", url, "bookmarkType", "thumbnailUrl", tags, "createdAt", "updatedAt") VALUES (%L, %L, %L, %L, %L, %L, %s, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L);',
  id, "userId", title, description, notes, status, "sortOrder", priority, "startDate", "dueDate", "projectId", url, "bookmarkType", "thumbnailUrl", tags, "createdAt", "updatedAt"
) AS insert_sql
FROM "Task" WHERE "projectId" = :'project_id'
ORDER BY "createdAt";

-- 8c. Task Images INSERT
SELECT format(
  'INSERT INTO "TaskImage" (id, path, name, "taskId", "createdAt") VALUES (%L, %L, %L, %L, %L);',
  ti.id, ti.path, ti.name, ti."taskId", ti."createdAt"
) AS insert_sql
FROM "TaskImage" ti
JOIN "Task" t ON ti."taskId" = t.id
WHERE t."projectId" = :'project_id';

-- 8d. Task Files INSERT
SELECT format(
  'INSERT INTO "TaskFile" (id, path, name, type, size, "taskId", "createdAt") VALUES (%L, %L, %L, %L, %s, %L, %L);',
  tf.id, tf.path, tf.name, tf.type, tf.size, tf."taskId", tf."createdAt"
) AS insert_sql
FROM "TaskFile" tf
JOIN "Task" t ON tf."taskId" = t.id
WHERE t."projectId" = :'project_id';

-- 8e. Task Comments INSERT
SELECT format(
  'INSERT INTO "TaskComment" (id, content, "taskId", "userId", "createdAt", "updatedAt") VALUES (%L, %L, %L, %L, %L, %L);',
  tc.id, tc.content, tc."taskId", tc."userId", tc."createdAt", tc."updatedAt"
) AS insert_sql
FROM "TaskComment" tc
JOIN "Task" t ON tc."taskId" = t.id
WHERE t."projectId" = :'project_id';

-- 8f. Time Entries INSERT
SELECT format(
  'INSERT INTO "TimeEntry" (id, hours, description, date, "projectId", "createdAt") VALUES (%L, %s, %L, %L, %L, %L);',
  id, hours, description, date, "projectId", "createdAt"
) AS insert_sql
FROM "TimeEntry" WHERE "projectId" = :'project_id';

-- 8g. Project Images INSERT
SELECT format(
  'INSERT INTO "ProjectImage" (id, path, name, "projectId", "createdAt") VALUES (%L, %L, %L, %L, %L);',
  id, path, name, "projectId", "createdAt"
) AS insert_sql
FROM "ProjectImage" WHERE "projectId" = :'project_id';
