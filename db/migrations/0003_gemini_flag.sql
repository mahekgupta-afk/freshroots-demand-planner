-- Marks SKUs where the AI note was attempted but failed (after one retry), so the UI can say so.
alter table recommendations add column gemini_failed boolean not null default false
