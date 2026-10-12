/**
 * Forward-only SQL migrations; index + 1 is the schema version.
 * Chat history is not here: it lives in the append-only JSONL event logs.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE repos (
    id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    default_base TEXT NOT NULL DEFAULT 'main', config_json TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE profiles (
    id TEXT PRIMARY KEY, agent TEXT NOT NULL,
    name TEXT NOT NULL, config_dir TEXT NOT NULL,
    color TEXT, created_at INTEGER NOT NULL,
    UNIQUE(agent, name)
  );

  CREATE TABLE worktrees (
    id TEXT PRIMARY KEY, repo_id TEXT NOT NULL REFERENCES repos(id),
    title TEXT NOT NULL, branch TEXT NOT NULL, base_ref TEXT NOT NULL,
    path TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL,
    port INTEGER UNIQUE,
    setup_error TEXT,
    created_at INTEGER NOT NULL, archived_at INTEGER
  );

  CREATE TABLE chats (
    id TEXT PRIMARY KEY, worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    agent TEXT NOT NULL, profile_id TEXT NOT NULL REFERENCES profiles(id),
    acp_session_id TEXT,
    title TEXT, status TEXT NOT NULL,
    resumed INTEGER NOT NULL DEFAULT 0,
    last_cursor INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );

  CREATE TABLE permission_rules (
    chat_id TEXT NOT NULL REFERENCES chats(id), tool_kind TEXT NOT NULL, pattern TEXT NOT NULL,
    PRIMARY KEY (chat_id, tool_kind, pattern)
  );

  CREATE TABLE usage_samples (
    profile_id TEXT NOT NULL, at INTEGER NOT NULL,
    input_tokens INTEGER, output_tokens INTEGER, limit_hit INTEGER NOT NULL DEFAULT 0, reset_at INTEGER
  );

  CREATE TABLE devices (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, public_key BLOB NOT NULL,
    paired_at INTEGER NOT NULL, last_seen_at INTEGER, revoked_at INTEGER
  );

  CREATE TABLE command_results (
    cmd_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, result_json TEXT NOT NULL, at INTEGER NOT NULL
  );

  CREATE TABLE topic_cursors (topic TEXT PRIMARY KEY, cursor INTEGER NOT NULL);
  `,
  // 2: Phase 2 pairing. `public_key` holds the phone's Ed25519 key (base64url); a device is
  // usable once the user confirmed the short code.
  `
  ALTER TABLE devices ADD COLUMN kind TEXT NOT NULL DEFAULT 'phone';
  ALTER TABLE devices ADD COLUMN confirmed_at INTEGER;
  `,
];
