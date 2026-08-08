import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSecret, hasCloudflareContext } from "./env";
import { sha256Hex } from "./crypto";

export type MessagePrivacy = "everyone" | "friends" | "nobody";

/** Generates a single backup code like `XXXX-XXXX-XXXX` (unambiguous chars). */
function generateBackupCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/L/O/0/1
  const rand = new Uint8Array(12);
  crypto.getRandomValues(rand);
  let out = "";
  for (let i = 0; i < 12; i++) out += alphabet[rand[i] % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

function backupCodeHash(code: string): string {
  // SHA-256 of the normalized (uppercase, stripped) code — plaintext is never stored.
  return sha256Hex(code.toUpperCase().replace(/[^A-Z0-9]/g, ""));
}

export function normalizeBackupCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

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
  /** Millis until the ban lifts (null = not banned). Enforced on login + messaging. */
  bannedUntil: number | null;
  /** Reason shown to the user when they attempt to log in while banned. */
  banReason: string | null;
  messagePrivacy: MessagePrivacy;
  /** Base64 X25519 public key for end-to-end encrypted DMs (set by the client). */
  pubkey: string | null;
  /** IANA timezone name, reported by the client so DMs can show the peer's time. */
  timezone: string | null;
  /** media_ref of the user's profile picture in the media queue, if any. */
  avatar: string | null;
  /** Presence status: online | idle | away | busy | dnd | offline. */
  status: string;
  /** Last heartbeat from the client (real "is the app open" presence). */
  lastSeenAt: number | null;
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
  remember: boolean;
  expiresAt: number;
  createdAt: number;
  lastUsedAt: number;
}

export interface PendingRow {
  tokenHash: string;
  email: string;
  remember: boolean;
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
  replyToId: number | null;
  editedAt: number | null;
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

export interface AppealRow {
  id: number;
  userId: number;
  username: string;
  reason: string;
  status: string; // pending | approved | denied
  createdAt: number;
  decidedBy: string | null;
  decidedAt: number | null;
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
  deleteUserSessions(userId: number): Promise<void>;
  getSessionsForUser(userId: number): Promise<SessionRow[]>;
  createPending(row: PendingRow): Promise<void>;
  getPending(tokenHash: string): Promise<PendingRow | null>;
  deletePending(tokenHash: string): Promise<void>;
  deleteUserPendings(email: string): Promise<void>;
  updatePassword(userId: number, passwordHash: string): Promise<void>;
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
  updateEmail(userId: number, email: string): Promise<void>;
  setMessagePrivacy(userId: number, privacy: MessagePrivacy): Promise<void>;
  getMessagePrivacy(userId: number): Promise<MessagePrivacy>;
  /** Stores the client's E2E public key + timezone for a user. */
  setProfileKeys(userId: number, pubkey: string | null, timezone: string | null): Promise<void>;
  setAvatar(userId: number, avatar: string | null): Promise<void>;
  setStatus(userId: number, status: string): Promise<void>;
  /** Heartbeat: records when the user last had the app open (real presence). */
  setLastSeen(userId: number): Promise<void>;
  /** Renames a user (admin). Returns false when the new name is taken. */
  changeUsername(userId: number, newUsername: string): Promise<boolean>;
  getProfileByUsername(username: string): Promise<{
    username: string;
    avatar: string | null;
    timezone: string | null;
    status: string;
    lastSeenAt: number | null;
    createdAt: number;
  } | null>;

  /* ── web push subscriptions ───────────────────────────────────────── */
  savePushSubscription(userId: number, sub: { endpoint: string; p256dh: string; auth: string }): Promise<void>;
  listPushSubscriptions(userId: number): Promise<{ endpoint: string; p256dh: string; auth: string }[]>;
  removePushSubscription(endpoint: string): Promise<void>;

  getMessagesByIds(ids: number[]): Promise<MessageRow[]>;
  /** Edits an own message: stores the old content in history, returns false if not allowed. */
  editMessage(messageId: number, userId: number, content: string): Promise<boolean>;
  listMessageEdits(messageId: number): Promise<{ content: string; editedAt: number }[]>;
  /** Toggles a reaction; returns "added" or "removed". */
  toggleReaction(messageId: number, userId: number, username: string, emoji: string): Promise<"added" | "removed">;
  listReactions(
    messageIds: number[],
    userId: number
  ): Promise<{ messageId: number; emoji: string; count: number; mine: boolean }[]>;
  /** Friend requests: insert a pending row from → to. */
  sendFriendRequest(fromId: number, toId: number): Promise<"sent" | "already" | "blocked">;
  /** Accept (status = accepted) or decline (delete) an incoming request. */
  respondFriendRequest(userId: number, fromId: number, accept: boolean): Promise<boolean>;
  removeFriend(userId: number, friendId: number): Promise<void>;
  /** Accepted friends only, as {id, username}. */
  listFriends(userId: number): Promise<{ id: number; username: string }[]>;
  /** Incoming + outgoing pending requests with usernames. */
  listFriendRequests(userId: number): Promise<{
    incoming: { id: number; username: string; createdAt: number }[];
    outgoing: { id: number; username: string; createdAt: number }[];
  }>;
  areFriends(a: number, b: number): Promise<boolean>;
  /** Generates N fresh backup codes; returns plaintext (shown once). */
  generateBackupCodes(userId: number, count?: number): Promise<string[]>;
  listBackupCodes(userId: number): Promise<number>;
  redeemBackupCode(userId: number, code: string): Promise<boolean>;
  consumeRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;

  /* ── admin moderation ─────────────────────────────────────────────── */
  /** Sets a ban: until=null lifts it. Reason is stored for the user to see. */
  setBannedUntil(userId: number, until: number | null, reason?: string): Promise<void>;
  /** Appends a warning (visible in the admin panel). */
  addWarning(userId: number, adminUsername: string, reason: string): Promise<void>;
  listWarnings(userId: number): Promise<{ id: number; adminUsername: string; reason: string; createdAt: number }[]>;
  removeWarning(warningId: number): Promise<void>;
  /** Audit trail entry for every admin action. */
  logModeration(adminUsername: string, action: string, targetUsername: string, detail?: string): Promise<void>;
  listModerationLog(limit?: number): Promise<{
    id: number; adminUsername: string; action: string; targetUsername: string; detail: string | null; createdAt: number;
  }[]>;
  /** Case-insensitive username/email search for the admin user picker. */
  searchUsers(query: string, limit?: number): Promise<{ id: number; username: string; email: string; role: string; bannedUntil: number | null; mutedUntil: number | null; createdAt: number }[]>;
  /** All messages ever sent by a username (community + DMs) — admin review. */
  listMessagesByUser(username: string, limit?: number): Promise<MessageRow[]>;
  /** Media refs a user has sent (for the admin media audit). */
  listMediaRefsByUser(username: string, limit?: number): Promise<{ ref: string; mime: string | null; createdAt: number }[]>;
  /** Messages that reference a media ref (used when purging reviewed media). */
  listMessagesByMediaRef(mediaRef: string): Promise<MessageRow[]>;
  /** Queues media for admin review (quarantine). */
  addMediaReview(input: {
    mediaRef: string; mediaMime: string | null; senderUsername: string; reason: string; reporterUsername: string;
  }): Promise<void>;
  listMediaReviews(status: string): Promise<{
    id: number; mediaRef: string; mediaMime: string | null; senderUsername: string; reason: string; status: string; reporterUsername: string | null; createdAt: number;
  }[]>;
  setMediaReviewStatus(id: number, status: string, reviewedBy: string): Promise<void>;
  /** Hard-deletes a message and quarantines its media (admin). */
  getReports(limit?: number): Promise<{
    id: number; messageId: number; reporterId: number; reason: string; status: string; createdAt: number;
  }[]>;
  /** Closes all open reports for a message once it has been actioned. */
  resolveReportsForMessage(messageId: number): Promise<void>;

  /* ── voice calls (signaling relay) ────────────────────────────────── */
  createCallSession(id: string, caller: string, callee: string): Promise<void>;
  getCallSession(id: string): Promise<{
    id: string; caller: string; callee: string; state: string; offer: string | null; answer: string | null; createdAt: number; updatedAt: number;
  } | null>;
  /** Calls the user is involved in (caller or callee), newest first. */
  listActiveCallsFor(username: string): Promise<{
    id: string; caller: string; callee: string; state: string; offer: string | null; answer: string | null; createdAt: number; updatedAt: number;
  }[]>;
  updateCallOffer(id: string, offer: string): Promise<void>;
  updateCallAnswer(id: string, answer: string, state?: string): Promise<void>;
  updateCallState(id: string, state: string): Promise<void>;
  addCallCandidate(callId: string, fromUser: string, candidate: string): Promise<void>;
  listCallCandidates(callId: string, afterId?: number): Promise<{ id: number; fromUser: string; candidate: string }[]>;
  deleteExpiredCalls(olderThan: number): Promise<void>;

  /* ── typing indicators + read receipts ─────────────────────────────── */
  /** Records (typing=true) or clears (typing=false) a user's typing state. */
  setTyping(userId: number, room: string, peer: string, typing: boolean): Promise<void>;
  /** Usernames currently typing in a thread (room, peer), excluding the viewer. */
  listTypers(room: string, peer: string, excludeUserId: number, since: number): Promise<string[]>;
  /** Upserts the highest message id the user has seen in a thread. */
  setReadReceipt(userId: number, room: string, peer: string, messageId: number): Promise<void>;
  /** Other users' last-read message ids in a thread the viewer participates in. */
  listReadReceipts(room: string, peer: string, excludeUserId: number): Promise<{ username: string; userId: number; messageId: number }[]>;
  /** The viewer's own highest read message id in a thread (null if never read). */
  getReadReceipt(userId: number, room: string, peer: string): Promise<number | null>;
  /** Count of unread DMs: messages from `peer` to `me` with id > afterId. */
  countUnreadDm(me: string, peer: string, afterId: number): Promise<number>;

  /* ── suspension appeals ────────────────────────────────────────────── */
  /** Creates a pending appeal; returns false when the account is not banned. */
  createAppeal(input: { userId: number; username: string; reason: string }): Promise<boolean>;
  listAppeals(status?: string): Promise<AppealRow[]>;
  setAppealStatus(id: number, status: string, decidedBy: string): Promise<void>;
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
  remember INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS pending_2fa (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  remember INTEGER NOT NULL DEFAULT 1,
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
  reply_to INTEGER,
  edited_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_username, created_at);

CREATE TABLE IF NOT EXISTS message_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  old_content TEXT NOT NULL,
  edited_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_message_edits_message ON message_edits(message_id);

CREATE TABLE IF NOT EXISTS reactions (
  message_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL,
  blocked_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS friendships (
  user_id INTEGER NOT NULL,
  friend_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_friend ON friendships(friend_id, status);

CREATE TABLE IF NOT EXISTS backup_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  code_hash TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backup_codes_user ON backup_codes(user_id);
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

CREATE TABLE IF NOT EXISTS warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  admin_username TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_warnings_user ON warnings(user_id);

CREATE TABLE IF NOT EXISTS moderation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_username TEXT NOT NULL,
  action TEXT NOT NULL,
  target_username TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_modlog_target ON moderation_log(target_username);
CREATE INDEX IF NOT EXISTS idx_modlog_created ON moderation_log(created_at);

CREATE TABLE IF NOT EXISTS media_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_ref TEXT NOT NULL,
  media_mime TEXT,
  sender_username TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reporter_username TEXT,
  created_at INTEGER NOT NULL,
  reviewed_by TEXT,
  reviewed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_media_reviews_status ON media_reviews(status);

CREATE TABLE IF NOT EXISTS call_sessions (
  id TEXT PRIMARY KEY,
  caller TEXT NOT NULL,
  callee TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ringing',
  offer TEXT,
  answer TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calls_ringing ON call_sessions(callee, state, created_at);
CREATE INDEX IF NOT EXISTS idx_calls_caller ON call_sessions(caller, state, created_at);

CREATE TABLE IF NOT EXISTS call_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id TEXT NOT NULL,
  from_user TEXT NOT NULL,
  candidate TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_call_candidates_call ON call_candidates(call_id, id);

CREATE TABLE IF NOT EXISTS typing_state (
  user_id INTEGER NOT NULL,
  room TEXT NOT NULL,
  peer TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, room, peer)
);

CREATE TABLE IF NOT EXISTS read_receipts (
  user_id INTEGER NOT NULL,
  room TEXT NOT NULL,
  peer TEXT NOT NULL DEFAULT '',
  message_id INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, room, peer)
);

CREATE TABLE IF NOT EXISTS appeals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  decided_by TEXT,
  decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeals(status);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
`;

/**
 * SCHEMA_SQL split into individual statements for D1 exec() compatibility.
 *
 * The Worker runtime's exec() fails on the whole multi-statement script with
 * "incomplete input". Worse, it also chokes on multi-line statements: its
 * statement parser reports "Error in line 1" when a statement spans newlines
 * (the first line alone is never a complete statement). So each statement is
 * flattened to a single line and re-terminated with a semicolon — the exact
 * shape the runtime's parser accepts (single-line `ALTER TABLE` exec() calls
 * have always worked in production).
 */
const SCHEMA_STATEMENTS = SCHEMA_SQL.split(";")
  .map((s) => s.replace(/\s+/g, " ").trim()) // collapse newlines/CRLF → single line
  .filter((s) => s.length > 0)
  .map((s) => `${s};`); // exec() requires statements to end with a semicolon

const USER_COLUMNS =
  "id, email, username, password_hash, dob, agreed_tos, agreed_privacy, agreed_rules, verified, totp_secret, totp_enabled, role, muted_until, banned_until, ban_reason, message_privacy, pubkey, timezone, avatar, status, last_seen_at, created_at";

const MESSAGE_COLUMNS =
  "id, sender_id, sender_username, recipient_username, content, media_ref, media_mime, reply_to, edited_at, created_at";

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
  banned_until: "INTEGER",
  ban_reason: "TEXT",
  pubkey: "TEXT",
  timezone: "TEXT",
  avatar: "TEXT",
  status: "TEXT NOT NULL DEFAULT 'online'",
  last_seen_at: "INTEGER",
};

const MESSAGE_MIGRATIONS: Record<string, string> = {
  media_mime: "TEXT",
  reply_to: "INTEGER",
  edited_at: "INTEGER",
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
    // D1's exec() chokes on the full multi-statement schema script in the
    // Worker runtime (it reports "incomplete input" at the first statement and
    // never creates the tables), so run each statement individually. Each one
    // is small, idempotent (IF NOT EXISTS) and safe to re-run on every cold
    // start.
    for (const statement of SCHEMA_STATEMENTS) {
      await this.db.exec(statement);
    }

    // Migration: add columns that didn't exist when the users table was first
    // created. Each ALTER is best-effort — one drifted column must not abort the
    // rest of schema init (which would 500 every route) or wedge the store.
    const cols = await this.db.prepare("SELECT name FROM pragma_table_info('users')").all();
    const existing = new Set((cols.results as { name: string }[]).map((c) => c.name));
    for (const [column, definition] of Object.entries(USER_MIGRATIONS)) {
      if (!existing.has(column)) {
        await this.addColumn("users", column, definition);
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
        await this.addColumn("messages", column, definition);
      }
    }

    // Migration: message privacy on users (added later).
    if (!existing.has("message_privacy")) {
      await this.addColumn("users", "message_privacy", "TEXT NOT NULL DEFAULT 'everyone'");
    }

    // Migration: remember flag on sessions + pending_2fa (added later).
    const sessionCols = await this.db.prepare("SELECT name FROM pragma_table_info('sessions')").all();
    const sessionExisting = new Set((sessionCols.results as { name: string }[]).map((c) => c.name));
    if (!sessionExisting.has("remember")) {
      await this.addColumn("sessions", "remember", "INTEGER NOT NULL DEFAULT 1");
    }
    const pendingCols = await this.db.prepare("SELECT name FROM pragma_table_info('pending_2fa')").all();
    const pendingExisting = new Set((pendingCols.results as { name: string }[]).map((c) => c.name));
    if (!pendingExisting.has("remember")) {
      await this.addColumn("pending_2fa", "remember", "INTEGER NOT NULL DEFAULT 1");
    }

    const now = Date.now();
    await this.db.prepare("DELETE FROM codes WHERE expires_at < ?1").bind(now).run();
    await this.db.prepare("DELETE FROM sessions WHERE expires_at < ?1").bind(now).run();
    await this.db.prepare("DELETE FROM pending_2fa WHERE expires_at < ?1").bind(now).run();

  }

  /**
   * Best-effort column migration. A failed ALTER is logged and swallowed so a
   * single drifted column can't abort the rest of schema init (which would 500
   * every route). Table/column names come from constant maps only — never user
   * input — so interpolation is safe.
   */
  private async addColumn(table: string, column: string, definition: string): Promise<void> {
    try {
      await this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch (err) {
      console.error(
        `store: could not add ${table}.${column} — ${err instanceof Error ? err.message : err}`
      );
    }
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
      bannedUntil: row.banned_until == null ? null : Number(row.banned_until),
      banReason: row.ban_reason == null ? null : String(row.ban_reason),
      messagePrivacy: row.message_privacy === "friends" || row.message_privacy === "nobody" ? row.message_privacy : "everyone",
      pubkey: row.pubkey == null ? null : String(row.pubkey),
      timezone: row.timezone == null ? null : String(row.timezone),
      avatar: row.avatar == null ? null : String(row.avatar),
      status: row.status == null ? "online" : String(row.status),
      lastSeenAt: row.last_seen_at == null ? null : Number(row.last_seen_at),
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
      replyToId: row.reply_to == null ? null : Number(row.reply_to),
      editedAt: row.edited_at == null ? null : Number(row.edited_at),
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
        "INSERT OR REPLACE INTO sessions (token_hash, user_id, email, remember, expires_at, created_at, last_used_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
      )
      .bind(row.tokenHash, row.userId, row.email, row.remember ? 1 : 0, row.expiresAt, row.createdAt, row.lastUsedAt)
      .run();
  }

  async getSession(tokenHash: string): Promise<SessionRow | null> {
    const row = await this.db
      .prepare("SELECT token_hash, user_id, email, remember, expires_at, created_at, last_used_at FROM sessions WHERE token_hash = ?1")
      .bind(tokenHash)
      .first();
    if (!row) return null;
    return {
      tokenHash: String(row.token_hash),
      userId: Number(row.user_id),
      email: String(row.email),
      remember: Number(row.remember) === 1,
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
          "INSERT OR REPLACE INTO sessions (token_hash, user_id, email, remember, expires_at, created_at, last_used_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
        )
        .bind(row.tokenHash, row.userId, row.email, row.remember ? 1 : 0, row.expiresAt, row.createdAt, row.lastUsedAt),
      this.db.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(oldHash),
    ]);
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(tokenHash).run();
  }

  async deleteUserSessions(userId: number): Promise<void> {
    await this.db.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(userId).run();
  }

  async getSessionsForUser(userId: number): Promise<SessionRow[]> {
    const res = await this.db
      .prepare(
        "SELECT token_hash, user_id, email, remember, expires_at, created_at, last_used_at FROM sessions WHERE user_id = ?1"
      )
      .bind(userId)
      .all();
    return (res.results as Record<string, unknown>[]).map((r) => ({
      tokenHash: String(r.token_hash),
      userId: Number(r.user_id),
      email: String(r.email),
      remember: Number(r.remember) === 1,
      expiresAt: Number(r.expires_at),
      createdAt: Number(r.created_at),
      lastUsedAt: Number(r.last_used_at),
    }));
  }

  async createPending(row: PendingRow): Promise<void> {
    await this.db
      .prepare("INSERT OR REPLACE INTO pending_2fa (token_hash, email, remember, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(row.tokenHash, row.email, row.remember ? 1 : 0, row.expiresAt, row.createdAt)
      .run();
  }

  async getPending(tokenHash: string): Promise<PendingRow | null> {
    const row = await this.db
      .prepare("SELECT token_hash, email, remember, expires_at, created_at FROM pending_2fa WHERE token_hash = ?1")
      .bind(tokenHash)
      .first();
    if (!row) return null;
    return {
      tokenHash: String(row.token_hash),
      email: String(row.email),
      remember: Number(row.remember) === 1,
      expiresAt: Number(row.expires_at),
      createdAt: Number(row.created_at),
    };
  }

  async deletePending(tokenHash: string): Promise<void> {
    await this.db.prepare("DELETE FROM pending_2fa WHERE token_hash = ?1").bind(tokenHash).run();
  }

  async deleteUserPendings(email: string): Promise<void> {
    await this.db.prepare("DELETE FROM pending_2fa WHERE email = ?1").bind(email).run();
  }

  async updatePassword(userId: number, passwordHash: string): Promise<void> {
    await this.db.prepare("UPDATE users SET password_hash = ?2 WHERE id = ?1").bind(userId, passwordHash).run();
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

  /* ── admin moderation ─────────────────────────────────────────────── */

  async setBannedUntil(userId: number, until: number | null, reason?: string): Promise<void> {
    await this.db
      .prepare("UPDATE users SET banned_until = ?1, ban_reason = ?2 WHERE id = ?3")
      .bind(until, reason ?? null, userId)
      .run();
  }

  async addWarning(userId: number, adminUsername: string, reason: string): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO warnings (user_id, admin_username, reason, created_at) VALUES (?1, ?2, ?3, ?4)"
      )
      .bind(userId, adminUsername, reason, Date.now())
      .run();
  }

  async listWarnings(userId: number): Promise<{ id: number; adminUsername: string; reason: string; createdAt: number }[]> {
    const res = await this.db
      .prepare(
        "SELECT id, admin_username, reason, created_at FROM warnings WHERE user_id = ?1 ORDER BY id DESC LIMIT 50"
      )
      .bind(userId)
      .all();
    return (res.results as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id),
      adminUsername: String(r.admin_username),
      reason: String(r.reason),
      createdAt: Number(r.created_at),
    }));
  }

  async removeWarning(warningId: number): Promise<void> {
    await this.db.prepare("DELETE FROM warnings WHERE id = ?1").bind(warningId).run();
  }

  async logModeration(adminUsername: string, action: string, targetUsername: string, detail?: string): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO moderation_log (admin_username, action, target_username, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5)"
      )
      .bind(adminUsername, action, targetUsername, detail ?? null, Date.now())
      .run();
  }

  async listModerationLog(limit = 100): Promise<{
    id: number; adminUsername: string; action: string; targetUsername: string; detail: string | null; createdAt: number;
  }[]> {
    const res = await this.db
      .prepare(
        "SELECT id, admin_username, action, target_username, detail, created_at FROM moderation_log ORDER BY id DESC LIMIT ?1"
      )
      .bind(limit)
      .all();
    return (res.results as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id),
      adminUsername: String(r.admin_username),
      action: String(r.action),
      targetUsername: String(r.target_username),
      detail: r.detail == null ? null : String(r.detail),
      createdAt: Number(r.created_at),
    }));
  }

  async searchUsers(query: string, limit = 25): Promise<{
    id: number; username: string; email: string; role: string; bannedUntil: number | null; mutedUntil: number | null; createdAt: number;
  }[]> {
    const like = `%${query}%`;
    const res = await this.db
      .prepare(
        "SELECT id, username, email, role, banned_until, muted_until, created_at FROM users WHERE username LIKE ?1 OR email LIKE ?1 ORDER BY username ASC LIMIT ?2"
      )
      .bind(like, limit)
      .all();
    return (res.results as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id),
      username: String(r.username),
      email: String(r.email),
      role: r.role === "admin" ? "admin" : "user",
      bannedUntil: r.banned_until == null ? null : Number(r.banned_until),
      mutedUntil: r.muted_until == null ? null : Number(r.muted_until),
      createdAt: Number(r.created_at),
    }));
  }

  async listMessagesByUser(username: string, limit = 50): Promise<MessageRow[]> {
    const res = await this.db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE sender_username = ?1 ORDER BY id DESC LIMIT ?2`
      )
      .bind(username, limit)
      .all();
    return (res.results as Record<string, unknown>[]).reverse().map(D1AuthStore.toMessage);
  }

  async listMediaRefsByUser(username: string, limit = 50): Promise<{ ref: string; mime: string | null; createdAt: number }[]> {
    const res = await this.db
      .prepare(
        "SELECT media_ref, media_mime, created_at FROM messages WHERE sender_username = ?1 AND media_ref IS NOT NULL ORDER BY id DESC LIMIT ?2"
      )
      .bind(username, limit)
      .all();
    return (res.results as Record<string, unknown>[]).map((r) => ({
      ref: String(r.media_ref),
      mime: r.media_mime == null ? null : String(r.media_mime),
      createdAt: Number(r.created_at),
    }));
  }

  async listMessagesByMediaRef(mediaRef: string): Promise<MessageRow[]> {
    const res = await this.db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE media_ref = ?1`
      )
      .bind(mediaRef)
      .all();
    return (res.results as Record<string, unknown>[]).map(D1AuthStore.toMessage);
  }

  async addMediaReview(input: {
    mediaRef: string; mediaMime: string | null; senderUsername: string; reason: string; reporterUsername: string;
  }): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO media_reviews (media_ref, media_mime, sender_username, reason, status, reporter_username, created_at) VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?6)"
      )
      .bind(input.mediaRef, input.mediaMime, input.senderUsername, input.reason, input.reporterUsername, Date.now())
      .run();
  }

  async listMediaReviews(status: string): Promise<{
    id: number; mediaRef: string; mediaMime: string | null; senderUsername: string; reason: string; status: string; reporterUsername: string | null; createdAt: number;
  }[]> {
    const res = await this.db
      .prepare(
        "SELECT id, media_ref, media_mime, sender_username, reason, status, reporter_username, created_at FROM media_reviews WHERE status = ?1 ORDER BY id DESC LIMIT 100"
      )
      .bind(status)
      .all();
    return (res.results as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id),
      mediaRef: String(r.media_ref),
      mediaMime: r.media_mime == null ? null : String(r.media_mime),
      senderUsername: String(r.sender_username),
      reason: String(r.reason),
      status: String(r.status),
      reporterUsername: r.reporter_username == null ? null : String(r.reporter_username),
      createdAt: Number(r.created_at),
    }));
  }

  async setMediaReviewStatus(id: number, status: string, reviewedBy: string): Promise<void> {
    await this.db
      .prepare("UPDATE media_reviews SET status = ?1, reviewed_by = ?2, reviewed_at = ?3 WHERE id = ?4")
      .bind(status, reviewedBy, Date.now(), id)
      .run();
  }

  async getReports(limit = 100): Promise<{
    id: number; messageId: number; reporterId: number; reason: string; status: string; createdAt: number;
  }[]> {
    const res = await this.db
      .prepare(
        "SELECT id, message_id, reporter_id, reason, status, created_at FROM reports WHERE status = 'open' ORDER BY id DESC LIMIT ?1"
      )
      .bind(limit)
      .all();
    return (res.results as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id),
      messageId: Number(r.message_id),
      reporterId: Number(r.reporter_id),
      reason: String(r.reason),
      status: String(r.status),
      createdAt: Number(r.created_at),
    }));
  }

  async resolveReportsForMessage(messageId: number): Promise<void> {
    await this.db
      .prepare("UPDATE reports SET status = 'resolved' WHERE message_id = ?1 AND status = 'open'")
      .bind(messageId)
      .run();
  }

  /* ── voice calls (signaling relay) ────────────────────────────────── */

  async createCallSession(id: string, caller: string, callee: string): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare(
        "INSERT INTO call_sessions (id, caller, callee, state, created_at, updated_at) VALUES (?1, ?2, ?3, 'ringing', ?4, ?4)"
      )
      .bind(id, caller, callee, now)
      .run();
  }

  async getCallSession(id: string): Promise<{
    id: string; caller: string; callee: string; state: string; offer: string | null; answer: string | null; createdAt: number; updatedAt: number;
  } | null> {
    const row = await this.db
      .prepare("SELECT id, caller, callee, state, offer, answer, created_at, updated_at FROM call_sessions WHERE id = ?1 LIMIT 1")
      .bind(id)
      .first();
    if (!row) return null;
    return {
      id: String(row.id),
      caller: String(row.caller),
      callee: String(row.callee),
      state: String(row.state),
      offer: row.offer == null ? null : String(row.offer),
      answer: row.answer == null ? null : String(row.answer),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  async listActiveCallsFor(username: string): Promise<{
    id: string; caller: string; callee: string; state: string; offer: string | null; answer: string | null; createdAt: number; updatedAt: number;
  }[]> {
    const res = await this.db
      .prepare(
        "SELECT id, caller, callee, state, offer, answer, created_at, updated_at FROM call_sessions WHERE (caller = ?1 OR callee = ?1) AND state != 'ended' ORDER BY updated_at DESC LIMIT 10"
      )
      .bind(username)
      .all();
    return (res.results as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      caller: String(r.caller),
      callee: String(r.callee),
      state: String(r.state),
      offer: r.offer == null ? null : String(r.offer),
      answer: r.answer == null ? null : String(r.answer),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    }));
  }

  async updateCallOffer(id: string, offer: string): Promise<void> {
    await this.db
      .prepare("UPDATE call_sessions SET offer = ?1, updated_at = ?2 WHERE id = ?3")
      .bind(offer, Date.now(), id)
      .run();
  }

  async updateCallAnswer(id: string, answer: string, state = "active"): Promise<void> {
    await this.db
      .prepare("UPDATE call_sessions SET answer = ?1, state = ?2, updated_at = ?3 WHERE id = ?4")
      .bind(answer, state, Date.now(), id)
      .run();
  }

  async updateCallState(id: string, state: string): Promise<void> {
    await this.db
      .prepare("UPDATE call_sessions SET state = ?1, updated_at = ?2 WHERE id = ?3")
      .bind(state, Date.now(), id)
      .run();
  }

  async addCallCandidate(callId: string, fromUser: string, candidate: string): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO call_candidates (call_id, from_user, candidate, created_at) VALUES (?1, ?2, ?3, ?4)"
      )
      .bind(callId, fromUser, candidate, Date.now())
      .run();
  }

  async listCallCandidates(callId: string, afterId?: number): Promise<{ id: number; fromUser: string; candidate: string }[]> {
    const res = await this.db
      .prepare(
        "SELECT id, from_user, candidate FROM call_candidates WHERE call_id = ?1 AND id > ?2 ORDER BY id ASC"
      )
      .bind(callId, afterId ?? 0)
      .all();
    return (res.results as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id),
      fromUser: String(r.from_user),
      candidate: String(r.candidate),
    }));
  }

  async deleteExpiredCalls(olderThan: number): Promise<void> {
    await this.db
      .prepare("DELETE FROM call_sessions WHERE updated_at < ?1 AND state = 'ended'")
      .bind(olderThan)
      .run();
    await this.db.prepare("DELETE FROM call_candidates WHERE created_at < ?1").bind(olderThan - 60_000).run();
  }

  async updateEmail(userId: number, email: string): Promise<void> {
    await this.db.prepare("UPDATE users SET email = ?1 WHERE id = ?2").bind(email, userId).run();
  }

  async setMessagePrivacy(userId: number, privacy: MessagePrivacy): Promise<void> {
    await this.db
      .prepare("UPDATE users SET message_privacy = ?1 WHERE id = ?2")
      .bind(privacy, userId)
      .run();
  }

  async setProfileKeys(
    userId: number,
    pubkey: string | null,
    timezone: string | null
  ): Promise<void> {
    await this.db
      .prepare("UPDATE users SET pubkey = ?1, timezone = ?2 WHERE id = ?3")
      .bind(pubkey, timezone, userId)
      .run();
  }

  async setAvatar(userId: number, avatar: string | null): Promise<void> {
    await this.db.prepare("UPDATE users SET avatar = ?1 WHERE id = ?2").bind(avatar, userId).run();
  }

  async setStatus(userId: number, status: string): Promise<void> {
    await this.db.prepare("UPDATE users SET status = ?1 WHERE id = ?2").bind(status, userId).run();
  }

  async setLastSeen(userId: number): Promise<void> {
    await this.db.prepare("UPDATE users SET last_seen_at = ?1 WHERE id = ?2").bind(Date.now(), userId).run();
  }

  async changeUsername(userId: number, newUsername: string): Promise<boolean> {
    if (await this.getUserByUsername(newUsername)) return false;
    await this.db.prepare("UPDATE users SET username = ?1 WHERE id = ?2").bind(newUsername, userId).run();
    // Keep chat history readable: rewrite the sender/recipient columns too.
    const old = await this.getUserById(userId);
    if (old) {
      await this.db.batch([
        this.db.prepare("UPDATE messages SET sender_username = ?1 WHERE sender_username = ?2").bind(newUsername, old.username),
        this.db.prepare("UPDATE messages SET recipient_username = ?1 WHERE recipient_username = ?2").bind(newUsername, old.username),
      ]);
    }
    return true;
  }

  async savePushSubscription(
    userId: number,
    sub: { endpoint: string; p256dh: string; auth: string }
  ): Promise<void> {
    await this.db
      .prepare(
        "INSERT OR REPLACE INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?1, ?2, ?3, ?4, ?5)"
      )
      .bind(sub.endpoint, userId, sub.p256dh, sub.auth, Date.now())
      .run();
  }

  async listPushSubscriptions(userId: number): Promise<{ endpoint: string; p256dh: string; auth: string }[]> {
    const res = await this.db
      .prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?1")
      .bind(userId)
      .all();
    return (res.results as Record<string, unknown>[]).map((r) => ({
      endpoint: String(r.endpoint),
      p256dh: String(r.p256dh),
      auth: String(r.auth),
    }));
  }

  async removePushSubscription(endpoint: string): Promise<void> {
    await this.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?1").bind(endpoint).run();
  }

  async getProfileByUsername(username: string): Promise<{
    username: string;
    avatar: string | null;
    timezone: string | null;
    status: string;
    lastSeenAt: number | null;
    createdAt: number;
  } | null> {
    const row = await this.db
      .prepare("SELECT username, avatar, timezone, status, last_seen_at, created_at FROM users WHERE username = ?1 LIMIT 1")
      .bind(username)
      .first();
    if (!row) return null;
    return {
      username: String(row.username),
      avatar: row.avatar == null ? null : String(row.avatar),
      timezone: row.timezone == null ? null : String(row.timezone),
      status: row.status == null ? "online" : String(row.status),
      lastSeenAt: row.last_seen_at == null ? null : Number(row.last_seen_at),
      createdAt: Number(row.created_at),
    };
  }

  async getMessagesByIds(ids: number[]): Promise<MessageRow[]> {
    if (ids.length === 0) return [];
    const ph = ids.map((_, i) => `?${i + 1}`).join(",");
    const res = await this.db
      .prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id IN (${ph})`)
      .bind(...ids)
      .all();
    return (res.results as Record<string, unknown>[]).map(D1AuthStore.toMessage);
  }

  async editMessage(messageId: number, userId: number, content: string): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT sender_id, content FROM messages WHERE id = ?1 LIMIT 1")
      .bind(messageId)
      .first();
    if (!row || Number(row.sender_id) !== userId) return false;
    const now = Date.now();
    await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO message_edits (message_id, old_content, edited_at) VALUES (?1, ?2, ?3)"
        )
        .bind(messageId, String(row.content), now),
      this.db
        .prepare("UPDATE messages SET content = ?1, edited_at = ?2 WHERE id = ?3")
        .bind(content, now, messageId),
    ]);
    return true;
  }

  async listMessageEdits(messageId: number): Promise<{ content: string; editedAt: number }[]> {
    const res = await this.db
      .prepare(
        "SELECT old_content, edited_at FROM message_edits WHERE message_id = ?1 ORDER BY edited_at ASC"
      )
      .bind(messageId)
      .all();
    return (res.results as Record<string, unknown>[]).map((r) => ({
      content: String(r.old_content),
      editedAt: Number(r.edited_at),
    }));
  }

  async toggleReaction(
    messageId: number,
    userId: number,
    username: string,
    emoji: string
  ): Promise<"added" | "removed"> {
    const row = await this.db
      .prepare(
        "SELECT 1 FROM reactions WHERE message_id = ?1 AND user_id = ?2 AND emoji = ?3 LIMIT 1"
      )
      .bind(messageId, userId, emoji)
      .first();
    if (row) {
      await this.db
        .prepare("DELETE FROM reactions WHERE message_id = ?1 AND user_id = ?2 AND emoji = ?3")
        .bind(messageId, userId, emoji)
        .run();
      return "removed";
    }
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO reactions (message_id, user_id, username, emoji, created_at) VALUES (?1, ?2, ?3, ?4, ?5)"
      )
      .bind(messageId, userId, username, emoji, Date.now())
      .run();
    return "added";
  }

  async listReactions(
    messageIds: number[],
    userId: number
  ): Promise<{ messageId: number; emoji: string; count: number; mine: boolean }[]> {
    if (messageIds.length === 0) return [];
    const ph = messageIds.map((_, i) => `?${i + 1}`).join(",");
    const res = await this.db
      .prepare(
        `SELECT message_id, emoji, COUNT(*) AS n, MAX(CASE WHEN user_id = ?${messageIds.length + 1} THEN 1 ELSE 0 END) AS mine
         FROM reactions WHERE message_id IN (${ph}) GROUP BY message_id, emoji`
      )
      .bind(...messageIds, userId)
      .all();
    return (res.results as Record<string, unknown>[]).map((r) => ({
      messageId: Number(r.message_id),
      emoji: String(r.emoji),
      count: Number(r.n),
      mine: Number(r.mine) === 1,
    }));
  }

  async getMessagePrivacy(userId: number): Promise<MessagePrivacy> {
    const row = await this.db
      .prepare("SELECT message_privacy FROM users WHERE id = ?1")
      .bind(userId)
      .first();
    const p = row?.message_privacy;
    return p === "friends" || p === "nobody" ? p : "everyone";
  }

  async sendFriendRequest(fromId: number, toId: number): Promise<"sent" | "already" | "blocked"> {
    if (await this.isBlocked(fromId, toId)) return "blocked";
    if (await this.areFriends(fromId, toId)) return "already";
    await this.db
      .prepare(
        "INSERT OR REPLACE INTO friendships (user_id, friend_id, status, created_at) VALUES (?1, ?2, 'pending', ?3)"
      )
      .bind(fromId, toId, Date.now())
      .run();
    return "sent";
  }

  async respondFriendRequest(userId: number, fromId: number, accept: boolean): Promise<boolean> {
    const row = await this.db
      .prepare(
        "SELECT 1 FROM friendships WHERE user_id = ?1 AND friend_id = ?2 AND status = 'pending' LIMIT 1"
      )
      .bind(fromId, userId)
      .first();
    if (!row) return false;
    if (accept) {
      await this.db.batch([
        this.db
          .prepare("UPDATE friendships SET status = 'accepted' WHERE user_id = ?1 AND friend_id = ?2")
          .bind(fromId, userId),
        // Store the mirror row too so lookups in either direction are trivial.
        this.db
          .prepare(
            "INSERT OR REPLACE INTO friendships (user_id, friend_id, status, created_at) VALUES (?1, ?2, 'accepted', ?3)"
          )
          .bind(userId, fromId, Date.now()),
      ]);
    } else {
      await this.db.batch([
        this.db.prepare("DELETE FROM friendships WHERE user_id = ?1 AND friend_id = ?2").bind(fromId, userId),
        this.db.prepare("DELETE FROM friendships WHERE user_id = ?1 AND friend_id = ?2").bind(userId, fromId),
      ]);
    }
    return true;
  }

  async removeFriend(userId: number, friendId: number): Promise<void> {
    await this.db.batch([
      this.db.prepare("DELETE FROM friendships WHERE user_id = ?1 AND friend_id = ?2").bind(userId, friendId),
      this.db.prepare("DELETE FROM friendships WHERE user_id = ?1 AND friend_id = ?2").bind(friendId, userId),
    ]);
  }

  async listFriends(userId: number): Promise<{ id: number; username: string }[]> {
    // Accepted friendships store mirror rows, so one direction is enough.
    const res = await this.db
      .prepare(
        `SELECT u.id AS id, u.username AS username FROM users u
         JOIN friendships f ON f.friend_id = u.id
         WHERE f.user_id = ?1 AND f.status = 'accepted' ORDER BY u.username ASC`
      )
      .bind(userId)
      .all();
    return (res.results as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id),
      username: String(r.username),
    }));
  }

  async listFriendRequests(userId: number): Promise<{
    incoming: { id: number; username: string; createdAt: number }[];
    outgoing: { id: number; username: string; createdAt: number }[];
  }> {
    // Pending requests exist only as a single row (from → to).
    const [inRes, outRes] = await Promise.all([
      this.db
        .prepare(
          "SELECT u.id AS id, u.username AS username, f.created_at AS created_at FROM friendships f JOIN users u ON u.id = f.user_id WHERE f.friend_id = ?1 AND f.status = 'pending'"
        )
        .bind(userId)
        .all(),
      this.db
        .prepare(
          "SELECT u.id AS id, u.username AS username, f.created_at AS created_at FROM friendships f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ?1 AND f.status = 'pending'"
        )
        .bind(userId)
        .all(),
    ]);
    const map = (r: Record<string, unknown>) => ({
      id: Number(r.id),
      username: String(r.username),
      createdAt: Number(r.created_at),
    });
    return {
      incoming: (inRes.results as Record<string, unknown>[]).map(map),
      outgoing: (outRes.results as Record<string, unknown>[]).map(map),
    };
  }

  async areFriends(a: number, b: number): Promise<boolean> {
    const row = await this.db
      .prepare(
        "SELECT 1 FROM friendships WHERE ((user_id = ?1 AND friend_id = ?2) OR (user_id = ?2 AND friend_id = ?1)) AND status = 'accepted' LIMIT 1"
      )
      .bind(a, b)
      .first();
    return Boolean(row);
  }

  async generateBackupCodes(userId: number, count = 10): Promise<string[]> {
    await this.db.prepare("DELETE FROM backup_codes WHERE user_id = ?1").bind(userId).run();
    const codes: string[] = [];
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      const code = generateBackupCode();
      codes.push(code);
      await this.db
        .prepare(
          "INSERT INTO backup_codes (user_id, code_hash, used, created_at) VALUES (?1, ?2, 0, ?3)"
        )
        .bind(userId, backupCodeHash(code), now)
        .run();
    }
    return codes;
  }

  async listBackupCodes(userId: number): Promise<number> {
    const row = await this.db
      .prepare("SELECT COUNT(*) AS n FROM backup_codes WHERE user_id = ?1 AND used = 0")
      .bind(userId)
      .first();
    return Number(row?.n ?? 0);
  }

  async redeemBackupCode(userId: number, code: string): Promise<boolean> {
    const hash = backupCodeHash(code);
    const row = await this.db
      .prepare(
        "SELECT id FROM backup_codes WHERE user_id = ?1 AND code_hash = ?2 AND used = 0 LIMIT 1"
      )
      .bind(userId, hash)
      .first();
    if (!row) return false;
    await this.db
      .prepare("UPDATE backup_codes SET used = 1 WHERE id = ?1")
      .bind(Number(row.id))
      .run();
    return true;
  }

  async addMessage(input: Omit<MessageRow, "id">): Promise<MessageRow> {
    const res = await this.db
      .prepare(
        "INSERT INTO messages (sender_id, sender_username, recipient_username, content, media_ref, media_mime, reply_to, edited_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
      )
      .bind(
        input.senderId,
        input.senderUsername,
        input.recipientUsername,
        input.content,
        input.mediaRef,
        input.mediaMime,
        input.replyToId,
        input.editedAt,
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

  /* ── typing indicators + read receipts ─────────────────────────────── */
  async setTyping(userId: number, room: string, peer: string, typing: boolean): Promise<void> {
    const now = Date.now();
    if (typing) {
      await this.db
        .prepare(
          `INSERT INTO typing_state (user_id, room, peer, updated_at) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(user_id, room, peer) DO UPDATE SET updated_at = ?4`
        )
        .bind(userId, room, peer, now)
        .run();
    } else {
      await this.db
        .prepare(`DELETE FROM typing_state WHERE user_id = ?1 AND room = ?2 AND peer = ?3`)
        .bind(userId, room, peer)
        .run();
    }
    // Cheap sweep so the table never grows past live typers.
    await this.db
      .prepare(`DELETE FROM typing_state WHERE updated_at < ?1`)
      .bind(now - 10_000)
      .run();
  }

  async listTypers(room: string, peer: string, excludeUserId: number, since: number): Promise<string[]> {
    const res = await this.db
      .prepare(
        `SELECT u.username FROM typing_state t
         JOIN users u ON u.id = t.user_id
         WHERE t.room = ?1 AND t.peer = ?2 AND t.user_id != ?3 AND t.updated_at > ?4
         ORDER BY t.updated_at DESC LIMIT 5`
      )
      .bind(room, peer, excludeUserId, since)
      .all();
    return (res.results as Record<string, unknown>[]).map((r) => String(r.username));
  }

  async setReadReceipt(userId: number, room: string, peer: string, messageId: number): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO read_receipts (user_id, room, peer, message_id, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(user_id, room, peer) DO UPDATE SET message_id = ?4, updated_at = ?5`
      )
      .bind(userId, room, peer, messageId, now)
      .run();
  }

  async listReadReceipts(room: string, peer: string, excludeUserId: number): Promise<{ username: string; userId: number; messageId: number }[]> {
    const res = await this.db
      .prepare(
        `SELECT u.username, r.user_id, r.message_id FROM read_receipts r
         JOIN users u ON u.id = r.user_id
         WHERE r.room = ?1 AND r.peer = ?2 AND r.user_id != ?3`
      )
      .bind(room, peer, excludeUserId)
      .all();
    return (res.results as Record<string, unknown>[]).map((r) => ({
      username: String(r.username),
      userId: Number(r.user_id),
      messageId: Number(r.message_id),
    }));
  }

  async getReadReceipt(userId: number, room: string, peer: string): Promise<number | null> {
    const row = await this.db
      .prepare(
        "SELECT message_id FROM read_receipts WHERE user_id = ?1 AND room = ?2 AND peer = ?3 LIMIT 1"
      )
      .bind(userId, room, peer)
      .first();
    return row == null ? null : Number(row.message_id);
  }

  async countUnreadDm(me: string, peer: string, afterId: number): Promise<number> {
    const row = await this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM messages WHERE sender_username = ?1 AND recipient_username = ?2 AND id > ?3"
      )
      .bind(peer, me, afterId)
      .first();
    return row == null ? 0 : Number(row.n);
  }

  /* ── suspension appeals ────────────────────────────────────────────── */
  async createAppeal(input: { userId: number; username: string; reason: string }): Promise<boolean> {
    const user = await this.getUserById(input.userId);
    if (!user || !(user.bannedUntil && user.bannedUntil > Date.now())) return false;
    await this.db
      .prepare(`INSERT INTO appeals (user_id, username, reason, status, created_at) VALUES (?1, ?2, ?3, 'pending', ?4)`)
      .bind(input.userId, input.username, input.reason, Date.now())
      .run();
    return true;
  }

  async listAppeals(status?: string): Promise<AppealRow[]> {
    const res = status
      ? await this.db.prepare(`SELECT * FROM appeals WHERE status = ?1 ORDER BY created_at DESC LIMIT 100`).bind(status).all()
      : await this.db.prepare(`SELECT * FROM appeals ORDER BY created_at DESC LIMIT 200`).all();
    return (res.results as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id),
      userId: Number(r.user_id),
      username: String(r.username),
      reason: String(r.reason),
      status: String(r.status),
      createdAt: Number(r.created_at),
      decidedBy: r.decided_by == null ? null : String(r.decided_by),
      decidedAt: r.decided_at == null ? null : Number(r.decided_at),
    }));
  }

  async setAppealStatus(id: number, status: string, decidedBy: string): Promise<void> {
    await this.db
      .prepare(`UPDATE appeals SET status = ?1, decided_by = ?2, decided_at = ?3 WHERE id = ?4`)
      .bind(status, decidedBy, Date.now(), id)
      .run();
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
  private friendRows = new Map<string, { user_id: number; friend_id: number; status: string; created_at: number }>();
  private backupCodes: { id: number; user_id: number; code_hash: string; used: number; created_at: number }[] = [];
  private nextBackupCodeId = 1;
  private reports: { id: number; messageId: number; reporterId: number; reason: string; createdAt: number }[] = [];
  private nextReportId = 1;
  private warnings: { id: number; userId: number; adminUsername: string; reason: string; createdAt: number }[] = [];
  private nextWarningId = 1;
  private modLog: { id: number; adminUsername: string; action: string; targetUsername: string; detail: string | null; createdAt: number }[] = [];
  private nextModLogId = 1;
  private mediaReviews: {
    id: number; mediaRef: string; mediaMime: string | null; senderUsername: string; reason: string; status: string; reporterUsername: string | null; createdAt: number;
  }[] = [];
  private nextMediaReviewId = 1;
  private callSessions = new Map<string, {
    id: string; caller: string; callee: string; state: string; offer: string | null; answer: string | null; createdAt: number; updatedAt: number;
  }>();
  private callCandidates = new Map<string, { id: number; fromUser: string; candidate: string; createdAt: number }[]>();
  private nextCallCandidateId = 1;
  private typing = new Map<string, { updatedAt: number; username: string }>(); // "userId:room:peer"
  private readReceipts = new Map<string, { messageId: number; userId: number }>(); // "userId:room:peer"
  private appeals: AppealRow[] = [];
  private nextAppealId = 1;
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
      bannedUntil: null,
      banReason: null,
      messagePrivacy: "everyone",
      pubkey: null,
      timezone: null,
      avatar: null,
      status: "online",
      lastSeenAt: null,
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

  async deleteUserSessions(userId: number): Promise<void> {
    for (const [hash, row] of this.sessions) {
      if (row.userId === userId) this.sessions.delete(hash);
    }
  }

  async getSessionsForUser(userId: number): Promise<SessionRow[]> {
    return [...this.sessions.values()].filter((s) => s.userId === userId);
  }

  async updatePassword(userId: number, passwordHash: string): Promise<void> {
    const user = this.usersById.get(userId);
    if (user) user.passwordHash = passwordHash;
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

  async deleteUserPendings(email: string): Promise<void> {
    for (const [hash, row] of this.pendings) {
      if (row.email === email) this.pendings.delete(hash);
    }
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

  async setBannedUntil(userId: number, until: number | null, reason?: string): Promise<void> {
    const user = this.usersById.get(userId);
    if (user) {
      user.bannedUntil = until;
      user.banReason = reason ?? null;
    }
  }

  async addWarning(userId: number, adminUsername: string, reason: string): Promise<void> {
    this.warnings.push({ id: this.nextWarningId++, userId, adminUsername, reason, createdAt: Date.now() });
  }

  async listWarnings(userId: number): Promise<{ id: number; adminUsername: string; reason: string; createdAt: number }[]> {
    return this.warnings.filter((w) => w.userId === userId).slice(-50).reverse();
  }

  async removeWarning(warningId: number): Promise<void> {
    this.warnings = this.warnings.filter((w) => w.id !== warningId);
  }

  async logModeration(adminUsername: string, action: string, targetUsername: string, detail?: string): Promise<void> {
    this.modLog.push({ id: this.nextModLogId++, adminUsername, action, targetUsername, detail: detail ?? null, createdAt: Date.now() });
    if (this.modLog.length > 500) this.modLog = this.modLog.slice(-500);
  }

  async listModerationLog(limit = 100): Promise<{
    id: number; adminUsername: string; action: string; targetUsername: string; detail: string | null; createdAt: number;
  }[]> {
    return this.modLog.slice(-limit).reverse();
  }

  async searchUsers(query: string, limit = 25): Promise<{
    id: number; username: string; email: string; role: string; bannedUntil: number | null; mutedUntil: number | null; createdAt: number;
  }[]> {
    const q = query.toLowerCase();
    return [...this.usersById.values()]
      .filter((u) => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .slice(0, limit)
      .map((u) => ({ id: u.id, username: u.username, email: u.email, role: u.role, bannedUntil: u.bannedUntil, mutedUntil: u.mutedUntil, createdAt: u.createdAt }));
  }

  async listMessagesByUser(username: string, limit = 50): Promise<MessageRow[]> {
    return this.messages.filter((m) => m.senderUsername === username).slice(-limit);
  }

  async listMediaRefsByUser(username: string, limit = 50): Promise<{ ref: string; mime: string | null; createdAt: number }[]> {
    return this.messages
      .filter((m) => m.senderUsername === username && m.mediaRef != null)
      .slice(-limit)
      .reverse()
      .map((m) => ({ ref: String(m.mediaRef), mime: m.mediaMime, createdAt: m.createdAt }));
  }

  async listMessagesByMediaRef(mediaRef: string): Promise<MessageRow[]> {
    return this.messages.filter((m) => m.mediaRef === mediaRef);
  }

  async addMediaReview(input: {
    mediaRef: string; mediaMime: string | null; senderUsername: string; reason: string; reporterUsername: string;
  }): Promise<void> {
    this.mediaReviews.push({
      id: this.nextMediaReviewId++,
      mediaRef: input.mediaRef,
      mediaMime: input.mediaMime,
      senderUsername: input.senderUsername,
      reason: input.reason,
      status: "pending",
      reporterUsername: input.reporterUsername,
      createdAt: Date.now(),
    });
  }

  async listMediaReviews(status: string): Promise<{
    id: number; mediaRef: string; mediaMime: string | null; senderUsername: string; reason: string; status: string; reporterUsername: string | null; createdAt: number;
  }[]> {
    return this.mediaReviews.filter((r) => r.status === status).slice(-100).reverse();
  }

  async setMediaReviewStatus(id: number, status: string, reviewedBy: string): Promise<void> {
    const r = this.mediaReviews.find((x) => x.id === id);
    if (r) r.status = status;
  }

  async getReports(limit = 100): Promise<{
    id: number; messageId: number; reporterId: number; reason: string; status: string; createdAt: number;
  }[]> {
    return this.reports.slice(-limit).reverse().map((r) => ({ ...r, status: "open" }));
  }

  async resolveReportsForMessage(messageId: number): Promise<void> {
    this.reports = this.reports.filter((r) => r.messageId !== messageId);
  }

  async createCallSession(id: string, caller: string, callee: string): Promise<void> {
    const now = Date.now();
    this.callSessions.set(id, { id, caller, callee, state: "ringing", offer: null, answer: null, createdAt: now, updatedAt: now });
  }

  async getCallSession(id: string): Promise<{
    id: string; caller: string; callee: string; state: string; offer: string | null; answer: string | null; createdAt: number; updatedAt: number;
  } | null> {
    return this.callSessions.get(id) ?? null;
  }

  async listActiveCallsFor(username: string): Promise<{
    id: string; caller: string; callee: string; state: string; offer: string | null; answer: string | null; createdAt: number; updatedAt: number;
  }[]> {
    return [...this.callSessions.values()]
      .filter((c) => (c.caller === username || c.callee === username) && c.state !== "ended")
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 10);
  }

  async updateCallOffer(id: string, offer: string): Promise<void> {
    const c = this.callSessions.get(id);
    if (c) {
      c.offer = offer;
      c.updatedAt = Date.now();
    }
  }

  async updateCallAnswer(id: string, answer: string, state = "active"): Promise<void> {
    const c = this.callSessions.get(id);
    if (c) {
      c.answer = answer;
      c.state = state;
      c.updatedAt = Date.now();
    }
  }

  async updateCallState(id: string, state: string): Promise<void> {
    const c = this.callSessions.get(id);
    if (c) {
      c.state = state;
      c.updatedAt = Date.now();
    }
  }

  async addCallCandidate(callId: string, fromUser: string, candidate: string): Promise<void> {
    const list = this.callCandidates.get(callId) ?? [];
    list.push({ id: this.nextCallCandidateId++, fromUser, candidate, createdAt: Date.now() });
    this.callCandidates.set(callId, list);
  }

  async listCallCandidates(callId: string, afterId?: number): Promise<{ id: number; fromUser: string; candidate: string }[]> {
    return (this.callCandidates.get(callId) ?? [])
      .filter((c) => c.id > (afterId ?? 0))
      .map((c) => ({ id: c.id, fromUser: c.fromUser, candidate: c.candidate }));
  }

  async deleteExpiredCalls(olderThan: number): Promise<void> {
    for (const [id, c] of this.callSessions) {
      if (c.state === "ended" && c.updatedAt < olderThan) this.callSessions.delete(id);
    }
  }

  /* ── typing indicators + read receipts ─────────────────────────────── */
  async setTyping(userId: number, room: string, peer: string, typing: boolean): Promise<void> {
    const key = `${userId}:${room}:${peer}`;
    if (typing) {
      const user = this.usersById.get(userId);
      this.typing.set(key, { updatedAt: Date.now(), username: user?.username ?? "?" });
    } else {
      this.typing.delete(key);
    }
    const cutoff = Date.now() - 10_000;
    for (const [k, v] of this.typing) {
      if (v.updatedAt < cutoff) this.typing.delete(k);
    }
  }

  async listTypers(room: string, peer: string, excludeUserId: number, since: number): Promise<string[]> {
    const out: string[] = [];
    for (const [key, v] of this.typing) {
      if (v.updatedAt <= since) continue;
      const [userIdStr, r, p] = key.split(":");
      const userId = Number(userIdStr);
      if (userId === excludeUserId || r !== room || p !== peer) continue;
      out.push(v.username);
    }
    return out.slice(0, 5);
  }

  async setReadReceipt(userId: number, room: string, peer: string, messageId: number): Promise<void> {
    this.readReceipts.set(`${userId}:${room}:${peer}`, { messageId, userId });
  }

  async listReadReceipts(room: string, peer: string, excludeUserId: number): Promise<{ username: string; userId: number; messageId: number }[]> {
    const out: { username: string; userId: number; messageId: number }[] = [];
    for (const [key, r] of this.readReceipts) {
      const [userIdStr, r2, p] = key.split(":");
      const userId = Number(userIdStr);
      if (userId === excludeUserId || r2 !== room || p !== peer) continue;
      const user = this.usersById.get(userId);
      if (user) out.push({ username: user.username, userId, messageId: r.messageId });
    }
    return out;
  }

  async getReadReceipt(userId: number, room: string, peer: string): Promise<number | null> {
    const r = this.readReceipts.get(`${userId}:${room}:${peer}`);
    return r ? r.messageId : null;
  }

  async countUnreadDm(me: string, peer: string, afterId: number): Promise<number> {
    return this.messages.filter(
      (m) => m.senderUsername === peer && m.recipientUsername === me && m.id > afterId
    ).length;
  }

  /* ── suspension appeals ────────────────────────────────────────────── */
  async createAppeal(input: { userId: number; username: string; reason: string }): Promise<boolean> {
    const user = this.usersById.get(input.userId);
    if (!user || !(user.bannedUntil && user.bannedUntil > Date.now())) return false;
    this.appeals.push({
      id: this.nextAppealId++,
      userId: input.userId,
      username: input.username,
      reason: input.reason,
      status: "pending",
      createdAt: Date.now(),
      decidedBy: null,
      decidedAt: null,
    });
    return true;
  }

  async listAppeals(status?: string): Promise<AppealRow[]> {
    const list = status ? this.appeals.filter((a) => a.status === status) : this.appeals;
    return [...list].reverse().slice(0, status ? 100 : 200);
  }

  async setAppealStatus(id: number, status: string, decidedBy: string): Promise<void> {
    const a = this.appeals.find((x) => x.id === id);
    if (a) {
      a.status = status;
      a.decidedBy = decidedBy;
      a.decidedAt = Date.now();
    }
  }

  async updateEmail(userId: number, email: string): Promise<void> {
    const user = this.usersById.get(userId);
    if (!user) return;
    this.usersByEmail.delete(user.email);
    user.email = email;
    this.usersByEmail.set(email, user);
  }

  async setMessagePrivacy(userId: number, privacy: MessagePrivacy): Promise<void> {
    const user = this.usersById.get(userId);
    if (user) user.messagePrivacy = privacy;
  }

  async setProfileKeys(
    userId: number,
    pubkey: string | null,
    timezone: string | null
  ): Promise<void> {
    const user = this.usersById.get(userId);
    if (user) {
      user.pubkey = pubkey;
      user.timezone = timezone;
    }
  }

  async setAvatar(userId: number, avatar: string | null): Promise<void> {
    const user = this.usersById.get(userId);
    if (user) user.avatar = avatar;
  }

  async setStatus(userId: number, status: string): Promise<void> {
    const user = this.usersById.get(userId);
    if (user) user.status = status;
  }

  async setLastSeen(userId: number): Promise<void> {
    const user = this.usersById.get(userId);
    if (user) user.lastSeenAt = Date.now();
  }

  async changeUsername(userId: number, newUsername: string): Promise<boolean> {
    const user = this.usersById.get(userId);
    if (!user) return false;
    if (this.usersByUsername.has(newUsername)) return false;
    const oldUsername = user.username;
    this.usersByUsername.delete(oldUsername);
    user.username = newUsername;
    this.usersByUsername.set(newUsername, user);
    // Keep chat history readable: rewrite sender/recipient columns too.
    for (const m of this.messages) {
      if (m.senderUsername === oldUsername) m.senderUsername = newUsername;
      if (m.recipientUsername === oldUsername) m.recipientUsername = newUsername;
    }
    return true;
  }

  private pushSubs = new Map<string, { userId: number; p256dh: string; auth: string }>();

  async savePushSubscription(
    userId: number,
    sub: { endpoint: string; p256dh: string; auth: string }
  ): Promise<void> {
    this.pushSubs.set(sub.endpoint, { userId, p256dh: sub.p256dh, auth: sub.auth });
  }

  async listPushSubscriptions(userId: number): Promise<{ endpoint: string; p256dh: string; auth: string }[]> {
    return [...this.pushSubs.entries()]
      .filter(([, v]) => v.userId === userId)
      .map(([endpoint, v]) => ({ endpoint, p256dh: v.p256dh, auth: v.auth }));
  }

  async removePushSubscription(endpoint: string): Promise<void> {
    this.pushSubs.delete(endpoint);
  }

  async getProfileByUsername(username: string): Promise<{
    username: string;
    avatar: string | null;
    timezone: string | null;
    status: string;
    lastSeenAt: number | null;
    createdAt: number;
  } | null> {
    const user = this.usersByUsername.get(username);
    if (!user) return null;
    return {
      username: user.username,
      avatar: user.avatar,
      timezone: user.timezone,
      status: user.status ?? "online",
      lastSeenAt: user.lastSeenAt ?? null,
      createdAt: user.createdAt,
    };
  }

  async getMessagesByIds(ids: number[]): Promise<MessageRow[]> {
    const wanted = new Set(ids);
    return this.messages.filter((m) => wanted.has(m.id));
  }

  async editMessage(messageId: number, userId: number, content: string): Promise<boolean> {
    const m = this.messages.find((x) => x.id === messageId);
    if (!m || m.senderId !== userId) return false;
    this.messageEdits.push({ messageId, oldContent: m.content, editedAt: Date.now() });
    m.content = content;
    m.editedAt = Date.now();
    return true;
  }

  async listMessageEdits(messageId: number): Promise<{ content: string; editedAt: number }[]> {
    return this.messageEdits
      .filter((e) => e.messageId === messageId)
      .sort((a, b) => a.editedAt - b.editedAt)
      .map((e) => ({ content: e.oldContent, editedAt: e.editedAt }));
  }

  async toggleReaction(
    messageId: number,
    userId: number,
    username: string,
    emoji: string
  ): Promise<"added" | "removed"> {
    if (!this.reactions.has(`${messageId}:${userId}:${emoji}`)) {
      this.reactions.set(`${messageId}:${userId}:${emoji}`, {
        messageId,
        userId,
        username,
        emoji,
        createdAt: Date.now(),
      });
      return "added";
    }
    this.reactions.delete(`${messageId}:${userId}:${emoji}`);
    return "removed";
  }

  async listReactions(
    messageIds: number[],
    userId: number
  ): Promise<{ messageId: number; emoji: string; count: number; mine: boolean }[]> {
    const wanted = new Set(messageIds);
    const byKey = new Map<string, { count: number; mine: boolean }>();
    for (const r of this.reactions.values()) {
      if (!wanted.has(r.messageId)) continue;
      const key = `${r.messageId}:${r.emoji}`;
      const e = byKey.get(key) ?? { count: 0, mine: false };
      e.count += 1;
      if (r.userId === userId) e.mine = true;
      byKey.set(key, e);
    }
    return [...byKey.entries()].map(([key, e]) => {
      const [messageId, emoji] = key.split(":");
      return { messageId: Number(messageId), emoji, count: e.count, mine: e.mine };
    });
  }

  async getMessagePrivacy(userId: number): Promise<MessagePrivacy> {
    return this.usersById.get(userId)?.messagePrivacy ?? "everyone";
  }

  async sendFriendRequest(fromId: number, toId: number): Promise<"sent" | "already" | "blocked"> {
    if (this.blocks.has(`${fromId}:${toId}`)) return "blocked";
    if (await this.areFriends(fromId, toId)) return "already";
    this.friendRows.set(`${fromId}:${toId}`, {
      user_id: fromId,
      friend_id: toId,
      status: "pending",
      created_at: Date.now(),
    });
    return "sent";
  }

  async respondFriendRequest(userId: number, fromId: number, accept: boolean): Promise<boolean> {
    const key = `${fromId}:${userId}`;
    const row = this.friendRows.get(key);
    if (!row || row.status !== "pending") return false;
    if (accept) {
      row.status = "accepted";
      this.friendRows.set(`${userId}:${fromId}`, {
        user_id: userId,
        friend_id: fromId,
        status: "accepted",
        created_at: Date.now(),
      });
    } else {
      this.friendRows.delete(key);
    }
    return true;
  }

  async removeFriend(userId: number, friendId: number): Promise<void> {
    this.friendRows.delete(`${userId}:${friendId}`);
    this.friendRows.delete(`${friendId}:${userId}`);
  }

  async listFriends(userId: number): Promise<{ id: number; username: string }[]> {
    const out: { id: number; username: string }[] = [];
    for (const row of this.friendRows.values()) {
      if (row.status !== "accepted") continue;
      if (row.user_id === userId) {
        const u = this.usersById.get(row.friend_id);
        if (u) out.push({ id: u.id, username: u.username });
      } else if (row.friend_id === userId) {
        const u = this.usersById.get(row.user_id);
        if (u) out.push({ id: u.id, username: u.username });
      }
    }
    out.sort((a, b) => a.username.localeCompare(b.username));
    return out;
  }

  async listFriendRequests(userId: number): Promise<{
    incoming: { id: number; username: string; createdAt: number }[];
    outgoing: { id: number; username: string; createdAt: number }[];
  }> {
    const incoming: { id: number; username: string; createdAt: number }[] = [];
    const outgoing: { id: number; username: string; createdAt: number }[] = [];
    for (const row of this.friendRows.values()) {
      if (row.status !== "pending") continue;
      if (row.friend_id === userId) {
        const u = this.usersById.get(row.user_id);
        if (u) incoming.push({ id: u.id, username: u.username, createdAt: row.created_at });
      } else if (row.user_id === userId) {
        const u = this.usersById.get(row.friend_id);
        if (u) outgoing.push({ id: u.id, username: u.username, createdAt: row.created_at });
      }
    }
    return { incoming, outgoing };
  }

  async areFriends(a: number, b: number): Promise<boolean> {
    const row = this.friendRows.get(`${a}:${b}`) ?? this.friendRows.get(`${b}:${a}`);
    return Boolean(row && row.status === "accepted");
  }

  async generateBackupCodes(userId: number, count = 10): Promise<string[]> {
    this.backupCodes = this.backupCodes.filter((c) => c.user_id !== userId);
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      const code = generateBackupCode();
      codes.push(code);
      this.backupCodes.push({
        id: this.nextBackupCodeId++,
        user_id: userId,
        code_hash: backupCodeHash(code),
        used: 0,
        created_at: Date.now(),
      });
    }
    return codes;
  }

  async listBackupCodes(userId: number): Promise<number> {
    return this.backupCodes.filter((c) => c.user_id === userId && c.used === 0).length;
  }

  async redeemBackupCode(userId: number, code: string): Promise<boolean> {
    const hash = backupCodeHash(code);
    const found = this.backupCodes.find((c) => c.user_id === userId && c.code_hash === hash && c.used === 0);
    if (!found) return false;
    found.used = 1;
    return true;
  }

  async addMessage(input: Omit<MessageRow, "id">): Promise<MessageRow> {
    const message: MessageRow = { ...input, id: this.nextMessageId++ };
    this.messages.push(message);
    return message;
  }

  private reactions = new Map<
    string,
    { messageId: number; userId: number; username: string; emoji: string; createdAt: number }
  >();
  private messageEdits: { messageId: number; oldContent: string; editedAt: number }[] = [];

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

  const store = db ? new D1AuthStore(db) : new MemoryAuthStore();
  await store.ensureSchema();
  // Only cache after a successful init: a failed migration must not leave a
  // poisoned store that skips schema repair on every later request.
  cachedStore = store;
  return cachedStore;
}
