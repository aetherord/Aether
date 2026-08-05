import { getCloudflareContext } from "@opennextjs/cloudflare";
import { hasCloudflareContext } from "./env";

export interface UserRow {
  id: number;
  email: string;
  username: string;
  passwordHash: string;
  dob: string | null;
  agreedTos: boolean;
  agreedPrivacy: boolean;
  agreedRules: boolean;
  verified: boolean;
  totpSecret: string | null;
  totpEnabled: boolean;
  role: "user" | "admin";
  mutedUntil: number | null;
  createdAt: number;
}

export interface ConversationRow {
  peer: string;
  messageId: number;
  content: string;
  mediaRef: string | null;
  mediaMime: string | null;
  lastAt: number;
  lastSender: string;
}

/** A chat room: the public community room or a 1:1 direct message thread. */
export type ChatRoom =
  | { kind: "community" }
  | { kind: "dm"; me: string; peer: string };

export interface CodeRow {
  email: string;
  codeHash: string;
  salt: string;
  expiresAt: number;
  attempts: number;
  createdAt: number;
}

export interface SessionRow {
  tokenHash: string;
  userId: number;
  email: string;
  expiresAt: number;
  createdAt: number;
  lastUsedAt: number;
}

export interface PendingRow {
  tokenHash: string;
  email: string;
  expiresAt: number;
  createdAt: number;
}

export interface MessageRow {
  id: number;
  senderId: number;
  senderUsername: string;
  recipientUsername: string | null;
  content: string;
  mediaRef: string | null;
  mediaMime: string | null;
  createdAt: number;
}

export interface NewUserInput {
  email: string;
  username: string;
  passwordHash: string;
  dob: string | null;
  agreedTos: boolean;
  agreedPrivacy: boolean;
  agreedRules: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
  count: number;
}

/** Thrown when signup collides with an existing email or username. */
export class DuplicateUserError extends Error {
  constructor(public readonly field: "email" | "username") {
    super(`An account with this ${field} already exists`);
    this.name = "DuplicateUserError";
  }
}

/**
 * Single storage interface used by every auth route. Production uses D1
 * (persistent across requests and isolates); plain `next dev` uses an
 * in-memory implementation so the flow still works locally.
 *
 * This shared store is the fix for the old bug where `/api/auth/code` and
 * `/api/auth/verify` each kept their own private in-memory Map and could never
 * see each other's codes.
 */
export interface AuthStore {
  ensureSchema(): Promise<void>;
  getUserByEmail(email: string): Promise<UserRow | null>;
  getUserByUsername(username: string): Promise<UserRow | null>;
  getUserById(id: number): Promise<UserRow | null>;
  createUser(input: NewUserInput): Promise<UserRow>;
  updateAccount(
    id: number,
    input: Omit<NewUserInput, "email"> & { passwordHash: string }
  ): Promise<void>;
  markVerified(id: number): Promise<void>;
  setTotpSecret(id: number, encryptedSecret: string): Promise<void>;
  enableTotp(id: number): Promise<void>;
  disableTotp(id: number): Promise<void>;
  saveCode(row: CodeRow): Promise<void>;
  getCode(email: string): Promise<CodeRow | null>;
  clearCode(email: string): Promise<void>;
  incrementCodeAttempts(email: string): Promise<void>;
  createSession(row: SessionRow): Promise<void>;
  getSession(tokenHash: string): Promise<SessionRow | null>;
  touchSession(tokenHash: string): Promise<void>;
  rotateSession(oldHash: string, row: SessionRow): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  createPending(row: PendingRow): Promise<void>;
  getPending(tokenHash: string): Promise<PendingRow | null>;
  deletePending(tokenHash: string): Promise<void>;
  listMessages(room: ChatRoom, beforeId: number | null, limit: number): Promise<MessageRow[]>;
  listMessagesAfter(lastId: number, room: ChatRoom, limit: number): Promise<MessageRow[]>;
  listConversations(username: string): Promise<ConversationRow[]>;
  searchMessages(room: ChatRoom, query: string, limit: number): Promise<MessageRow[]>;
  addMessage(input: Omit<MessageRow, "id">): Promise<MessageRow>;
  addReport(messageId: number, reporterId: number, reason: string): Promise<void>;
  addBlock(blockerId: number, blockedId: number): Promise<void>;
  removeBlock(blockerId: number, blockedId: number): Promise<void>;
  getBlockedIds(userId: number): Promise<number[]>;
  isBlocked(blockerId: number, blockedId: number): Promise<boolean>;
  deleteMessage(id: number): Promise<void>;
  setRole(userId: number, role: "user" | "admin"): Promise<void>;
  setMutedUntil(userId: number, until: number | null): Promise<void>;
  consumeRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

/** Legacy table from the pre-rework Worker: `is_verified` instead of `verified`. */
const LEGACY_USER_COLUMNS = [
  "id",
  "username",
  "email",
  "password_hash",
  "verification_token",
  "is_verified",
  "totp_secret",
  "created_at",
] as const;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  dob TEXT,
  agreed_tos INTEGER NOT NULL DEFAULT 0,
  agreed_privacy INTEGER NOT NULL DEFAULT 0,
  agreed_rules INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'user',
  muted_until INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS pending_2fa (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL,
  sender_username TEXT NOT NULL,
  recipient_username TEXT,
  content TEXT NOT NULL,
  media_ref TEXT,
  media_mime TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_username, created_at);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL,
  blocked_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_id);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  reporter_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);
`;

const USER_COLUMNS =
  "id, email, username, password_hash, dob, agreed_tos, agreed_privacy, agreed_rules, verified, totp_secret, totp_enabled, role, muted_until, created_at";

const MESSAGE_COLUMNS =
  "id, sender_id, sender_username, recipient_username, content, media_ref, media_mime, created_at";

/** Columns added after the initial release; migrated in on existing databases. */
const USER_MIGRATIONS: Record<string, string> = {
  username: "TEXT",
  password_hash: "TEXT",
  dob: "TEXT",
  agreed_tos: "INTEGER NOT NULL DEFAULT 0",
  agreed_privacy: "INTEGER NOT NULL DEFAULT 0",
  agreed_rules: "INTEGER NOT NULL DEFAULT 0",
  verified: "INTEGER NOT NULL DEFAULT 0",
  totp_enabled: "INTEGER NOT NULL DEFAULT 0",
  role: "TEXT NOT NULL DEFAULT 'user'",
  muted_until: "INTEGER",
};

const MESSAGE_MIGRATIONS: Record<string, string> = {
  media_mime: "TEXT",
};

/* ── D1 implementation (production / `opennextjs-cloudflare dev`) ─────────── */

class D1AuthStore implements AuthStore {
  private readonly db: D1Database;
  private schemaReady: Promise<void> | null = null;

  constructor(db: D1Database) {
    this.db = db;
  }

  ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.init().catch((err) => {
        // Never leave a failed init cached — a transient error would otherwise
        // brick every request for the lifetime of the isolate.
        this.schemaReady = null;
        throw err;
      });
    }
    return this.schemaReady;
  }

  private async init(): Promise<void> {
    await this.db.exec(SCHEMA_SQL);

    // Migration: add columns that didn't exist when the users table was first created.
    const cols = await this.db.prepare("SELECT name FROM pragma_table_info('users')").all();
    const existing = new Set((cols.results as { name: string }[]).map((c) => c.name));
    for (const [column, definition] of Object.entries(USER_MIGRATIONS)) {
      if (!existing.has(column)) {
        await this.db.exec(`ALTER TABLE users ADD COLUMN ${column} ${definition}`);
      }
    }
    // Legacy pre-rework table used `is_verified` — carry its data over.
    if (existing.has("is_verified") && !existing.has("verified")) {
      await this.db.exec("UPDATE users SET verified = is_verified WHERE is_verified = 1");
    }

    const msgCols = await this.db.prepare("SELECT name FROM pragma_table_info('messages')").all();
    const msgExisting = new Set((msgCols.results as { name: string }[]).map((c) => c.name));
    for (const [column, definition] of Object.entries(MESSAGE_MIGRATIONS)) {
      if (!msgExisting.has(column)) {
        await this.db.exec(`ALTER TABLE messages ADD COLUMN ${column} ${definition}`);
      }
    }

    const now = Date.now();
    await this.db.prepare("DELETE FROM codes WHERE expires_at < ?1").bind(now).run();
    await this.db.prepare("DELETE FROM sessions WHERE expires_at < ?1").bind(now).run();
    await this.db.prepare("DELETE FROM pending_2fa WHERE expires_at < ?1").bind(now).run();
  }

  private static toUser(row: Record<string, unknown> | null): UserRow | null {
    if (!row) return null;
    return {
      id: Number(row.id),
      email: String(row.email),
      username: String(row.username ?? ""),
      passwordHash: String(row.password_hash ?? ""),
      dob: row.dob == null ? null : String(row.dob),
      agreedTos: Number(row.agreed_tos ?? 0) === 1,
      agreedPrivacy: Number(row.agreed_privacy ?? 0) === 1,
      agreedRules: Number(row.agreed_rules ?? 0) === 1,
      verified: Number(row.verified) === 1,
      totpSecret: row.totp_secret == null ? null : String(row.totp_secret),
      totpEnabled: Number(row.totp_enabled) === 1,
      role: row.role === "admin" ? "admin" : "user",
      mutedUntil: row.muted_until == null ? null : Number(row.muted_until),
      createdAt: Number(row.created_at),
    };
  }

  private static toMessage(row: Record<string, unknown>): MessageRow {
    return {
      id: Number(row.id),
      senderId: Number(row.sender_id),
      senderUsername: String(row.sender_username),
      recipientUsername: row.recipient_username == null ? null : String(row.recipient_username),
      content: String(row.content),
      mediaRef: row.media_ref == null ? null : String(row.media_ref),
      mediaMime: row.media_mime == null ? null : String(row.media_mime),
      createdAt: Number(row.created_at),
    };
  }

  async getUserByEmail(email: string): Promise<UserRow | null> {
    const row = await this.db
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?1`)
      .bind(email)
      .first();
    return D1AuthStore.toUser(row ?? null);
  }

  async getUserByUsername(username: string): Promise<UserRow | null> {
    const row = await this.db
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE username = ?1`)
      .bind(username)
      .first();
    return D1AuthStore.toUser(row ?? null);
  }

  async getUserById(id: number): Promise<UserRow | null> {
    const row = await this.db
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?1`)
      .bind(id)
      .first();
    return D1AuthStore.toUser(row ?? null);
  }

  async updateAccount(
    id: number,
    input: Omit<NewUserInput, "email"> & { passwordHash: string }
  ): Promise<void> {
    await this.db
      .prepare(
        "UPDATE users SET username = ?1, password_hash = ?2, dob = ?3, agreed_tos = ?4, agreed_privacy = ?5, agreed_rules = ?6 WHERE id = ?7"
      )
      .bind(
        input.username,
        input.passwordHash,
        input.dob,
        input.agreedTos ? 1 : 0,
        input.agreedPrivacy ? 1 : 0,
        input.agreedRules ? 1 : 0,
        id
      )
      .run();
  }

  async createUser(input: NewUserInput): Promise<UserRow> {
    if (await this.getUserByEmail(input.email)) throw new DuplicateUserError("email");
    if (await this.getUserByUsername(input.username)) throw new DuplicateUserError("username");

    await this.db
      .prepare(
        "INSERT INTO users (email, username, password_hash, dob, agreed_tos, agreed_privacy, agreed_rules, verified, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)"
      )
      .bind(
        input.email,
        input.username,
        input.passwordHash,
        input.dob,
        input.agreedTos ? 1 : 0,
        input.agreedPrivacy ? 1 : 0,
        input.agreedRules ? 1 : 0,
        Date.now()
      )
      .run();

    const row = await this.db
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?1`)
      .bind(input.email)
      .first();
    const user = D1AuthStore.toUser(row ?? null);
    if (!user) throw new Error("failed to create user");
    return user;
  }

  async markVerified(id: number): Promise<void> {
    await this.db.prepare("UPDATE users SET verified = 1 WHERE id = ?1").bind(id).run();
  }

  async setTotpSecret(id: number, encryptedSecret: string): Promise<void> {
    await this.db.prepare("UPDATE users SET totp_secret = ?1 WHERE id = ?2").bind(encryptedSecret, id).run();
  }

  async enableTotp(id: number): Promise<void> {
    await this.db.prepare("UPDATE users SET totp_enabled = 1 WHERE id = ?1").bind(id).run();
  }

  async disableTotp(id: number): Promise<void> {
    await this.db
      .prepare("UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?1")
      .bind(id)
      .run();
  }

  async saveCode(row: CodeRow): Promise<void> {
    await this.db
      .prepare(
        "INSERT OR REPLACE INTO codes (email, code_hash, salt, expires_at, attempts, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
      )
      .bind(row.email, row.codeHash, row.salt, row.expiresAt, row.attempts, row.createdAt)
      .run();
  }

  async getCode(email: string): Promise<CodeRow | null> {
    const row = await this.db
      .prepare("SELECT email, code_hash, salt, expires_at, attempts, created_at FROM codes WHERE email = ?1 LIMIT 1")
      .bind(email)
      .first();
    if (!row) return null;
    return {
      email: String(row.email),
      codeHash: String(row.code_hash),
      salt: String(row.salt),
      expiresAt: Number(row.expires_at),
      attempts: Number(row.attempts),
      createdAt: Number(row.created_at),
    };
  }

  async clearCode(email: string): Promise<void> {
    await this.db.prepare("DELETE FROM codes WHERE email = ?1").bind(email).run();
  }

  async incrementCodeAttempts(email: string): Promise<void> {
    await this.db.prepare("UPDATE codes SET attempts = attempts + 1 WHERE email = ?1").bind(email).run();
  }

  async createSession(row: SessionRow): Promise<void> {
    await this.db
      .prepare(
        "INSERT OR REPLACE INTO sessions (token_hash, user_id, email, expires_at, created_at, last_used_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
      )
      .bind(row.tokenHash, row.userId, row.email, row.expiresAt, row.createdAt, row.lastUsedAt)
      .run();
  }

  async getSession(tokenHash: string): Promise<SessionRow | null> {
    const row = await this.db
      .prepare("SELECT token_hash, user_id, email, expires_at, created_at, last_used_at FROM sessions WHERE token_hash = ?1")
      .bind(tokenHash)
      .first();
    if (!row) return null;
    return {
      tokenHash: String(row.token_hash),
      userId: Number(row.user_id),
      email: String(row.email),
      expiresAt: Number(row.expires_at),
      createdAt: Number(row.created_at),
      lastUsedAt: Number(row.last_used_at),
    };
  }

  async touchSession(tokenHash: string): Promise<void> {
    await this.db
      .prepare("UPDATE sessions SET last_used_at = ?1 WHERE token_hash = ?2")
      .bind(Date.now(), tokenHash)
      .run();
  }

  async rotateSession(oldHash: string, row: SessionRow): Promise<void> {
    await this.db.batch([
      this.db
        .prepare(
          "INSERT OR REPLACE INTO sessions (token_hash, user_id, email, expires_at, created_at, last_used_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
        )
        .bind(row.tokenHash, row.userId, row.email, row.expiresAt, row.createdAt, row.lastUsedAt),
      this.db.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(oldHash),
    ]);
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(tokenHash).run();
  }

  async createPending(row: PendingRow): Promise<void> {
    await this.db
      .prepare("INSERT OR REPLACE INTO pending_2fa (token_hash, email, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(row.tokenHash, row.email, row.expiresAt, row.createdAt)
      .run();
  }

  async getPending(tokenHash: string): Promise<PendingRow | null> {
    const row = await this.db
      .prepare("SELECT token_hash, email, expires_at, created_at FROM pending_2fa WHERE token_hash = ?1")
      .bind(tokenHash)
      .first();
    if (!row) return null;
    return {
      tokenHash: String(row.token_hash),
      email: String(row.email),
      expiresAt: Number(row.expires_at),
      createdAt: Number(row.created_at),
    };
  }

  async deletePending(tokenHash: string): Promise<void> {
    await this.db.prepare("DELETE FROM pending_2fa WHERE token_hash = ?1").bind(tokenHash).run();
  }

  /** Builds the room WHERE clause with positional placeholders starting at ?1. */
  private static roomWhere(room: ChatRoom): { clause: string; argCount: number } {
    if (room.kind === "community") {
      return { clause: "recipient_username IS NULL", argCount: 0 };
    }
    return {
      clause: "((sender_username = ?1 AND recipient_username = ?2) OR (sender_username = ?2 AND recipient_username = ?1))",
      argCount: 2,
    };
  }

  async listMessages(room: ChatRoom, beforeId: number | null, limit: number): Promise<MessageRow[]> {
    const { clause, argCount } = D1AuthStore.roomWhere(room);
    const n = argCount; // first free positional index
    const before = beforeId ? `AND id < ?${n + 1}` : "";
    const res = await this.db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE ${clause} ${before} ORDER BY id DESC LIMIT ?${n + (beforeId ? 2 : 1)}`
      )
      .bind(...(room.kind === "dm" ? [room.me, room.peer] : []), ...(beforeId ? [beforeId] : []), limit)
      .all();
    return (res.results as Record<string, unknown>[]).reverse().map(D1AuthStore.toMessage);
  }

  async listMessagesAfter(lastId: number, room: ChatRoom, limit: number): Promise<MessageRow[]> {
    const { clause, argCount } = D1AuthStore.roomWhere(room);
    const n = argCount;
    const res = await this.db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE ${clause} AND id > ?${n + 1} ORDER BY id ASC LIMIT ?${n + 2}`
      )
      .bind(...(room.kind === "dm" ? [room.me, room.peer] : []), lastId, limit)
      .all();
    return (res.results as Record<string, unknown>[]).map(D1AuthStore.toMessage);
  }

  async listConversations(username: string): Promise<ConversationRow[]> {
    // Latest message for every distinct peer who has exchanged DMs with this user.
    const res = await this.db
      .prepare(
        `SELECT m.* FROM messages m
         JOIN (
           SELECT MAX(id) AS mid FROM messages
           WHERE recipient_username IS NOT NULL
             AND (sender_username = ?1 OR recipient_username = ?1)
           GROUP BY
             CASE WHEN sender_username < recipient_username
               THEN sender_username || '|' || recipient_username
               ELSE recipient_username || '|' || sender_username END
         ) latest ON latest.mid = m.id
         ORDER BY m.id DESC LIMIT 50`
      )
      .bind(username)
      .all();
    const rows = res.results as Record<string, unknown>[];
    return rows.map((row) => {
      const sender = String(row.sender_username);
      const recipient = String(row.recipient_username ?? "");
      return {
        peer: sender === username ? recipient : sender,
        messageId: Number(row.id),
        content: String(row.content),
        mediaRef: row.media_ref == null ? null : String(row.media_ref),
        mediaMime: row.media_mime == null ? null : String(row.media_mime),
        lastAt: Number(row.created_at),
        lastSender: sender,
      };
    });
  }

  async searchMessages(room: ChatRoom, query: string, limit: number): Promise<MessageRow[]> {
    const escaped = query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    const { clause, argCount } = D1AuthStore.roomWhere(room);
    const n = argCount;
    const res = await this.db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM messages
         WHERE ${clause} AND content LIKE ?${n + 1} ESCAPE '\\'
         ORDER BY id DESC LIMIT ?${n + 2}`
      )
      .bind(...(room.kind === "dm" ? [room.me, room.peer] : []), `%${escaped}%`, limit)
      .all();
    return (res.results as Record<string, unknown>[]).reverse().map(D1AuthStore.toMessage);
  }

  async addReport(messageId: number, reporterId: number, reason: string): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO reports (message_id, reporter_id, reason, status, created_at) VALUES (?1, ?2, ?3, 'open', ?4)"
      )
      .bind(messageId, reporterId, reason, Date.now())
      .run();
  }

  async addBlock(blockerId: number, blockedId: number): Promise<void> {
    await this.db
      .prepare("INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?1, ?2, ?3)")
      .bind(blockerId, blockedId, Date.now())
      .run();
  }

  async removeBlock(blockerId: number, blockedId: number): Promise<void> {
    await this.db
      .prepare("DELETE FROM blocks WHERE blocker_id = ?1 AND blocked_id = ?2")
      .bind(blockerId, blockedId)
      .run();
  }

  async getBlockedIds(userId: number): Promise<number[]> {
    const res = await this.db
      .prepare("SELECT blocked_id FROM blocks WHERE blocker_id = ?1")
      .bind(userId)
      .all();
    return (res.results as Record<string, unknown>[]).map((r) => Number(r.blocked_id));
  }

  async isBlocked(blockerId: number, blockedId: number): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT 1 FROM blocks WHERE blocker_id = ?1 AND blocked_id = ?2 LIMIT 1")
      .bind(blockerId, blockedId)
      .first();
    return Boolean(row);
  }

  async deleteMessage(id: number): Promise<void> {
    await this.db.prepare("DELETE FROM messages WHERE id = ?1").bind(id).run();
  }

  async setRole(userId: number, role: "user" | "admin"): Promise<void> {
    await this.db.prepare("UPDATE users SET role = ?1 WHERE id = ?2").bind(role, userId).run();
  }

  async setMutedUntil(userId: number, until: number | null): Promise<void> {
    await this.db.prepare("UPDATE users SET muted_until = ?1 WHERE id = ?2").bind(until, userId).run();
  }

  async addMessage(input: Omit<MessageRow, "id">): Promise<MessageRow> {
    const res = await this.db
      .prepare(
        "INSERT INTO messages (sender_id, sender_username, recipient_username, content, media_ref, media_mime, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
      )
      .bind(
        input.senderId,
        input.senderUsername,
        input.recipientUsername,
        input.content,
        input.mediaRef,
        input.mediaMime,
        input.createdAt
      )
      .run();
    return { ...input, id: Number(res.meta.last_row_id) };
  }

  async consumeRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    // Positional binds only — object/named binds are rejected by this D1 runtime.
    const row = await this.db
      .prepare(
        `INSERT INTO rate_limits (key, count, window_start)
         VALUES (?1, 1, ?2)
         ON CONFLICT(key) DO UPDATE SET
           count = CASE WHEN rate_limits.window_start = ?2 THEN rate_limits.count + 1 ELSE 1 END,
           window_start = CASE WHEN rate_limits.window_start = ?2 THEN rate_limits.window_start ELSE ?2 END
         RETURNING count, window_start`
      )
      .bind(key, now)
      .first<{ count: number; window_start: number }>();

    const count = row?.count ?? 1;
    const windowStart = row?.window_start ?? now;
    return {
      allowed: count <= limit,
      retryAfterSec: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)),
      count,
    };
  }
}

/* ── In-memory implementation (plain `next dev`) ──────────────────────────── */

class MemoryAuthStore implements AuthStore {
  private usersByEmail = new Map<string, UserRow>();
  private usersByUsername = new Map<string, UserRow>();
  private usersById = new Map<number, UserRow>();
  private nextUserId = 1;
  private codes = new Map<string, CodeRow>();
  private sessions = new Map<string, SessionRow>();
  private pendings = new Map<string, PendingRow>();
  private messages: MessageRow[] = [];
  private nextMessageId = 1;
  private blocks = new Set<string>(); // "blockerId:blockedId"
  private reports: { id: number; messageId: number; reporterId: number; reason: string; createdAt: number }[] = [];
  private nextReportId = 1;
  private rateLimits = new Map<string, { count: number; windowStart: number }>();

  async ensureSchema(): Promise<void> {
    /* nothing to do */
  }

  async getUserByEmail(email: string): Promise<UserRow | null> {
    return this.usersByEmail.get(email) ?? null;
  }

  async getUserByUsername(username: string): Promise<UserRow | null> {
    return this.usersByUsername.get(username) ?? null;
  }

  async getUserById(id: number): Promise<UserRow | null> {
    return this.usersById.get(id) ?? null;
  }

  async updateAccount(
    id: number,
    input: Omit<NewUserInput, "email"> & { passwordHash: string }
  ): Promise<void> {
    const user = this.usersById.get(id);
    if (!user) return;
    user.username = input.username;
    user.passwordHash = input.passwordHash;
    user.dob = input.dob;
    user.agreedTos = input.agreedTos;
    user.agreedPrivacy = input.agreedPrivacy;
    user.agreedRules = input.agreedRules;
    this.usersByEmail.set(user.email, user);
    this.usersByUsername.set(user.username, user);
  }

  async createUser(input: NewUserInput): Promise<UserRow> {
    if (this.usersByEmail.has(input.email)) throw new DuplicateUserError("email");
    if (this.usersByUsername.has(input.username)) throw new DuplicateUserError("username");
    const user: UserRow = {
      id: this.nextUserId++,
      email: input.email,
      username: input.username,
      passwordHash: input.passwordHash,
      dob: input.dob,
      agreedTos: input.agreedTos,
      agreedPrivacy: input.agreedPrivacy,
      agreedRules: input.agreedRules,
      verified: false,
      totpSecret: null,
      totpEnabled: false,
      role: "user",
      mutedUntil: null,
      createdAt: Date.now(),
    };
    this.usersByEmail.set(user.email, user);
    this.usersByUsername.set(user.username, user);
    this.usersById.set(user.id, user);
    return user;
  }

  async markVerified(id: number): Promise<void> {
    const user = this.usersById.get(id);
    if (user) user.verified = true;
  }

  async setTotpSecret(id: number, encryptedSecret: string): Promise<void> {
    const user = this.usersById.get(id);
    if (user) user.totpSecret = encryptedSecret;
  }

  async enableTotp(id: number): Promise<void> {
    const user = this.usersById.get(id);
    if (user) user.totpEnabled = true;
  }

  async disableTotp(id: number): Promise<void> {
    const user = this.usersById.get(id);
    if (user) {
      user.totpEnabled = false;
      user.totpSecret = null;
    }
  }

  async saveCode(row: CodeRow): Promise<void> {
    this.codes.set(row.email, row);
  }

  async getCode(email: string): Promise<CodeRow | null> {
    return this.codes.get(email) ?? null;
  }

  async clearCode(email: string): Promise<void> {
    this.codes.delete(email);
  }

  async incrementCodeAttempts(email: string): Promise<void> {
    const row = this.codes.get(email);
    if (row) row.attempts += 1;
  }

  async createSession(row: SessionRow): Promise<void> {
    this.sessions.set(row.tokenHash, row);
  }

  async getSession(tokenHash: string): Promise<SessionRow | null> {
    return this.sessions.get(tokenHash) ?? null;
  }

  async touchSession(tokenHash: string): Promise<void> {
    const row = this.sessions.get(tokenHash);
    if (row) row.lastUsedAt = Date.now();
  }

  async rotateSession(oldHash: string, row: SessionRow): Promise<void> {
    this.sessions.delete(oldHash);
    this.sessions.set(row.tokenHash, row);
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async createPending(row: PendingRow): Promise<void> {
    this.pendings.set(row.tokenHash, row);
  }

  async getPending(tokenHash: string): Promise<PendingRow | null> {
    return this.pendings.get(tokenHash) ?? null;
  }

  async deletePending(tokenHash: string): Promise<void> {
    this.pendings.delete(tokenHash);
  }

  private static inRoom(m: MessageRow, room: ChatRoom): boolean {
    if (room.kind === "community") return m.recipientUsername == null;
    return (
      (m.senderUsername === room.me && m.recipientUsername === room.peer) ||
      (m.senderUsername === room.peer && m.recipientUsername === room.me)
    );
  }

  async listMessages(room: ChatRoom, beforeId: number | null, limit: number): Promise<MessageRow[]> {
    const filtered = this.messages.filter(
      (m) => MemoryAuthStore.inRoom(m, room) && (beforeId == null || m.id < beforeId)
    );
    return filtered.slice(-limit);
  }

  async listMessagesAfter(lastId: number, room: ChatRoom, limit: number): Promise<MessageRow[]> {
    return this.messages
      .filter((m) => MemoryAuthStore.inRoom(m, room) && m.id > lastId)
      .slice(0, limit);
  }

  async listConversations(username: string): Promise<ConversationRow[]> {
    const byPeer = new Map<string, MessageRow>();
    for (const m of this.messages) {
      if (!m.recipientUsername) continue;
      if (m.senderUsername !== username && m.recipientUsername !== username) continue;
      const peer = m.senderUsername === username ? m.recipientUsername : m.senderUsername;
      const existing = byPeer.get(peer);
      if (!existing || m.id > existing.id) byPeer.set(peer, m);
    }
    return [...byPeer.entries()]
      .sort((a, b) => b[1].id - a[1].id)
      .slice(0, 50)
      .map(([peer, m]) => ({
        peer,
        messageId: m.id,
        content: m.content,
        mediaRef: m.mediaRef,
        mediaMime: m.mediaMime,
        lastAt: m.createdAt,
        lastSender: m.senderUsername,
      }));
  }

  async searchMessages(room: ChatRoom, query: string, limit: number): Promise<MessageRow[]> {
    const q = query.toLowerCase();
    return this.messages
      .filter((m) => MemoryAuthStore.inRoom(m, room) && m.content.toLowerCase().includes(q))
      .slice(-limit);
  }

  async addReport(messageId: number, reporterId: number, reason: string): Promise<void> {
    this.reports.push({
      id: this.nextReportId++,
      messageId,
      reporterId,
      reason,
      createdAt: Date.now(),
    });
  }

  async addBlock(blockerId: number, blockedId: number): Promise<void> {
    this.blocks.add(`${blockerId}:${blockedId}`);
  }

  async removeBlock(blockerId: number, blockedId: number): Promise<void> {
    this.blocks.delete(`${blockerId}:${blockedId}`);
  }

  async getBlockedIds(userId: number): Promise<number[]> {
    return [...this.blocks]
      .filter((k) => k.startsWith(`${userId}:`))
      .map((k) => Number(k.split(":")[1]));
  }

  async isBlocked(blockerId: number, blockedId: number): Promise<boolean> {
    return this.blocks.has(`${blockerId}:${blockedId}`);
  }

  async deleteMessage(id: number): Promise<void> {
    this.messages = this.messages.filter((m) => m.id !== id);
  }

  async setRole(userId: number, role: "user" | "admin"): Promise<void> {
    const user = this.usersById.get(userId);
    if (user) user.role = role;
  }

  async setMutedUntil(userId: number, until: number | null): Promise<void> {
    const user = this.usersById.get(userId);
    if (user) user.mutedUntil = until;
  }

  async addMessage(input: Omit<MessageRow, "id">): Promise<MessageRow> {
    const message: MessageRow = { ...input, id: this.nextMessageId++ };
    this.messages.push(message);
    return message;
  }

  async consumeRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    let entry = this.rateLimits.get(key);
    if (!entry || now >= entry.windowStart + windowMs) {
      entry = { count: 0, windowStart: now };
    }
    entry.count += 1;
    this.rateLimits.set(key, entry);
    return {
      allowed: entry.count <= limit,
      retryAfterSec: Math.max(1, Math.ceil((entry.windowStart + windowMs - now) / 1000)),
      count: entry.count,
    };
  }
}

/* ── selector ─────────────────────────────────────────────────────────────── */

let cachedStore: AuthStore | null = null;

export async function getStore(): Promise<AuthStore> {
  if (cachedStore) return cachedStore;

  let db: D1Database | null = null;
  if (hasCloudflareContext()) {
    try {
      const { env } = await getCloudflareContext({ async: true });
      db = (env as { DB?: D1Database }).DB ?? null;
    } catch {
      db = null;
    }
  }

  cachedStore = db ? new D1AuthStore(db) : new MemoryAuthStore();
  await cachedStore.ensureSchema();
  return cachedStore;
}
