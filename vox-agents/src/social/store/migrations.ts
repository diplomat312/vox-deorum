import Database from 'better-sqlite3';

/** Apply idempotent, versioned social schema migrations to a session database. */
export function migrateSocialSchema(sqlite: InstanceType<typeof Database>): void {
  const migrate = sqlite.transaction(() => {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS socialSessions (id TEXT PRIMARY KEY, humanActorId TEXT NOT NULL, title TEXT NOT NULL DEFAULT 'Untitled sandbox', archived INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL); CREATE TABLE IF NOT EXISTS socialActors (id TEXT PRIMARY KEY, sessionId TEXT NOT NULL, ordinal INTEGER NOT NULL, control TEXT NOT NULL, displayName TEXT NOT NULL, modelRef TEXT, profile TEXT, createdAt TEXT NOT NULL, status TEXT NOT NULL); CREATE TABLE IF NOT EXISTS socialChannels (id TEXT PRIMARY KEY, sessionId TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, createdByActorId TEXT NOT NULL, canonicalKey TEXT, createdAt TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, UNIQUE(sessionId, canonicalKey)); CREATE TABLE IF NOT EXISTS socialMemberships (id TEXT PRIMARY KEY, channelId TEXT NOT NULL, actorId TEXT NOT NULL, status TEXT NOT NULL, invitedByActorId TEXT, visibleAfterMessageId INTEGER NOT NULL, leftAfterMessageId INTEGER, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL); CREATE TABLE IF NOT EXISTS socialMessages (id INTEGER PRIMARY KEY AUTOINCREMENT, channelId TEXT NOT NULL, speakerActorId TEXT NOT NULL, content TEXT NOT NULL, replyToMessageId INTEGER, createdAt TEXT NOT NULL, intentionId TEXT, idempotencyKey TEXT UNIQUE); CREATE TABLE IF NOT EXISTS socialMemories (actorId TEXT PRIMARY KEY, revision INTEGER NOT NULL, content TEXT NOT NULL, updatedAt TEXT NOT NULL, sourceRunId TEXT); CREATE TABLE IF NOT EXISTS socialIntentions (id TEXT PRIMARY KEY, actorId TEXT NOT NULL, kind TEXT NOT NULL, channelId TEXT, sourceMessageId INTEGER, priority INTEGER NOT NULL, state TEXT NOT NULL, notBefore TEXT NOT NULL, payload TEXT, dedupeKey TEXT UNIQUE, attemptCount INTEGER NOT NULL DEFAULT 0, claimedAt TEXT, result TEXT, lastError TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL); CREATE INDEX IF NOT EXISTS socialMessagesChannelIdIndex ON socialMessages(channelId, id); CREATE INDEX IF NOT EXISTS socialMembershipsActorIndex ON socialMemberships(actorId, channelId);`);
    const columns = (table: string): Set<string> => new Set((sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
    const addColumn = (table: string, column: string, definition: string): void => { if (!columns(table).has(column)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); };
    addColumn('socialSessions', 'title', "TEXT NOT NULL DEFAULT 'Untitled sandbox'");
    addColumn('socialSessions', 'archived', 'INTEGER NOT NULL DEFAULT 0');
    addColumn('socialSessions', 'updatedAt', "TEXT NOT NULL DEFAULT ''");
    addColumn('socialIntentions', 'claimedAt', 'TEXT');
    addColumn('socialIntentions', 'result', 'TEXT');
    sqlite.exec("UPDATE socialSessions SET updatedAt = createdAt WHERE updatedAt = ''");
    sqlite.exec('CREATE INDEX IF NOT EXISTS socialIntentionsClaimIndex ON socialIntentions(state, notBefore, priority, createdAt);');
    sqlite.exec("UPDATE socialActors SET modelRef = 'openrouter/' || modelRef WHERE modelRef IS NOT NULL AND modelRef NOT LIKE 'openrouter/%' AND (modelRef LIKE 'inclusionai/%' OR modelRef LIKE 'dots-studio/%' OR modelRef LIKE 'nvidia/%' OR modelRef LIKE 'liquid/%' OR modelRef LIKE 'poolside/%' OR modelRef LIKE 'thinkingmachines/%' OR modelRef LIKE 'z-ai/%' OR modelRef LIKE 'minimax/%')");
    sqlite.pragma('user_version = 3');
  });
  migrate();
}
