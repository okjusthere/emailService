ALTER TABLE users ADD COLUMN portal_agent_id INTEGER;
CREATE UNIQUE INDEX users_portal_agent_id_key ON users(portal_agent_id);
ALTER TABLE campaigns ADD COLUMN source_application TEXT, ADD COLUMN portal_owner_agent_id INTEGER, ADD COLUMN portal_request_key TEXT, ADD COLUMN marketing_identity JSONB;
CREATE UNIQUE INDEX campaigns_portal_owner_agent_id_portal_request_key_key ON campaigns(portal_owner_agent_id,portal_request_key);
CREATE INDEX campaigns_source_application_portal_owner_agent_id_updated_at_idx ON campaigns(source_application,portal_owner_agent_id,updated_at);
ALTER TABLE campaigns ADD CONSTRAINT campaigns_portal_identity_check CHECK (source_application IS DISTINCT FROM 'homixliving' OR (portal_owner_agent_id IS NOT NULL AND portal_request_key IS NOT NULL AND marketing_identity IS NOT NULL));
