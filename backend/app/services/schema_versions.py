"""MongoDB document-format baseline; unrelated to board edit revisions."""

SCHEMA_VERSION = 1
VERSIONED_COLLECTIONS = (
    'users', 'auth_sessions', 'login_attempts', 'card_categories',
    'card_submissions', 'card_audit_logs', 'communication_sessions',
    'tts_settings', 'tts_events', 'accessibility_settings', 'board_layouts',
    'board_audit_logs', 'caregiver_links', 'caregiver_notes', 'privacy_settings',
    'privacy_audit_logs', 'offline_events', 'learning_settings',
    'learning_attempts', 'learning_audit_logs',
    'account_permission_audit_logs',
    'recommendation_settings', 'recommendation_batches',
)
