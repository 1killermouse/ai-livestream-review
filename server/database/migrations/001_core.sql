BEGIN;

CREATE TABLE IF NOT EXISTS user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id user_profile NOT NULL UNIQUE,
  role varchar(20) NOT NULL DEFAULT 'anchor',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT user_roles_role_check CHECK (role IN ('admin', 'anchor'))
);

CREATE TABLE IF NOT EXISTS live_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id user_profile NOT NULL,
  title varchar(160) NOT NULL,
  live_started_at timestamptz,
  duration_seconds integer NOT NULL DEFAULT 0,
  status varchar(24) NOT NULL DEFAULT 'draft',
  traffic_source varchar(24) NOT NULL DEFAULT 'live_url',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT live_sessions_status_check
    CHECK (status IN ('draft', 'processing', 'completed', 'failed')),
  CONSTRAINT live_sessions_input_source_check
    CHECK (traffic_source IN ('live_url', 'recording_upload'))
);

CREATE INDEX IF NOT EXISTS live_sessions_owner_idx
  ON live_sessions (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  start_seconds integer NOT NULL,
  end_seconds integer NOT NULL,
  phase varchar(24) NOT NULL DEFAULT 'unknown',
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT transcript_segments_phase_check
    CHECK (phase IN ('interaction', 'product_pitch', 'price_offer', 'guarantee', 'closing', 'unknown')),
  CONSTRAINT transcript_segments_time_check
    CHECK (start_seconds >= 0 AND end_seconds >= start_seconds)
);

CREATE INDEX IF NOT EXISTS transcript_segments_session_time_idx
  ON transcript_segments (session_id, start_seconds);

CREATE TABLE IF NOT EXISTS rule_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(240) NOT NULL,
  source_url text,
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

CREATE TABLE IF NOT EXISTS review_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  segment_id uuid REFERENCES transcript_segments(id) ON DELETE SET NULL,
  finding_type varchar(24) NOT NULL,
  risk_level varchar(16) NOT NULL DEFAULT 'medium',
  occurred_at_seconds integer NOT NULL,
  original_text text,
  rule_document_id uuid REFERENCES rule_documents(id) ON DELETE SET NULL,
  rule_excerpt text,
  analysis text NOT NULL,
  suggestion text,
  confidence numeric(5, 4) NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT review_findings_type_check
    CHECK (finding_type IN ('banned_word', 'semantic_risk', 'framework_gap')),
  CONSTRAINT review_findings_risk_check
    CHECK (risk_level IN ('critical', 'high', 'medium', 'low')),
  CONSTRAINT review_findings_status_check
    CHECK (status IN ('pending', 'confirmed', 'dismissed')),
  CONSTRAINT review_findings_confidence_check
    CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX IF NOT EXISTS review_findings_session_time_idx
  ON review_findings (session_id, occurred_at_seconds);

COMMIT;
