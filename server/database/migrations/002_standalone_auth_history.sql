BEGIN;

CREATE TABLE IF NOT EXISTS rule_documents (
  id uuid PRIMARY KEY,
  title varchar(240) NOT NULL,
  source_url text NOT NULL,
  source_type varchar(32) NOT NULL DEFAULT 'script_framework',
  version varchar(64),
  effective_at timestamptz,
  content text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT rule_documents_status_check
    CHECK (status IN ('active', 'superseded', 'draft'))
);

CREATE INDEX IF NOT EXISTS rule_documents_source_type_idx
  ON rule_documents (source_type, created_at DESC);

COMMIT;
