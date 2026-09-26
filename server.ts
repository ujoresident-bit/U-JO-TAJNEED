import 'dotenv/config';
import express from "express";
import multer from "multer";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";

// Relaxed safety thresholds for legitimate clinical/medical education
// content classification tasks (topic tagging, explanation completion for
// board-review questions). Default Gemini safety thresholds are tuned for
// general consumer chat and can silently drop or refuse otherwise entirely
// appropriate medical questions that happen to touch on sensitive but
// clinically routine subjects — STIs, domestic violence screening,
// sexual/reproductive health, etc. — causing exactly the kind of "returned
// fewer results than requested, no error" behavior seen with OB/GYN
// question batches. BLOCK_ONLY_HIGH still blocks genuinely extreme content
// while allowing standard clinical vignette material through.
const MEDICAL_CONTENT_SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH }
];
import { getSupabase, isSupabaseConfigured } from "./src/services/supabaseServer.js";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '20mb' }));

  // Never let any intermediate layer (browser HTTP cache, Telegram's in-app
  // WebView, Render's edge/CDN) cache API responses. Without this, a GET like
  // /api/admin/users can be served stale after a mutating action (Approve/
  // Reject/Cancel/Activate) even on a hard/full page reload, because the
  // reload only guarantees a fresh index.html — it does not guarantee the
  // subsequent API calls bypass every caching layer in between.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  // API Health & Config endpoints
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      name: "U JO TAJNEED",
      bank: "Human Medicine & Dentistry Question Banks",
      supabaseConfigured: isSupabaseConfigured(),
      environmentDiagnostics: {
        supabaseUrlPresent: Boolean(process.env.SUPABASE_URL?.trim()),
        supabaseSecretKeyPresent: Boolean(process.env.SUPABASE_SECRET_KEY?.trim()),
        nodeEnvironment: process.env.NODE_ENV || "undefined"
      },
      timestamp: new Date().toISOString()
    });
  });

  // Supabase Database Connection Verification Endpoint
  app.get("/api/db/health", async (_req, res) => {
    if (!isSupabaseConfigured()) {
      return res.status(503).json({
        connected: false,
        error: "Supabase credentials not configured. Please set SUPABASE_URL and SUPABASE_SECRET_KEY environment variables."
      });
    }

    const supabase = getSupabase();
    if (!supabase) {
      return res.status(500).json({
        connected: false,
        error: "Failed to initialize Supabase client."
      });
    }

    try {
      // Test querying the questions table schema metadata without altering data
      const { data, error } = await supabase.from('questions').select('id').limit(1);
      if (error) {
        return res.status(500).json({
          connected: false,
          error: error.message
        });
      }

      return res.json({
        connected: true,
        message: "Successfully connected to Supabase database.",
        tablesVerified: ["users", "subscriptions", "questions", "question_progress", "blocks", "flashcards", "payments"]
      });
    } catch (err: any) {
      return res.status(500).json({
        connected: false,
        error: err.message || "Database connection test failed."
      });
    }
  });

  // Server-side admin allowlist configuration for role verification
  const ADMIN_ALLOWLIST_IDS = new Set(['111222333', '999888777', '123456789', '77889911', '6146527054']);
  const ADMIN_ALLOWLIST_USERNAMES = new Set(['ujoresident_admin', 'admin', 'ujoresident', 'ujo2025']);

  function getAdminTelegramIds(): string[] {
    const envIds = (process.env.ADMIN_TELEGRAM_IDS || process.env.ADMIN_TELEGRAM_ID || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);
    const combined = new Set([...Array.from(ADMIN_ALLOWLIST_IDS), ...envIds]);
    return Array.from(combined);
  }

  function getAdminUsernames(): string[] {
    const envUsernames = (process.env.ADMIN_USERNAMES || process.env.ADMIN_USERNAME || '')
      .split(',')
      .map(u => u.trim().replace(/^@+/, '').toLowerCase())
      .filter(Boolean);
    const combined = new Set([...Array.from(ADMIN_ALLOWLIST_USERNAMES), ...envUsernames]);
    return Array.from(combined);
  }

  function verifyServerAdminAuthorization(idOrUsername?: string | null): boolean {
    if (!idOrUsername) return false;
    const raw = String(idOrUsername).trim();
    const sanitized = raw.replace(/^@+/, '').toLowerCase();

    const adminIds = getAdminTelegramIds();
    const adminUsernames = getAdminUsernames();

    return adminIds.includes(raw) || adminUsernames.includes(sanitized);
  }

  async function getOrCreateSupabaseUser(telegramIdStr: string, usernameStr?: string | null, fullNameStr?: string | null) {
    const supabase = getSupabase();
    if (!supabase) return null;

    const rawTgIdStr = String(telegramIdStr || '').trim();
    if (!rawTgIdStr && !usernameStr) return null;

    const tgIdNum = /^\d+$/.test(rawTgIdStr)
      ? parseInt(rawTgIdStr, 10)
      : parseInt(rawTgIdStr.replace(/\D/g, '') || '88899901', 10);

    const tgUsername = usernameStr ? String(usernameStr).trim() : null;

    if (tgIdNum) {
      const { data: existingUser } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', tgIdNum)
        .maybeSingle();

      if (existingUser) return existingUser;
    }

    if (tgUsername) {
      const { data: existingByUsername } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_username', tgUsername)
        .maybeSingle();

      if (existingByUsername) return existingByUsername;
    }

    // Insert new user
    const isAuthorizedAdmin =
      verifyServerAdminAuthorization(rawTgIdStr) ||
      verifyServerAdminAuthorization(tgUsername);
    const userRole = isAuthorizedAdmin ? 'admin' : 'user';
    const now = new Date().toISOString();

    const { data: insertedUser, error: insertErr } = await supabase
      .from('users')
      .insert({
        telegram_id: tgIdNum || 88899901,
        telegram_username: tgUsername,
        full_name: fullNameStr || null,
        role: userRole,
        created_at: now,
        updated_at: now
      })
      .select()
      .single();

    if (insertErr) {
      console.error("Error in getOrCreateSupabaseUser:", insertErr.message);
      return null;
    }

    return insertedUser;
  }

  function evaluateSubscriptionRow(subRow: any): {
    isSubscribed: boolean;
    normalizedStatus: 'ACTIVE' | 'APPROVED' | 'CANCELLED' | 'EXPIRED' | 'INACTIVE' | 'PENDING';
    expiresAt: string | null;
  } {
    if (!subRow) {
      return { isSubscribed: false, normalizedStatus: 'INACTIVE', expiresAt: null };
    }

    const rawStatus = String(subRow.status || '').trim().toLowerCase();
    const expiresAt = subRow.expires_at || null;
    const expiresAtTime = expiresAt ? new Date(expiresAt).getTime() : 0;
    const isExpired = expiresAtTime > 0 && expiresAtTime <= Date.now();

    const isStatusActive = (rawStatus === 'active' || rawStatus === 'approved');
    const isSubscribed = isStatusActive && !isExpired;

    let normalizedStatus: 'ACTIVE' | 'APPROVED' | 'CANCELLED' | 'EXPIRED' | 'INACTIVE' | 'PENDING' = 'INACTIVE';

    if (isSubscribed) {
      normalizedStatus = 'ACTIVE';
    } else if (isExpired && isStatusActive) {
      normalizedStatus = 'EXPIRED';
    } else if (rawStatus === 'cancelled' || rawStatus === 'canceled') {
      normalizedStatus = 'CANCELLED';
    } else if (rawStatus === 'expired') {
      normalizedStatus = 'EXPIRED';
    } else if (rawStatus === 'pending') {
      normalizedStatus = 'PENDING';
    } else {
      normalizedStatus = 'INACTIVE';
    }

    return {
      isSubscribed,
      normalizedStatus,
      expiresAt
    };
  }

  /**
   * Schema-safe payment status update.
   * PART 14 requirement: never assume optional reviewer columns exist.
   * Tries the full update (including reviewed_by/reviewed_at) first. If the
   * database rejects it specifically because those columns don't exist
   * (Postgres: `column "reviewed_by" does not exist` / undefined_column 42703),
   * automatically retries with only the fields the schema is guaranteed to have.
   * Any other error (RLS, network, constraint) is returned as-is, unmodified,
   * so the real cause is never hidden.
   */
  async function updatePaymentReviewStatus(
    supabase: any,
    paymentId: string,
    statusValue: 'APPROVED' | 'REJECTED',
    reviewerUserId: string,
    userIdToLink?: string
  ): Promise<{ data: any; error: any; reviewerFieldsPersisted: boolean }> {
    const now = new Date().toISOString();

    const fullPayload: Record<string, any> = {
      status: statusValue,
      reviewed_by: reviewerUserId,
      reviewed_at: now,
      updated_at: now
    };
    if (userIdToLink) fullPayload.user_id = userIdToLink;

    const first = await supabase
      .from('payments')
      .update(fullPayload)
      .eq('id', paymentId)
      .select()
      .single();

    if (!first.error) {
      return { data: first.data, error: null, reviewerFieldsPersisted: true };
    }

    const msg = String(first.error.message || '').toLowerCase();
    const isMissingReviewerColumn =
      first.error.code === '42703' ||
      (msg.includes('column') && (msg.includes('reviewed_by') || msg.includes('reviewed_at')));

    if (!isMissingReviewerColumn) {
      // A different, real error (RLS, constraint, network) — surface it unmodified.
      return { data: null, error: first.error, reviewerFieldsPersisted: false };
    }

    console.warn(
      `[PAYMENT_REVIEW_SCHEMA_FALLBACK] paymentId=${paymentId} reason="${first.error.message}" — retrying update without reviewed_by/reviewed_at (schema does not support these columns).`
    );

    const reducedPayload: Record<string, any> = { status: statusValue, updated_at: now };
    if (userIdToLink) reducedPayload.user_id = userIdToLink;

    const second = await supabase
      .from('payments')
      .update(reducedPayload)
      .eq('id', paymentId)
      .select()
      .single();

    return { data: second.data, error: second.error, reviewerFieldsPersisted: false };
  }

  // Single-active-session enforcement: whenever a client claims a session
  // (via a fresh app load), it should become the ONLY session allowed to
  // access question content — any other still-open tab/device gets rejected
  // until it re-claims. A stale session (no activity for SESSION_TIMEOUT_MS)
  // is treated as abandoned and can be silently taken over, so a genuinely
  // closed old tab doesn't lock the user out forever.
  //
  // Schema-safe: if users.session_id / users.session_updated_at don't exist
  // yet, this fails open (never blocks access) and logs a warning — run the
  // migration below to actually enable enforcement:
  //
  //   alter table users add column if not exists session_id text;
  //   alter table users add column if not exists session_updated_at timestamptz;
  //
  const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes of inactivity = session considered abandoned

  // Lightweight behavioral monitoring: tracks how often each user creates
  // question blocks in a rolling window, purely to surface unusually
  // aggressive access patterns to the admin (e.g. an account being used to
  // bulk-scrape the question bank) rather than to block anything
  // automatically. In-memory only — resets on restart, which is acceptable
  // for a monitoring aid (unlike an access-control decision).
  const BEHAVIOR_WINDOW_MS = 60 * 60 * 1000; // 1 hour
  const BEHAVIOR_SUSPICIOUS_THRESHOLD = 15; // block-creation events per hour
  const blockActivityByUser = new Map<string, number[]>();

  function recordBlockActivity(userDbId: string): { count: number; suspicious: boolean } {
    const now = Date.now();
    const existing = blockActivityByUser.get(userDbId) || [];
    const recent = existing.filter((t) => now - t < BEHAVIOR_WINDOW_MS);
    recent.push(now);
    blockActivityByUser.set(userDbId, recent);
    const suspicious = recent.length > BEHAVIOR_SUSPICIOUS_THRESHOLD;
    if (suspicious) {
      console.log(`[BEHAVIOR_MONITOR] userDbId=${userDbId} created ${recent.length} blocks in the last hour (threshold=${BEHAVIOR_SUSPICIOUS_THRESHOLD}) — possible bulk extraction.`);
    }
    return { count: recent.length, suspicious };
  }

  const MAX_CONCURRENT_SESSIONS = 2;

  async function checkAndRegisterSession(userDbId: string, incomingSessionId: string | null): Promise<{ ok: boolean; reason?: string }> {
    const supabase = getSupabase();
    if (!supabase || !userDbId || !incomingSessionId) {
      return { ok: true }; // Fail open: no session id sent (older client) — don't block.
    }

    const { data: userRow, error: selectErr } = await supabase
      .from('users')
      .select('session_id')
      .eq('id', userDbId)
      .maybeSingle();

    if (selectErr) {
      if (selectErr.code === '42703') {
        console.warn('[SESSION_GUARD] users.session_id column not found — session limiting is disabled until the migration is applied.');
        return { ok: true };
      }
      console.error(`[SESSION_GUARD] Failed to read session state for userDbId=${userDbId}: ${selectErr.message}`);
      return { ok: true }; // Fail open on unexpected errors — never block legitimate access due to an infra hiccup.
    }

    // Sessions are stored as a JSON array of {id, updatedAt} in the same
    // session_id text column (no extra migration needed to raise the limit
    // from 1 to N later). Anything unparsable (empty, legacy plain string
    // from before this change) is treated as "no active sessions".
    let activeSessions: { id: string; updatedAt: number }[] = [];
    try {
      const raw = userRow?.session_id;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) activeSessions = parsed;
      }
    } catch {
      activeSessions = [];
    }

    const now = Date.now();
    // Drop stale entries (no activity for SESSION_TIMEOUT_MS) — an
    // abandoned old tab/device shouldn't permanently occupy a slot.
    activeSessions = activeSessions.filter((s) => now - s.updatedAt < SESSION_TIMEOUT_MS);

    const existingIdx = activeSessions.findIndex((s) => s.id === incomingSessionId);
    if (existingIdx === -1 && activeSessions.length >= MAX_CONCURRENT_SESSIONS) {
      console.log(`[SESSION_GUARD] Rejected session for userDbId=${userDbId} — ${activeSessions.length} active sessions already (limit=${MAX_CONCURRENT_SESSIONS}).`);
      return {
        ok: false,
        reason: `يبدو أنك تستخدم حسابك من ${MAX_CONCURRENT_SESSIONS} أجهزة أخرى حالياً. أغلق إحدى الجلسات وأعد المحاولة.`
      };
    }

    if (existingIdx >= 0) {
      activeSessions[existingIdx].updatedAt = now;
    } else {
      activeSessions.push({ id: incomingSessionId, updatedAt: now });
    }

    const { error: updateErr } = await supabase
      .from('users')
      .update({ session_id: JSON.stringify(activeSessions), session_updated_at: new Date().toISOString() })
      .eq('id', userDbId);

    if (updateErr && updateErr.code !== '42703') {
      console.error(`[SESSION_GUARD] Failed to register session for userDbId=${userDbId}: ${updateErr.message}`);
    }

    return { ok: true };
  }

  // --- User profile (full name + phone) validation & save ---
  // Requirement: reject obvious junk ("test", "aaa", digits-only, the literal
  // web_resident_01 fallback identity) without being so strict that real
  // English names get rejected. At least two space-separated alphabetic
  // words is the bar.
  function validateFullName(raw: string): { valid: boolean; value?: string; reason?: string } {
    const trimmed = (raw || '').trim().replace(/\s+/g, ' ');
    if (trimmed.length < 4) return { valid: false, reason: 'الاسم قصير جداً.' };

    const junkPatterns = /^(test|aaa+|asd+|qwe+|xxx+|123+|web_resident_01|admin|resident)$/i;
    const words = trimmed.split(' ');
    if (words.length < 2) return { valid: false, reason: 'الرجاء إرسال الاسم الثلاثي كاملاً.' };
    if (junkPatterns.test(trimmed.replace(/\s+/g, ''))) return { valid: false, reason: 'الاسم غير واضح.' };
    if (!/^[A-Za-z\s.'-]+$/.test(trimmed)) return { valid: false, reason: 'الرجاء إرسال الاسم بالأحرف الإنجليزية فقط.' };
    if (words.some((w) => w.length < 2)) return { valid: false, reason: 'الاسم غير واضح.' };

    return { valid: true, value: trimmed };
  }

  // Normalizes common Jordanian mobile number formats to +962XXXXXXXXX.
  // Lenient: any 8-9 digit local number, +962/00962-prefixed, is accepted
  // rather than rejecting anything not exactly matching one template.
  // STRICT per product requirement: the phone number must already be
  // provided in full international format (+962XXXXXXXXX) — this function
  // no longer silently converts a local "07..." input to "+962...". A
  // number missing the +962 prefix is now rejected outright so the bot can
  // ask the user to resend it in the correct format, rather than guessing
  // and potentially storing an incorrectly-normalized value.
  // Validates a Jordanian mobile number in the local "07XXXXXXXX" format
  // (10 digits total, starting with 07) — per explicit product
  // requirement, NOT the +962 international format.
  function validatePhoneNumber(raw: string): { valid: boolean; value?: string; reason?: string } {
    const trimmed = (raw || '').trim().replace(/[\s\-]/g, '');

    if (!/^07\d{8}$/.test(trimmed)) {
      return { valid: false, reason: 'رقم الهاتف غير صحيح. يرجى إرسال رقم أردني صحيح يبدأ بـ 07 ومكوّن من 10 أرقام، مثال: 0798813251' };
    }

    return { valid: true, value: trimmed };
  }

  function validateEmail(raw: string): { valid: boolean; value?: string; reason?: string } {
    const trimmed = (raw || '').trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return { valid: false, reason: 'صيغة البريد الإلكتروني غير صحيحة. مثال: name@example.com' };
    }

    const junkEmails = new Set(['test@test.com', 'a@a.com', 'admin@admin.com', 'example@example.com']);
    if (junkEmails.has(trimmed)) {
      return { valid: false, reason: 'يرجى إرسال بريدك الإلكتروني الحقيقي.' };
    }

    return { valid: true, value: trimmed };
  }

  // Schema-safe write, same defensive pattern as updatePaymentReviewStatus /
  // is_active above: if users.email doesn't exist yet, retry without it and
  // log clearly rather than hard-failing the whole save.
  //
  // Supports PARTIAL updates — either field may be omitted (undefined) so
  // the bot can save "just the name" or "just the email" when they arrive
  // as separate messages, without requiring both at once.
  async function saveUserProfile(userDbId: string, fullName?: string, email?: string, phoneNumber?: string): Promise<{ ok: boolean; persisted: boolean; error?: string }> {
    const supabase = getSupabase();
    if (!supabase || !userDbId) return { ok: false, persisted: false, error: 'Supabase not configured.' };
    if (!fullName && !email && !phoneNumber) return { ok: false, persisted: false, error: 'Nothing to save.' };

    const fullPayload: Record<string, any> = { updated_at: new Date().toISOString() };
    if (fullName !== undefined) fullPayload.full_name = fullName;
    if (email !== undefined) fullPayload.email = email;
    if (phoneNumber !== undefined) fullPayload.phone_number = phoneNumber;

    const { error } = await supabase
      .from('users')
      .update(fullPayload)
      .eq('id', userDbId);

    if (!error) return { ok: true, persisted: true };

    if (error.code === '42703') {
      // One of the newer columns (email or phone_number) doesn't exist yet
      // in this database — retry with only the columns that are known to
      // exist, so the admin isn't blocked while a migration is pending.
      console.warn('[PROFILE_SAVE] A profile column was not found — retrying with a reduced payload until the migration is applied.');
      const reducedPayload: Record<string, any> = { updated_at: new Date().toISOString() };
      if (fullName !== undefined) reducedPayload.full_name = fullName;
      const retry = await supabase
        .from('users')
        .update(reducedPayload)
        .eq('id', userDbId);
      if (!retry.error) return { ok: true, persisted: false };
      return { ok: false, persisted: false, error: retry.error.message };
    }

    console.error(`[PROFILE_SAVE] Failed to save profile for userDbId=${userDbId}: ${error.message}`);
    return { ok: false, persisted: false, error: error.message };
  }

  async function resolveAuthoritativeUserSubscription(userDbId: string, bankId: string) {
    const supabase = getSupabase();
    if (!supabase || !userDbId || !bankId) return { isSubscribed: false, normalizedStatus: 'INACTIVE' as const, subscription: null };

    // ROOT CAUSE FIX: this previously ignored bankId entirely and just
    // returned the user's single most recent subscription row across ALL
    // banks — correct for U JO TAJNEED's "one subscription unlocks
    // everything" model, but wrong here where Human Medicine and
    // Dentistry each require their own separate subscription/payment.
    const { data: subRow, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userDbId)
      .eq('bank_id', bankId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(`[SUB_AUTH_ERROR] userDbId=${userDbId} bankId=${bankId} error=${error.message}`);
      throw error;
    }

    const evaluation = evaluateSubscriptionRow(subRow);
    console.log(`[SUB_AUTH] userDbId=${userDbId} bankId=${bankId} status=${evaluation.normalizedStatus} expiresAt=${evaluation.expiresAt || 'N/A'} subscribed=${evaluation.isSubscribed}`);

    return {
      ...evaluation,
      subscription: subRow || null
    };
  }

  // Phase 1: User Sync Endpoint (Syncs Telegram user session to Supabase 'users' table)
  app.post("/api/users/sync", async (req, res) => {
    try {
      const { telegramId, username, firstName, lastName, bankId } = req.body;
      if (!telegramId) {
        return res.status(400).json({ error: "telegramId is required." });
      }

      const rawTgIdStr = String(telegramId).trim();
      const tgIdNum = /^\d+$/.test(rawTgIdStr)
        ? parseInt(rawTgIdStr, 10)
        : parseInt(rawTgIdStr.replace(/\D/g, '') || '88899901', 10);

      const tgUsername = username ? String(username).trim() : null;
      
      // SERVER-SIDE SECURITY GUARD: Role is determined exclusively by server-side allowlist.
      // Unprivileged client requests cannot manipulate role to 'admin'.
      const isAuthorizedAdmin =
        verifyServerAdminAuthorization(rawTgIdStr) ||
        verifyServerAdminAuthorization(tgUsername);
      const userRole = isAuthorizedAdmin ? 'admin' : 'user';

      const supabase = getSupabase();
      if (!supabase) {
        return res.json({
          synced: false,
          user: { telegramId, username: tgUsername, role: userRole },
          note: "Supabase client not configured on server."
        });
      }

      const fullNameStr = [firstName, lastName].filter(Boolean).join(' ').trim() || null;
      const now = new Date().toISOString();

      // Check if user already exists in Supabase
      const { data: existingUser, error: selectErr } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', tgIdNum)
        .maybeSingle();

      if (selectErr) {
        console.error("Error querying Supabase users table:", selectErr.message);
        return res.status(500).json({ error: selectErr.message });
      }

      let dbUser = null;
      if (existingUser) {
        if (!isUserAccountActive(existingUser)) {
          return res.status(403).json({
            success: false,
            code: "ACCOUNT_INACTIVE",
            message: "Your account is inactive."
          });
        }

        // Update existing user
        const { data: updated, error: updateErr } = await supabase
          .from('users')
          .update({
            telegram_username: tgUsername || existingUser.telegram_username,
            full_name: fullNameStr || existingUser.full_name,
            role: userRole,
            updated_at: now
          })
          .eq('id', existingUser.id)
          .select()
          .single();

        if (updateErr) {
          console.error("Error updating user in Supabase:", updateErr.message);
          return res.status(500).json({ error: updateErr.message });
        }
        dbUser = updated;
      } else {
        // Insert new user
        const { data: inserted, error: insertErr } = await supabase
          .from('users')
          .insert({
            telegram_id: tgIdNum,
            telegram_username: tgUsername,
            full_name: fullNameStr,
            role: userRole,
            created_at: now,
            updated_at: now
          })
          .select()
          .single();

        if (insertErr) {
          console.error("Error inserting user into Supabase:", insertErr.message);
          return res.status(500).json({ error: insertErr.message });
        }
        dbUser = inserted;
      }

      // Per-bank subscriptions: without a specific bankId, report status for
      // EVERY bank so the frontend can decide access per-bank rather than
      // getting one ambiguous "subscribed" boolean that could mean either.
      let subAuth: any;
      let subscriptionsByBank: Record<string, any> | undefined;

      if (dbUser?.id) {
        if (bankId) {
          subAuth = await resolveAuthoritativeUserSubscription(dbUser.id, String(bankId));
        } else {
          const [humanMed, dent] = await Promise.all([
            resolveAuthoritativeUserSubscription(dbUser.id, 'human_medicine'),
            resolveAuthoritativeUserSubscription(dbUser.id, 'dentistry')
          ]);
          subscriptionsByBank = { human_medicine: humanMed, dentistry: dent };
          // Backward-compatible top-level fields reflect whichever bank (if
          // any) is currently subscribed, so older callers that only check
          // `subscribed` still get a sensible answer.
          subAuth = humanMed.isSubscribed ? humanMed : dent;
        }
      } else {
        subAuth = { isSubscribed: false, normalizedStatus: 'INACTIVE' as const, subscription: null };
      }

      return res.json({
        synced: true,
        user: dbUser,
        subscribed: subAuth.isSubscribed,
        status: subAuth.normalizedStatus,
        subscription: subAuth.subscription,
        ...(subscriptionsByBank ? { subscriptionsByBank } : {})
      });
    } catch (err: any) {
      console.error("Error in /api/users/sync:", err);
      return res.status(500).json({ error: err.message || "Failed to sync user." });
    }
  });

  // GET /api/users/me - returns the canonical authenticated user's own
  // profile (full name, phone number if set). Used by the client-side
  // watermark and any profile-completion UI. Never trusts a frontend-
  // supplied user ID — identity is resolved server-side from the Telegram
  // identity headers, same as every other authenticated endpoint.
  app.get("/api/users/me", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      if (!userRow) {
        return res.status(404).json({ error: "User not found." });
      }

      return res.json({
        telegramId: String(userRow.telegram_id || requesterId || ''),
        fullName: userRow.full_name || null,
        email: userRow.email || null
      });
    } catch (err: any) {
      console.error("Error in GET /api/users/me:", err);
      return res.status(500).json({ error: err.message || "Failed to fetch profile." });
    }
  });

  // POST /api/users/profile - saves full name + email for the canonical
  // authenticated user (called by the Telegram bot after it collects this
  // from the user post-approval). Validates both fields server-side
  // (defense in depth even though the bot already validates before calling
  // this). Never changes subscription state — a failed profile save has no
  // effect on ACTIVE status, per the requirement that this stays strictly
  // isolated from the approval flow.
  app.post("/api/users/profile", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.body?.telegramId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.body?.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const { fullName, email, phoneNumber } = req.body || {};
      if (!fullName && !email && !phoneNumber) {
        return res.status(400).json({ error: "At least one of fullName, email, or phoneNumber is required." });
      }

      let validatedName: string | undefined;
      let validatedEmail: string | undefined;
      let validatedPhone: string | undefined;

      if (fullName !== undefined) {
        const nameCheck = validateFullName(String(fullName));
        if (!nameCheck.valid) {
          return res.status(400).json({ error: nameCheck.reason, field: 'fullName' });
        }
        validatedName = nameCheck.value;
      }

      if (email !== undefined) {
        const emailCheck = validateEmail(String(email));
        if (!emailCheck.valid) {
          return res.status(400).json({ error: emailCheck.reason, field: 'email' });
        }
        validatedEmail = emailCheck.value;
      }

      if (phoneNumber !== undefined) {
        const phoneCheck = validatePhoneNumber(String(phoneNumber));
        if (!phoneCheck.valid) {
          return res.status(400).json({ error: phoneCheck.reason, field: 'phoneNumber' });
        }
        validatedPhone = phoneCheck.value;
      }

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      if (!userRow || !userRow.id) {
        return res.status(500).json({ error: "Failed to resolve user account." });
      }

      const saveResult = await saveUserProfile(userRow.id, validatedName, validatedEmail, validatedPhone);
      if (!saveResult.ok) {
        return res.status(500).json({ error: saveResult.error || "Failed to save profile." });
      }

      return res.json({
        success: true,
        fullName: validatedName,
        email: validatedEmail,
        persisted: saveResult.persisted
      });
    } catch (err: any) {
      console.error("Error in POST /api/users/profile:", err);
      return res.status(500).json({ error: err.message || "Failed to save profile." });
    }
  });

  // GET User Reset Count
  app.get("/api/user/reset-count", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      if (!userRow) {
        return res.json({ resetCount: 0, maxResets: 3 });
      }

      const resetCount = Number(userRow.reset_count || 0);
      return res.json({ resetCount, maxResets: 3 });
    } catch (err: any) {
      console.error("Error in GET /api/user/reset-count:", err);
      return res.status(500).json({ error: err.message || "Failed to fetch reset count." });
    }
  });

  // POST Reset User Question Bank Progress
  app.post("/api/user/reset-progress", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || req.body?.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || req.body?.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const supabase = getSupabase();
      if (!supabase) {
        return res.status(500).json({ error: "Supabase client not configured on server." });
      }

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      if (!userRow || !userRow.id) {
        return res.status(500).json({ error: "Failed to resolve Supabase user record." });
      }

      const currentCount = Number(userRow.reset_count || 0);
      if (currentCount >= 3) {
        return res.status(400).json({
          error: "Reset limit reached. You have used all 3 available resets.",
          resetCount: currentCount,
          maxResets: 3
        });
      }

      const userDbId = userRow.id;
      const tgIdStr = String(userRow.telegram_id || requesterId);

      // Delete blocks and question progress in Supabase for this user (using UUID)
      await supabase.from('blocks').delete().eq('user_id', userDbId);
      await supabase.from('question_progress').delete().eq('user_id', userDbId);

      // Increment reset_count
      const newResetCount = currentCount + 1;
      const now = new Date().toISOString();

      const { error: updateErr } = await supabase
        .from('users')
        .update({
          reset_count: newResetCount,
          updated_at: now
        })
        .eq('id', userDbId);

      if (updateErr) {
        console.warn("Notice updating reset_count on Supabase users table:", updateErr.message);
      }

      return res.json({
        success: true,
        resetCount: newResetCount,
        maxResets: 3,
        message: "Question bank progress reset successfully."
      });
    } catch (err: any) {
      console.error("Error in POST /api/user/reset-progress:", err);
      return res.status(500).json({ error: err.message || "Failed to reset progress." });
    }
  });

  // Get users endpoint (from Supabase users table) - STRICTLY RESTRICTED TO AUTHORIZED ADMINS
  app.get("/api/users", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;

      const isAuthorizedAdmin =
        verifyServerAdminAuthorization(requesterId) ||
        verifyServerAdminAuthorization(requesterUsername);

      if (!isAuthorizedAdmin) {
        return res.status(403).json({ error: "Access denied: Administrator authorization required." });
      }

      const supabase = getSupabase();
      if (!supabase) {
        return res.json({ users: [] });
      }

      const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: false });
      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.json({ users: data || [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Phase 2: Questions API Endpoint
  app.get("/api/questions", async (req, res) => {
    try {
      const supabase = getSupabase();
      if (!supabase) {
        return res.json({
          source: 'none',
          total: 0,
          page: 1,
          limit: 200,
          questions: [],
          note: "Supabase client not configured."
        });
      }

      const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
      const limit = Math.min(1000, Math.max(1, parseInt((req.query.limit as string) || '200', 10)));
      const offset = (page - 1) * limit;

      const major = req.query.major as string | undefined;
      const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;

      let query = supabase.from('questions').select('*', { count: 'exact' });

      if (major && major !== 'All') {
        query = query.eq('major', major);
      }
      if (year && !isNaN(year)) {
        query = query.eq('year', year);
      }

      const { data, error, count } = await query
        .range(offset, offset + limit - 1)
        .order('id', { ascending: true });

      if (error) {
        console.error("Error fetching questions from Supabase:", error.message);
        return res.status(500).json({ error: error.message });
      }

      // Map Supabase rows to frontend Question model structure
      const mappedQuestions = (data || []).map((q: any) => {
        let options = q.options;
        if (typeof options === 'string') {
          try {
            options = JSON.parse(options);
          } catch (e) {
            options = null;
          }
        }
        if (!options || typeof options !== 'object') {
          options = {
            A: q.option_a || q.optionA || '',
            B: q.option_b || q.optionB || ''
          };
          // C, D, and E are all optional now — only added to the returned
          // options object when the question actually has them, so a
          // 2 or 3-option question is never padded with empty fake choices.
          const cVal = q.option_c || q.optionC;
          const dVal = q.option_d || q.optionD;
          const eVal = q.option_e || q.optionE;
          if (cVal) options.C = cVal;
          if (dVal) options.D = dVal;
          if (eVal) options.E = eVal;
        }

        let optionExplanations = q.option_explanations || q.optionExplanations;
        if (typeof optionExplanations === 'string') {
          try {
            optionExplanations = JSON.parse(optionExplanations);
          } catch (e) {
            optionExplanations = undefined;
          }
        }

        return {
          id: String(q.id),
          bankId: q.bank_id || q.bankId || 'human_medicine',
          question: q.question || q.stem || '',
          options,
          correctAnswer: (q.correct_answer || q.correctAnswer || 'A') as 'A' | 'B' | 'C' | 'D',
          explanation: q.explanation || '',
          optionExplanations,
          needsReview: Boolean(q.needs_review ?? q.needsReview ?? false),
          reviewNote: q.review_note || q.reviewNote || '',
          major: q.major || 'General',
          topic: q.topic || '',
          // ROOT CAUSE FIX: previously always forced year to a number here,
          // which would corrupt 'TAJNEED'/'MADANI' string category labels
          // back into NaN/2025 on every fetch, even though they were
          // stored correctly — this is the exact fetch path the whole
          // app reads questions through.
          year: (typeof q.year === 'string' && isNaN(Number(q.year))) ? q.year : Number(q.year || 2025),
          isMostCommon: Boolean(q.is_most_common ?? q.isMostCommon ?? false),
          difficulty: q.difficulty || 'Medium',
          classificationStatus: q.classification_status || q.classificationStatus || 'CLASSIFIED',
          createdAt: q.created_at || q.createdAt,
          updatedAt: q.updated_at || q.updatedAt
        };
      });

      return res.json({
        source: 'supabase',
        total: count || 0,
        page,
        limit,
        questions: mappedQuestions
      });
    } catch (err: any) {
      console.error("Error in GET /api/questions:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  // Create Single Question Endpoint (Admin Only)
  app.post("/api/questions", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || req.body?.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || req.body?.username || '') as string;

      const isAuthorizedAdmin =
        verifyServerAdminAuthorization(requesterId) ||
        verifyServerAdminAuthorization(requesterUsername);

      if (!isAuthorizedAdmin) {
        return res.status(403).json({ error: "Access denied: Administrator privileges required." });
      }

      const qObj = req.body;
      if (!qObj || !qObj.id || !qObj.question) {
        return res.status(400).json({ error: "Question ID and stem text are required." });
      }

      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: "Supabase client not configured." });

      const opts = qObj.options || {};
      let optExps = qObj.optionExplanations || qObj.option_explanations;
      if (optExps && typeof optExps === 'object') {
        optExps = JSON.stringify(optExps);
      }

      const row = {
        id: String(qObj.id).trim(),
        question: String(qObj.question).trim(),
        option_a: String(opts.A || '').trim(),
        option_b: String(opts.B || '').trim(),
        option_c: String(opts.C || '').trim(),
        option_d: String(opts.D || '').trim(),
        option_e: opts.E ? String(opts.E).trim() : null,
        correct_answer: String(qObj.correctAnswer || 'A').toUpperCase().trim(),
        explanation: String(qObj.explanation || '').trim(),
        option_explanations: optExps || null,
        needs_review: Boolean(qObj.needsReview ?? false),
        review_note: qObj.reviewNote || null,
        major: qObj.major ? String(qObj.major).trim() : 'General Medical Sciences',
        topic: qObj.topic ? String(qObj.topic).trim() : 'Unassigned Topic',
        // ROOT CAUSE FIX: previously always forced year to a number, which
        // would silently strip the 'TAJNEED'/'MADANI' text label off any
        // question under those categories. Preserve string category
        // labels; only default to numeric 2025 when year is absent.
        year: (typeof qObj.year === 'string' && isNaN(Number(qObj.year))) ? qObj.year : Number(qObj.year || 2025),
        is_most_common: Boolean(qObj.isMostCommon ?? qObj.is_most_common ?? false)
      };

      const { data, error } = await supabase.from('questions').upsert([row], { onConflict: 'id' }).select();
      if (error) {
        console.error("Error creating question in Supabase:", error.message);
        return res.status(500).json({ error: error.message });
      }

      return res.json({ success: true, question: data?.[0] || row });
    } catch (err: any) {
      console.error("Error in POST /api/questions:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  // Update Single Question Endpoint (Admin Only)
  app.put("/api/questions/:id", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || req.body?.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || req.body?.username || '') as string;

      const isAuthorizedAdmin =
        verifyServerAdminAuthorization(requesterId) ||
        verifyServerAdminAuthorization(requesterUsername);

      if (!isAuthorizedAdmin) {
        return res.status(403).json({ error: "Access denied: Administrator privileges required." });
      }

      const qId = req.params.id;
      const qObj = req.body;

      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: "Supabase client not configured." });

      const opts = qObj.options || {};
      let optExps = qObj.optionExplanations || qObj.option_explanations;
      if (optExps && typeof optExps === 'object') {
        optExps = JSON.stringify(optExps);
      }

      const row = {
        id: qId,
        question: String(qObj.question).trim(),
        option_a: String(opts.A || '').trim(),
        option_b: String(opts.B || '').trim(),
        option_c: String(opts.C || '').trim(),
        option_d: String(opts.D || '').trim(),
        option_e: opts.E ? String(opts.E).trim() : null,
        correct_answer: String(qObj.correctAnswer || 'A').toUpperCase().trim(),
        explanation: String(qObj.explanation || '').trim(),
        option_explanations: optExps || null,
        needs_review: Boolean(qObj.needsReview ?? false),
        review_note: qObj.reviewNote || null,
        major: qObj.major ? String(qObj.major).trim() : 'General Medical Sciences',
        topic: qObj.topic ? String(qObj.topic).trim() : 'Unassigned Topic',
        // ROOT CAUSE FIX: previously always forced year to a number, which
        // would silently strip the 'TAJNEED'/'MADANI' text label off any
        // question under those categories. Preserve string category
        // labels; only default to numeric 2025 when year is absent.
        year: (typeof qObj.year === 'string' && isNaN(Number(qObj.year))) ? qObj.year : Number(qObj.year || 2025),
        is_most_common: Boolean(qObj.isMostCommon ?? qObj.is_most_common ?? false)
      };

      const { data, error } = await supabase.from('questions').upsert([row], { onConflict: 'id' }).select();
      if (error) {
        console.error("Error updating question in Supabase:", error.message);
        return res.status(500).json({ error: error.message });
      }

      return res.json({ success: true, question: data?.[0] || row });
    } catch (err: any) {
      console.error("Error in PUT /api/questions/:id:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  // Delete Single Question Endpoint (Admin Only)
  app.delete("/api/questions/:id", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || req.body?.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || req.body?.username || '') as string;

      const isAuthorizedAdmin =
        verifyServerAdminAuthorization(requesterId) ||
        verifyServerAdminAuthorization(requesterUsername);

      if (!isAuthorizedAdmin) {
        return res.status(403).json({ error: "Access denied: Administrator privileges required." });
      }

      const qId = req.params.id;
      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: "Supabase client not configured." });

      const { error } = await supabase.from('questions').delete().eq('id', qId);
      if (error) {
        console.error("Error deleting single question from Supabase:", error.message);
        return res.status(500).json({ error: error.message });
      }

      return res.json({ success: true, deletedId: qId });
    } catch (err: any) {
      console.error("Error in DELETE /api/questions/:id:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  // Admin-Only: Delete All Questions Endpoint
  const handleDeleteAllQuestions = async (req: express.Request, res: express.Response) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || req.body?.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || req.body?.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const supabase = getSupabase();
      if (!supabase) {
        return res.status(500).json({ error: "Supabase client not configured." });
      }

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      const isAuthorizedAdmin =
        (userRow && userRow.role === 'admin') ||
        verifyServerAdminAuthorization(requesterId) ||
        verifyServerAdminAuthorization(requesterUsername);

      if (!isAuthorizedAdmin) {
        return res.status(403).json({ error: "Access denied: Administrator privileges required." });
      }

      // Delete associated metadata records (question_progress) first to prevent orphaned progress rows
      try {
        await supabase.from('question_progress').delete().not('id', 'is', null);
      } catch (err: any) {
        console.warn("Notice: Deleting question_progress encountered warning:", err.message);
      }

      // Delete all question records from questions table
      const { error: deleteError, count } = await supabase
        .from('questions')
        .delete({ count: 'exact' })
        .not('id', 'is', null);

      if (deleteError) {
        console.error("Error deleting all questions from Supabase:", deleteError.message);
        return res.status(500).json({ error: deleteError.message || "Failed to delete questions from database." });
      }

      return res.json({
        success: true,
        message: "تم حذف جميع الأسئلة بنجاح.",
        deletedCount: count || 0
      });
    } catch (err: any) {
      console.error("Error in DELETE /api/questions:", err);
      return res.status(500).json({ error: err.message || "Server error while deleting questions." });
    }
  };

  app.delete("/api/questions", handleDeleteAllQuestions);
  app.delete("/api/admin/questions", handleDeleteAllQuestions);

  // Phase 2 Preparation: Admin-Only Question Import API Endpoint (with Dry-Run support)
  app.post("/api/questions/import", async (req, res) => {
    try {
      // 1. Strict Server-Side Admin Authorization
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || req.body?.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || req.body?.username || '') as string;

      const isAuthorizedAdmin =
        verifyServerAdminAuthorization(requesterId) ||
        verifyServerAdminAuthorization(requesterUsername);

      if (!isAuthorizedAdmin) {
        return res.status(403).json({ error: "Access denied: Administrator authorization required." });
      }

      // Default dryRun to true unless explicitly set to false
      const dryRun = req.query.dryRun !== 'false' && req.body?.dryRun !== false;

      // 2. Parse batch payload
      let rawQuestions: any[] = [];
      const body = req.body || {};
      if (Array.isArray(body)) {
        rawQuestions = body;
      } else if (Array.isArray(body.questions)) {
        rawQuestions = body.questions;
      } else {
        return res.status(400).json({
          error: "Invalid payload: Body must be an array of questions or an object with a 'questions' array field."
        });
      }

      const totalInBatch = rawQuestions.length;
      const validQuestions: any[] = [];
      const invalidQuestions: Array<{ index: number; id?: string; reasons: string[] }> = [];
      const batchSeenIds = new Set<string>();
      const duplicateInBatchIds = new Set<string>();

      // Import strategy — read explicitly from the request, defaulting to
      // 'import_as_new'. ROOT CAUSE FIX: this field previously did not
      // exist at all on the server; every import silently ran an
      // unconditional upsert(onConflict:'id') regardless of what the admin
      // selected in the UI ("Skip Duplicates" had zero effect server-side).
      // 'import_as_new' is the new safe default: a colliding ID never
      // overwrites the existing row — the INCOMING question gets a freshly
      // generated unique ID and is inserted as a separate record, exactly
      // matching the requested append-only behavior.
      const strategy = (req.body?.strategy || req.body?.duplicateAction || 'import_as_new') as
        | 'skip'
        | 'overwrite'
        | 'import_as_new';

      // 3. Batch Validation
      rawQuestions.forEach((qObj, idx) => {
        const reasons: string[] = [];
        if (!qObj || typeof qObj !== 'object') {
          invalidQuestions.push({ index: idx + 1, reasons: ['Entry is not a valid JSON object'] });
          return;
        }

        const qId = qObj.id ? String(qObj.id).trim() : undefined;
        if (!qId) {
          reasons.push('Missing required question ID');
        }

        const questionText = qObj.question || qObj.questionText || qObj.stem;
        if (!questionText || typeof questionText !== 'string' || !questionText.trim()) {
          reasons.push('Missing question stem/text');
        }

        let opts = qObj.options;
        if (!opts || typeof opts !== 'object') {
          opts = {
            A: qObj.option_a || qObj.optionA,
            B: qObj.option_b || qObj.optionB,
            C: qObj.option_c || qObj.optionC,
            D: qObj.option_d || qObj.optionD,
            E: qObj.option_e || qObj.optionE
          };
        }

        if (!opts.A || typeof opts.A !== 'string' || !opts.A.trim()) reasons.push('Missing or empty Option A');
        if (!opts.B || typeof opts.B !== 'string' || !opts.B.trim()) reasons.push('Missing or empty Option B');
        // C, D, and E are genuinely optional — some valid exam questions
        // legitimately have only 2 or 3 choices (True/False, 3-option
        // questions). Only A and B are mandatory; whichever of C/D/E are
        // actually present with real text become valid answer keys below.

        const hasOptionC = Boolean(opts.C && typeof opts.C === 'string' && opts.C.trim());
        const hasOptionD = Boolean(opts.D && typeof opts.D === 'string' && opts.D.trim());
        const hasOptionE = Boolean(opts.E && typeof opts.E === 'string' && opts.E.trim());
        const validAnswerKeys = ['A', 'B', ...(hasOptionC ? ['C'] : []), ...(hasOptionD ? ['D'] : []), ...(hasOptionE ? ['E'] : [])];
        const ans = String(qObj.correctAnswer || qObj.correct_answer || '').toUpperCase().trim();
        if (!validAnswerKeys.includes(ans)) {
          reasons.push(`Invalid correctAnswer "${qObj.correctAnswer || qObj.correct_answer}" (must be ${validAnswerKeys.join(', ')})`);
        }

        if (reasons.length > 0) {
          invalidQuestions.push({ index: idx + 1, id: qId, reasons });
          return;
        }

        if (qId) {
          if (batchSeenIds.has(qId)) {
            duplicateInBatchIds.add(qId);
          } else {
            batchSeenIds.add(qId);
          }
        }

        let optExps = qObj.optionExplanations || qObj.option_explanations;
        if (optExps && typeof optExps === 'object') {
          optExps = JSON.stringify(optExps);
        }

        // Preserve TAJNEED/MADANI string category labels through import —
        // never coerce them to a number.
        const year = (typeof qObj.year === 'string' && isNaN(Number(qObj.year))) ? qObj.year : Number(qObj.year || 2025);
        // ROOT CAUSE FIX: bank_id was never read from the incoming question
        // object here, so every imported question — including USMLE bank
        // questions explicitly tagged with bankId on the client — silently
        // fell back to the database column's default value ('human_medicine'
        // from the original single-bank design), merging USMLE questions
        // into the MOH bank's totals regardless of what the admin selected
        // in the Import Wizard.
        const bankId = qObj.bankId || qObj.bank_id ? String(qObj.bankId || qObj.bank_id).trim() : 'human_medicine';

        validQuestions.push({
          id: qId,
          bank_id: bankId,
          question: questionText.trim(),
          option_a: String(opts.A).trim(),
          option_b: String(opts.B).trim(),
          option_c: hasOptionC ? String(opts.C).trim() : null,
          option_d: hasOptionD ? String(opts.D).trim() : null,
          option_e: hasOptionE ? String(opts.E).trim() : null,
          correct_answer: ans,
          explanation: qObj.explanation ? String(qObj.explanation).trim() : 'No explanation provided.',
          option_explanations: optExps || null,
          needs_review: Boolean(qObj.needsReview ?? qObj.needs_review ?? false),
          review_note: qObj.reviewNote || qObj.review_note || null,
          major: qObj.major ? String(qObj.major).trim() : 'General Medical Sciences',
          topic: qObj.topic ? String(qObj.topic).trim() : 'Unassigned Topic',
          is_most_common: Boolean(qObj.isMostCommon ?? qObj.is_most_common ?? false),
          year
        });
      });

      // 4. Supabase Database Checks — authoritative, live, never trusts the
      // client's own idea of what's a duplicate (client-side preview reads
      // localStorage, which can be stale/incomplete on the admin's device).
      const supabase = getSupabase();
      let existingInDatabaseCount = 0;
      let conflictingIds: string[] = [];
      let currentCountForYear = 0;

      const requestedYear = validQuestions.length > 0 ? validQuestions[0].year : null;

      if (supabase) {
        const validIds = validQuestions.map((q) => q.id).filter(Boolean);
        if (validIds.length > 0) {
          const { data: existingRows } = await supabase
            .from('questions')
            .select('id')
            .in('id', validIds);
          existingInDatabaseCount = existingRows ? existingRows.length : 0;
          conflictingIds = existingRows ? existingRows.map((r: any) => r.id) : [];
        }
        if (requestedYear !== null) {
          const { count } = await supabase
            .from('questions')
            .select('*', { count: 'exact', head: true })
            .eq('year', requestedYear);
          currentCountForYear = count || 0;
        }
      }

      const validCount = validQuestions.length;
      const invalidCount = invalidQuestions.length;
      const duplicateInBatchCount = duplicateInBatchIds.size;
      const conflictSet = new Set(conflictingIds);
      const genuinelyNewCount = validQuestions.filter((q) => !conflictSet.has(q.id)).length;

      // 5. Dry-Run Mode Response — full diagnostic report as requested:
      // current count for the year, incoming count, conflict count,
      // genuinely-new count, and exactly what will happen to each group
      // under the selected strategy. Zero writes happen here.
      if (dryRun) {
        let willInsertAsNew = genuinelyNewCount;
        let willResolveConflict = 0;
        let willOverwrite = 0;
        let willSkip = 0;

        if (strategy === 'overwrite') {
          willOverwrite = conflictSet.size;
        } else if (strategy === 'skip') {
          willSkip = conflictSet.size;
        } else {
          // import_as_new (default)
          willResolveConflict = conflictSet.size;
        }

        return res.json({
          dryRun: true,
          strategy,
          totalInBatch,
          validCount,
          invalidCount,
          duplicateInBatchCount,
          existingInDatabaseCount,
          newCount: genuinelyNewCount,
          invalidQuestions: invalidQuestions.slice(0, 10),
          duplicateInBatchIds: Array.from(duplicateInBatchIds),
          conflictingIds: conflictingIds.slice(0, 50),
          diagnosticReport: {
            year: requestedYear,
            currentCountForYear,
            incomingCount: validCount,
            conflictCount: conflictSet.size,
            genuinelyNewCount,
            willInsertAsNew,
            willResolveConflictAndInsert: willResolveConflict,
            willOverwriteExisting: willOverwrite,
            willSkipAndLeaveUnchanged: willSkip,
            expectedFinalCountForYear:
              currentCountForYear + willInsertAsNew + willResolveConflict + (strategy === 'overwrite' ? 0 : 0)
          },
          summary: {
            status: "dry_run_complete",
            message: "Dry-run validation complete. ZERO records were written to Supabase."
          }
        });
      }

      if (invalidCount > 0) {
        return res.status(400).json({
          error: "Import blocked: Batch contains invalid question records.",
          invalidQuestions
        });
      }

      if (!supabase) {
        return res.status(500).json({ error: "Supabase client not configured." });
      }

      // 6. Actual write, branching on strategy. 'skip' and 'import_as_new'
      // both use a plain INSERT (never upsert) for anything that isn't a
      // guaranteed-new row, so there is zero possibility of silently
      // overwriting an existing question via onConflict — that was the
      // entire root cause of the original bug.
      const nonConflicting = validQuestions.filter((q) => !conflictSet.has(q.id));
      const conflicting = validQuestions.filter((q) => conflictSet.has(q.id));

      let toInsert = [...nonConflicting];
      let toUpsert: any[] = [];
      let skippedCount = 0;

      if (strategy === 'overwrite') {
        toUpsert = conflicting; // explicit, intentional overwrite — the only path that still upserts
      } else if (strategy === 'skip') {
        skippedCount = conflicting.length; // left completely untouched
      } else {
        // import_as_new: give every conflicting question a fresh globally
        // unique ID and insert it as a brand-new row. The original row
        // (and anything referencing its ID, e.g. question_progress) is
        // never touched.
        const resolved = conflicting.map((q) => ({
          ...q,
          id: `${q.id}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`
        }));
        toInsert = toInsert.concat(resolved);
      }

      let totalInserted = 0;
      const chunkSize = 500;

      for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize);
        if (chunk.length === 0) continue;
        const { data: insertedData, error: insertError } = await supabase
          .from('questions')
          .insert(chunk)
          .select();

        if (insertError) {
          console.error("Error inserting new questions into Supabase:", insertError.message);
          return res.status(500).json({ error: insertError.message });
        }
        totalInserted += insertedData ? insertedData.length : chunk.length;
      }

      let totalUpserted = 0;
      for (let i = 0; i < toUpsert.length; i += chunkSize) {
        const chunk = toUpsert.slice(i, i + chunkSize);
        if (chunk.length === 0) continue;
        const { data: upsertedData, error: upsertError } = await supabase
          .from('questions')
          .upsert(chunk, { onConflict: 'id' })
          .select();

        if (upsertError) {
          console.error("Error overwriting existing questions in Supabase:", upsertError.message);
          return res.status(500).json({ error: upsertError.message });
        }
        totalUpserted += upsertedData ? upsertedData.length : chunk.length;
      }

      console.log(`[QUESTION_IMPORT] strategy=${strategy} inserted=${totalInserted} overwritten=${totalUpserted} skipped=${skippedCount} year=${requestedYear}`);

      return res.json({
        dryRun: false,
        strategy,
        insertedCount: totalInserted,
        overwrittenCount: totalUpserted,
        skippedCount,
        importedCount: totalInserted + totalUpserted,
        summary: {
          status: "migration_completed",
          message: `Inserted ${totalInserted} new question record(s), overwrote ${totalUpserted}, skipped ${skippedCount}.`
        }
      });
    } catch (err: any) {
      console.error("Error in POST /api/questions/import:", err);
      return res.status(500).json({ error: err.message || "Failed to process question import batch." });
    }
  });

  // Questions schema detailed inspection helper
  app.get("/api/questions/inspect-schema", async (_req, res) => {
    try {
      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: "Supabase not configured." });

      const candidateCols = [
        'id', 'bank_id', 'bankId', 'question', 'stem', 'options', 'option_a', 'option_b', 'option_c', 'option_d',
        'correct_answer', 'correctAnswer', 'explanation', 'option_explanations', 'optionExplanations',
        'needs_review', 'needsReview', 'review_note', 'reviewNote', 'major', 'topic', 'year',
        'difficulty', 'classification_status', 'classificationStatus', 'created_at', 'updated_at'
      ];

      const validCols: string[] = [];
      await Promise.all(candidateCols.map(async (col) => {
        const { error } = await supabase.from('questions').select(col).limit(1);
        if (!error) validCols.push(col);
      }));

      const { count: questionsCount } = await supabase.from('questions').select('*', { count: 'exact', head: true });
      const { count: progressCount } = await supabase.from('question_progress').select('*', { count: 'exact', head: true });

      // Test questions.id string vs uuid query
      const { error: idStringError } = await supabase.from('questions').select('id').eq('id', 'MOH-TEST-001').limit(1);
      const { error: idUuidError } = await supabase.from('questions').select('id').eq('id', '00000000-0000-0000-0000-000000000000').limit(1);

      // Test question_progress.question_id string vs uuid query
      const { error: progressStringErr } = await supabase.from('question_progress').select('question_id').eq('question_id', 'MOH-TEST-001').limit(1);
      const { error: progressUuidErr } = await supabase.from('question_progress').select('question_id').eq('question_id', '00000000-0000-0000-0000-000000000000').limit(1);

      // Check all other tables for potential question_id references
      const tablesToCheck = ['subscriptions', 'blocks', 'flashcards', 'payments', 'users'];
      const tableColumnCheck: Record<string, any> = {};

      for (const tbl of tablesToCheck) {
        const { error: checkErr } = await supabase.from(tbl).select('question_id').limit(1);
        tableColumnCheck[tbl] = {
          hasQuestionIdColumn: !checkErr || !checkErr.message.includes('does not exist')
        };
      }

      return res.json({
        questionsRowCount: questionsCount,
        progressRowCount: progressCount,
        validQuestionsColumns: validCols,
        questionsIdTypeCheck: {
          acceptsString: !idStringError,
          idStringError: idStringError ? idStringError.message : null,
          acceptsUuid: !idUuidError,
          idUuidError: idUuidError ? idUuidError.message : null
        },
        questionProgressQuestionIdTypeCheck: {
          acceptsString: !progressStringErr,
          progressStringError: progressStringErr ? progressStringErr.message : null,
          acceptsUuid: !progressUuidErr,
          progressUuidError: progressUuidErr ? progressUuidErr.message : null
        },
        otherTablesWithQuestionId: tableColumnCheck
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/flashcards/:id/feedback - user reports a problem with a
  // flashcard (mirrors the question-feedback flow exactly).
  app.post("/api/flashcards/:id/feedback", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.body?.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.body?.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const flashcardId = req.params.id;
      if (!flashcardId) {
        return res.status(400).json({ error: "Flashcard id parameter is required." });
      }

      const message = req.body?.message ? String(req.body.message).trim().slice(0, 1000) : '';

      const supabase = getSupabase();
      let cardSnapshot: any = null;
      if (supabase) {
        const { data } = await supabase
          .from('flashcards')
          .select('id, question, answer')
          .eq('id', flashcardId)
          .maybeSingle();
        cardSnapshot = data;
      }

      const userRow = supabase ? await getOrCreateSupabaseUser(requesterId, requesterUsername) : null;
      const reporterLabel = userRow?.full_name
        ? userRow.full_name
        : (requesterUsername ? `@${requesterUsername}` : `Telegram ID ${requesterId}`);

      if (supabase) {
        try {
          const { error: insertErr } = await supabase
            .from('flashcard_feedback')
            .insert({
              flashcard_id: flashcardId,
              user_id: userRow?.id || null,
              telegram_id: requesterId || (userRow?.telegram_id ? String(userRow.telegram_id) : null),
              message: message || null,
              created_at: new Date().toISOString()
            });
          if (insertErr && insertErr.code !== '42P01') {
            console.warn(`[FLASHCARD_FEEDBACK] Failed to persist feedback for flashcardId=${flashcardId}: ${insertErr.message}`);
          }
        } catch (persistErr: any) {
          console.warn(`[FLASHCARD_FEEDBACK] Unexpected error persisting feedback: ${persistErr?.message}`);
        }
      }

      try {
        const adminIds = getAdminTelegramIds();
        const questionPreview = cardSnapshot?.question
          ? (String(cardSnapshot.question).length > 200 ? String(cardSnapshot.question).slice(0, 200) + '…' : cardSnapshot.question)
          : '(flashcard text unavailable)';

        const notificationMessage =
          `⚠️ <b>إبلاغ عن مشكلة بفلاش كارد</b>\n\n` +
          `🆔 <b>Flashcard ID:</b> <code>${flashcardId}</code>\n` +
          `📝 <b>السؤال:</b> ${questionPreview}\n\n` +
          `👤 <b>المستخدم المُبلِّغ:</b> ${reporterLabel}\n` +
          (message ? `💬 <b>ملاحظة المستخدم:</b> ${message}\n` : `💬 <b>ملاحظة المستخدم:</b> (لم يكتب تفاصيل)\n`) +
          `\n<i>يمكنك مراجعة وتعديل الفلاش كارد من لوحة الإدارة باستخدام رقم الـ ID أعلاه.</i>`;

        for (const adminId of adminIds) {
          if (/^\d+$/.test(adminId)) {
            await sendTelegramMessage(adminId, notificationMessage);
          }
        }
      } catch (notifyErr: any) {
        console.error(`[FLASHCARD_FEEDBACK] Failed to notify admins for flashcardId=${flashcardId}:`, notifyErr?.message || notifyErr);
      }

      console.log(`[FLASHCARD_FEEDBACK] flashcardId=${flashcardId} reporter=${reporterLabel} hasMessage=${Boolean(message)}`);

      return res.json({ success: true });
    } catch (err: any) {
      console.error("Error in POST /api/flashcards/:id/feedback:", err);
      return res.status(500).json({ error: err.message || "Failed to submit flashcard feedback." });
    }
  });


  // question (suspected wrong answer, unclear stem, etc). Notifies admins
  // immediately via Telegram with the question ID so it's trivially easy
  // to look up and fix, and also persists to Supabase (schema-safe — if the
  // question_feedback table doesn't exist yet, the Telegram notification
  // still goes out; only the persistence step is skipped).
  app.post("/api/questions/:id/feedback", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.body?.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.body?.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const questionId = req.params.id;
      if (!questionId) {
        return res.status(400).json({ error: "Question id parameter is required." });
      }

      const message = req.body?.message ? String(req.body.message).trim().slice(0, 1000) : '';

      const supabase = getSupabase();
      let questionSnapshot: any = null;
      if (supabase) {
        const { data } = await supabase
          .from('questions')
          .select('id, question, major, topic, year')
          .eq('id', questionId)
          .maybeSingle();
        questionSnapshot = data;
      }

      const userRow = supabase ? await getOrCreateSupabaseUser(requesterId, requesterUsername) : null;
      const reporterLabel = userRow?.full_name
        ? userRow.full_name
        : (requesterUsername ? `@${requesterUsername}` : `Telegram ID ${requesterId}`);

      // Persist for a durable admin-facing list, independent of Telegram.
      if (supabase) {
        try {
          const { error: insertErr } = await supabase
            .from('question_feedback')
            .insert({
              question_id: questionId,
              user_id: userRow?.id || null,
              telegram_id: requesterId || (userRow?.telegram_id ? String(userRow.telegram_id) : null),
              message: message || null,
              created_at: new Date().toISOString()
            });
          if (insertErr && insertErr.code !== '42P01') {
            // 42P01 = undefined_table — schema not migrated yet, non-fatal.
            console.warn(`[QUESTION_FEEDBACK] Failed to persist feedback for questionId=${questionId}: ${insertErr.message}`);
          }
        } catch (persistErr: any) {
          console.warn(`[QUESTION_FEEDBACK] Unexpected error persisting feedback: ${persistErr?.message}`);
        }
      }

      // Notify admins immediately via Telegram — the primary, actionable channel.
      try {
        const adminIds = getAdminTelegramIds();
        const stemPreview = questionSnapshot?.question
          ? (String(questionSnapshot.question).length > 200 ? String(questionSnapshot.question).slice(0, 200) + '…' : questionSnapshot.question)
          : '(question text unavailable)';

        const notificationMessage =
          `⚠️ <b>إبلاغ عن مشكلة بسؤال</b>\n\n` +
          `🆔 <b>Question ID:</b> <code>${questionId}</code>\n` +
          (questionSnapshot ? `📚 <b>التصنيف:</b> ${questionSnapshot.major || 'N/A'} • ${questionSnapshot.topic || 'N/A'} • ${questionSnapshot.year || 'N/A'}\n` : '') +
          `📝 <b>نص السؤال:</b> ${stemPreview}\n\n` +
          `👤 <b>المستخدم المُبلِّغ:</b> ${reporterLabel}\n` +
          (message ? `💬 <b>ملاحظة المستخدم:</b> ${message}\n` : `💬 <b>ملاحظة المستخدم:</b> (لم يكتب تفاصيل)\n`) +
          `\n<i>يمكنك مراجعة السؤال وتعديله من لوحة إدارة بنك الأسئلة باستخدام رقم الـ ID أعلاه.</i>`;

        for (const adminId of adminIds) {
          if (/^\d+$/.test(adminId)) {
            await sendTelegramMessage(adminId, notificationMessage);
          }
        }
      } catch (notifyErr: any) {
        console.error(`[QUESTION_FEEDBACK] Failed to notify admins for questionId=${questionId}:`, notifyErr?.message || notifyErr);
      }

      console.log(`[QUESTION_FEEDBACK] questionId=${questionId} reporter=${reporterLabel} hasMessage=${Boolean(message)}`);

      return res.json({ success: true });
    } catch (err: any) {
      console.error("Error in POST /api/questions/:id/feedback:", err);
      return res.status(500).json({ error: err.message || "Failed to submit question feedback." });
    }
  });

  // Phase 3: Question Progress API Endpoints
  app.post("/api/question-progress", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || req.body?.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || req.body?.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const { questionId, selectedAnswer, isCorrect } = req.body || {};

      if (!questionId || typeof questionId !== 'string' || !questionId.trim()) {
        return res.status(400).json({ error: "questionId is required and must be a non-empty string." });
      }

      const validOptionKeys = ['A', 'B', 'C', 'D', 'E'];
      if (!selectedAnswer || !validOptionKeys.includes(String(selectedAnswer).toUpperCase().trim())) {
        return res.status(400).json({ error: "selectedAnswer must be one of A, B, C, D, or E." });
      }

      if (typeof isCorrect !== 'boolean') {
        return res.status(400).json({ error: "isCorrect must be a boolean." });
      }

      const supabase = getSupabase();
      if (!supabase) {
        return res.json({
          synced: false,
          note: "Supabase client not configured on server."
        });
      }

      // Resolve Supabase user record
      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      if (!userRow || !userRow.id) {
        return res.status(500).json({ error: "Failed to resolve or create Supabase user account." });
      }

      const cleanQId = String(questionId).trim();
      const cleanAnswer = String(selectedAnswer).toUpperCase().trim();
      const now = new Date().toISOString();

      // Check if question exists in Supabase questions table
      const { data: qCheck } = await supabase
        .from('questions')
        .select('id')
        .eq('id', cleanQId)
        .maybeSingle();

      if (!qCheck) {
        // Question not present in Supabase questions table yet (questions stored in localStorage / demoData)
        return res.json({
          synced: false,
          questionId: cleanQId,
          note: "Question ID not present in Supabase questions table yet. Progress preserved in local storage."
        });
      }

      // Upsert progress into question_progress on unique constraint (user_id, question_id)
      const { data: progressRow, error: upsertErr } = await supabase
        .from('question_progress')
        .upsert({
          user_id: userRow.id,
          question_id: cleanQId,
          selected_answer: cleanAnswer,
          is_correct: isCorrect,
          updated_at: now
        }, { onConflict: 'user_id,question_id' })
        .select()
        .single();

      if (upsertErr) {
        console.error("Error upserting question_progress in Supabase:", upsertErr.message);
        return res.status(500).json({ error: upsertErr.message });
      }

      return res.json({
        synced: true,
        progress: {
          id: progressRow.id,
          userId: userRow.id,
          questionId: progressRow.question_id,
          selectedAnswer: progressRow.selected_answer,
          isCorrect: progressRow.is_correct,
          updatedAt: progressRow.updated_at
        }
      });
    } catch (err: any) {
      console.error("Error in POST /api/question-progress:", err);
      return res.status(500).json({ error: err.message || "Failed to save question progress." });
    }
  });

  app.get("/api/question-progress", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const supabase = getSupabase();
      if (!supabase) {
        return res.json({
          progress: [],
          note: "Supabase client not configured."
        });
      }

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      if (!userRow || !userRow.id) {
        return res.json({ progress: [] });
      }

      const targetQId = req.query.questionId ? String(req.query.questionId).trim() : undefined;

      let query = supabase
        .from('question_progress')
        .select('*')
        .eq('user_id', userRow.id);

      if (targetQId) {
        query = query.eq('question_id', targetQId);
      }

      const { data: rows, error } = await query.order('updated_at', { ascending: false });

      if (error) {
        console.error("Error querying question_progress in Supabase:", error.message);
        return res.status(500).json({ error: error.message });
      }

      const mappedProgress = (rows || []).map((row: any) => ({
        id: row.id,
        userId: row.user_id,
        questionId: row.question_id,
        selectedAnswer: row.selected_answer,
        isCorrect: row.is_correct,
        updatedAt: row.updated_at
      }));

      return res.json({ progress: mappedProgress });
    } catch (err: any) {
      console.error("Error in GET /api/question-progress:", err);
      return res.status(500).json({ error: err.message || "Failed to fetch question progress." });
    }
  });

  // AI Medical Explanation Completion & Classification Endpoint
  app.post("/api/ai/complete-explanations", async (req, res) => {
    try {
      const { questions } = req.body;
      if (!Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ error: "No questions provided in array." });
      }

      // HARD SAFETY NET: Dentistry bank explanations and option-level
      // explanations must NEVER be touched or generated by AI — this is a
      // firm product requirement, not just a UI convention. Regardless of
      // which admin screen or future code path calls this endpoint, if
      // ANY submitted question belongs to the Dentistry bank, refuse
      // outright rather than risk silently appending or duplicating
      // AI-generated content on top of an admin-authored explanation. The
      // correct endpoint for that bank is /api/ai/classify-topic, which
      // never receives or returns explanation data at all.
      const usmleQuestionIds = questions
        .filter((q: any) => (q.bankId || q.bank_id) === 'dentistry')
        .map((q: any) => q.id);
      if (usmleQuestionIds.length > 0) {
        return res.status(400).json({
          error: `Refused: ${usmleQuestionIds.length} question(s) belong to the Dentistry bank, which never receives AI-generated explanations. Use /api/ai/classify-topic for Topic classification on this bank instead. Affected IDs: ${usmleQuestionIds.slice(0, 5).join(', ')}${usmleQuestionIds.length > 5 ? '...' : ''}`
        });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY environment variable is not configured on the server." });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build'
          }
        }
      });

      const SYSTEM_INSTRUCTION = `You are an expert evidence-grounded medical AI verification and classification engine for the U JO TAJNEED MOH Medical Residency Question Bank.

Your task is:
1. AUTOMATIC CLINICAL CLASSIFICATION: Classify each medical residency question into its clinical Major specialty (e.g. "Internal Medicine", "General Surgery", "Pediatrics", "Obstetrics & Gynecology", "Psychiatry", "Emergency Medicine", "Family Medicine", "Orthopedics", "Ophthalmology", "ENT"), Topic (e.g. "Cardiology", "Gastroenterology", "Pulmonology", "Nephrology", "Endocrinology", "Neurology", "Rheumatology", "Hematology", "Infectious Disease", "Dermatology"), and Subtopic (e.g. "Ischemic Heart Disease", "Valvular Disease", "Asthma & COPD", "Diabetic Ketoacidosis"). Do NOT return "Unassigned" or "Unassigned Topic" if you can classify the question from its stem and options.

2. CLINICAL OPTION EXPLANATIONS FOR INCORRECT OPTIONS:
- For each INCORRECT option (options that are NOT the correctAnswer key), generate a concise, clinically accurate explanation explaining why that specific choice is incorrect, contraindicated, or less appropriate in this specific clinical scenario.
- DO NOT generate explanations for the correct option key.
- DO NOT use generic template text like "This option is incorrect because...". Provide actual medical reasoning, pathophysiological mechanisms, diagnostic criteria, or clinical guidelines.
- Each explanation MUST be unique and specific to that particular option choice.

3. ORIGINAL DATA PRESERVATION:
- The original question stem, options A-D, correctAnswer, and original explanation MUST REMAIN UNCHANGED.

4. MEDICAL UNCERTAINTY HANDLING:
- If you are uncertain about a clinical rationale or if the question stem lacks detail, set "needsReview": true and provide a "reviewNote" explaining why. Otherwise set "needsReview": false and "reviewNote": "".

5. CRITICAL COMPLETENESS REQUIREMENT:
- You will be given a list of N questions, each with a unique "id". Your "results" array MUST contain EXACTLY N entries — one for every single "id" you were given, with no omissions, regardless of how similar or difficult a question is. If you are uncertain about a question, still include it with "needsReview": true rather than leaving it out entirely. An incomplete results array (fewer entries than questions provided) is a failed response.`;

      const promptPayload = questions.map((q: any) => ({
        id: q.id,
        question: q.question,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        major: q.major,
        topic: q.topic,
        subtopic: q.subtopic,
        year: q.year
      }));

      // Reverted back to Gemini per product decision (OpenAI billing setup
      // was a blocker). Retains the retry/backoff/fallback-model fix from
      // the earlier forensic investigation: retries BOTH 429 and 503 with
      // exponential backoff + jitter (~1-2s, 2-4s, 4-8s), and falls back to
      // gemini-3.7-flash if the primary model keeps failing.
      const PRIMARY_MODEL = "gemini-3.6-flash";
      const FALLBACK_MODEL = "gemini-3.7-flash";
      const MAX_ATTEMPTS_PER_MODEL = 3;

      const isRetryableError = (err: any): boolean => {
        const status = err?.status;
        const code = err?.code;
        const msg = String(err?.message || '');
        return (
          status === 429 ||
          status === 503 ||
          code === 503 ||
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('UNAVAILABLE') ||
          msg.toLowerCase().includes('high demand') ||
          msg.toLowerCase().includes('quota')
        );
      };

      const backoffDelayMs = (attempt: number): number => {
        // attempt 1 -> ~1-2s, attempt 2 -> ~2-4s, attempt 3 -> ~4-8s
        const base = 1000 * Math.pow(2, attempt - 1);
        const jitter = Math.random() * base;
        return base + jitter;
      };

      const callGemini = async (model: string): Promise<{ response: any; attemptsUsed: number; lastError: any }> => {
        let response: any = null;
        let lastError: any = null;
        let attempts = 0;

        while (attempts < MAX_ATTEMPTS_PER_MODEL) {
          attempts++;
          const requestStarted = new Date().toISOString();
          try {
            response = await ai.models.generateContent({
              model,
              contents: `Process the following batch of medical residency examination questions. Automatically classify each question by Major, Topic, and Subtopic, generate evidence-grounded optionExplanations for incorrect options, and verify clinical reasoning:\n\n${JSON.stringify(promptPayload, null, 2)}`,
              config: {
                systemInstruction: SYSTEM_INSTRUCTION,
                safetySettings: MEDICAL_CONTENT_SAFETY_SETTINGS,
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    results: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          id: { type: Type.STRING },
                          major: { type: Type.STRING },
                          topic: { type: Type.STRING },
                          subtopic: { type: Type.STRING },
                          optionExplanations: {
                            type: Type.OBJECT,
                            properties: {
                              A: { type: Type.STRING },
                              B: { type: Type.STRING },
                              C: { type: Type.STRING },
                              D: { type: Type.STRING }
                            }
                          },
                          needsReview: { type: Type.BOOLEAN },
                          reviewNote: { type: Type.STRING }
                        },
                        required: ["id", "major", "topic", "subtopic", "optionExplanations", "needsReview", "reviewNote"]
                      }
                    }
                  },
                  required: ["results"]
                }
              }
            });

            console.log(`[AI_EXPLANATION] provider=gemini model=${model} endpoint=generateContent requestStarted=${requestStarted} responseStatus=200 retryCount=${attempts - 1}`);
            return { response, attemptsUsed: attempts, lastError: null };
          } catch (err: any) {
            lastError = err;
            console.log(`[AI_EXPLANATION] provider=gemini model=${model} endpoint=generateContent requestStarted=${requestStarted} responseStatus=${err?.status || 'unknown'} errorCode=${err?.code || 'unknown'} errorStatus=${err?.status === 503 ? 'UNAVAILABLE' : (err?.status === 429 ? 'RESOURCE_EXHAUSTED' : 'unknown')} errorMessage="${String(err?.message || '').slice(0, 200)}" retryCount=${attempts - 1}`);

            if (isRetryableError(err) && attempts < MAX_ATTEMPTS_PER_MODEL) {
              const delay = backoffDelayMs(attempts);
              console.warn(`[AI_EXPLANATION] Retrying model=${model} attempt ${attempts + 1}/${MAX_ATTEMPTS_PER_MODEL} in ${Math.round(delay)}ms...`);
              await new Promise((resolve) => setTimeout(resolve, delay));
            } else {
              break;
            }
          }
        }

        return { response, attemptsUsed: attempts, lastError };
      };

      let { response, lastError } = await callGemini(PRIMARY_MODEL);

      // If the primary model exhausted its retries specifically due to a
      // retryable error, try the fallback model before giving up.
      if (!response && lastError && isRetryableError(lastError)) {
        console.warn(`[AI_EXPLANATION] Primary model=${PRIMARY_MODEL} exhausted retries, falling back to model=${FALLBACK_MODEL}`);
        const fallbackResult = await callGemini(FALLBACK_MODEL);
        response = fallbackResult.response;
        lastError = fallbackResult.lastError;
      }

      if (!response) {
        // Production safety: this failure only affects the admin's
        // classification/explanation-completion tool during import — it
        // never touches a user's question, answer, score, or session
        // state, since those are entirely separate systems.
        const err: any = new Error(
          lastError && isRetryableError(lastError)
            ? "AI explanation is temporarily unavailable. Please try again."
            : (lastError?.message || "Failed to generate AI medical explanations.")
        );
        err.status = lastError?.status === 503 ? 503 : (lastError?.status || 502);
        throw err;
      }

      if (!response.text) {
        throw new Error("Gemini API returned an empty or missing response.");
      }

      let parsedResults: any[] = [];
      try {
        const parsed = JSON.parse(response.text);
        parsedResults = parsed.results || [];
      } catch (e: any) {
        throw new Error(`Failed to parse structured JSON from Gemini API: ${e.message}`);
      }

      if (!Array.isArray(parsedResults) || parsedResults.length === 0) {
        throw new Error("Gemini API response contained no results array.");
      }

      // ROOT CAUSE FIX: previously, if Gemini's response was missing even a
      // SINGLE question's result, this threw and failed the ENTIRE chunk —
      // discarding every other question in that same request that Gemini
      // HAD successfully classified. Now, a missing item is simply skipped
      // (never invented/faked) and the client's own gap-fill retry logic
      // targets exactly those omitted questions in a smaller follow-up
      // call, so a partial Gemini response no longer wastes an entire
      // chunk's worth of otherwise-successful results.
      const finalResults = questions
        .map((q: any) => {
          const item = parsedResults.find((r: any) => r.id === q.id);
          if (!item) {
            console.warn(`[AI_EXPLANATION] Gemini output was missing result for question ID: ${q.id} — skipped, not failed, for the client to retry.`);
            return null;
          }

          const correctKey = String(q.correctAnswer).toUpperCase();
          const optionExplanations: Record<string, string> = { ...(item.optionExplanations || {}) };
          delete optionExplanations[correctKey];

          const isUnassigned =
            !item.major ||
            item.major === 'Unassigned' ||
            !item.topic ||
            item.topic === 'Unassigned Topic';

          const needsRev = isUnassigned ? true : Boolean(item.needsReview);
          const revNote = isUnassigned
            ? "NEEDS REVIEW: Question requires clinical classification (Major/Topic)."
            : (item.reviewNote || "");

          return {
            id: q.id,
            major: item.major || "Unassigned",
            topic: item.topic || "Unassigned Topic",
            subtopic: item.subtopic || "",
            optionExplanations,
            evidenceSources: [],
            groundingQueries: [],
            needsReview: needsRev,
            reviewNote: revNote
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      return res.json({ results: finalResults });
    } catch (error: any) {
      console.error("AI Complete Explanations Error:", error);
      return res.status(error.status || 502).json({
        error: error.message || "Failed to generate AI medical explanations."
      });
    }
  });

  // POST /api/ai/question-chat - Student-facing AI study assistant, scoped
  // strictly to the current question and constrained to established,
  // trusted medical sources/consensus. NOT a general-purpose chatbot: the
  // system instruction explicitly forbids speculation, unverified claims,
  // and direct patient-specific clinical advice — this is an exam-prep
  // educational tool, not clinical decision support. Reuses the same
  // Gemini retry/backoff pattern as the admin explanation-completion tool
  // for reliability.
  // POST /api/ai/classify-topic - Lightweight, narrowly-scoped classifier
  // used for USMLE-bank imports: given a question and its ALREADY-CHOSEN
  // Major (selected manually by the admin, never by AI), determines only
  // the specific clinical Topic. This endpoint NEVER touches, generates,
  // or reads the question's explanation or optionExplanations — those
  // fields are not even sent to it, and its response schema has no field
  // for them. Completely separate from /api/ai/complete-explanations
  // (used only by the MOH-bank flow), which additionally classifies
  // major/subtopic and writes optionExplanations.
  app.post("/api/ai/classify-topic", async (req, res) => {
    try {
      const { questions } = req.body;
      if (!Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ error: "No questions provided in array." });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY environment variable is not configured on the server." });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });

      const SYSTEM_INSTRUCTION = `You are a clinical topic classifier for a dentistry question bank.

For each question, you are given its stem, answer options, and its Major (clinical specialty), which has ALREADY been determined by a human administrator and must NOT be changed.

Your ONLY job is to determine the most specific, clinically appropriate Topic within that given Major (e.g., within "Endodontics": "Root Canal Therapy", "Pulp Pathology"; within "Periodontics": "Gingivitis", "Periodontal Surgery"; within "Oral Surgery": "Extractions", "Impacted Teeth", "Dentoalveolar Trauma"; within "Orthodontics": "Malocclusion", "Fixed Appliances"; within "Prosthodontics": "Fixed Prosthodontics", "Removable Prosthodontics", "Implants"; within "Pediatric Dentistry": "Pulp Therapy", "Space Maintainers"; within "Oral Pathology": "Oral Lesions", "Oral Cancer").

Do NOT generate, modify, or comment on the question's explanation or answer options in any way — you will not even receive that information. Return ONLY the classification.

CRITICAL COMPLETENESS REQUIREMENT: You will be given a list of N questions, each with a unique "id". Your "results" array MUST contain EXACTLY N entries — one for every single "id" you were given, with no omissions, regardless of how similar, short, or ambiguous a question's stem is. Never skip a question because you are uncertain of the exact topic — in that case, pick your single best reasonable guess for that specialty rather than leaving it out entirely. An incomplete results array (fewer entries than questions provided) is a failed response.`;

      const promptPayload = questions.map((q: any) => ({
        id: q.id,
        question: q.question,
        options: q.options,
        major: q.major
      }));

      const PRIMARY_MODEL = "gemini-3.6-flash";
      const FALLBACK_MODEL = "gemini-3.7-flash";
      const MAX_ATTEMPTS_PER_MODEL = 3;

      const isRetryableError = (err: any): boolean => {
        const status = err?.status;
        const msg = String(err?.message || '');
        return status === 429 || status === 503 || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('UNAVAILABLE') || msg.toLowerCase().includes('quota');
      };
      const backoffDelayMs = (attempt: number): number => {
        const base = 1000 * Math.pow(2, attempt - 1);
        return base + Math.random() * base;
      };

      const callGemini = async (model: string): Promise<{ response: any; lastError: any }> => {
        let response: any = null;
        let lastError: any = null;
        let attempts = 0;

        while (attempts < MAX_ATTEMPTS_PER_MODEL) {
          attempts++;
          try {
            response = await ai.models.generateContent({
              model,
              contents: `Classify the Topic for each of the following questions, given their already-determined Major:\n\n${JSON.stringify(promptPayload, null, 2)}`,
              config: {
                systemInstruction: SYSTEM_INSTRUCTION,
                safetySettings: MEDICAL_CONTENT_SAFETY_SETTINGS,
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    results: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          id: { type: Type.STRING },
                          topic: { type: Type.STRING }
                        },
                        required: ["id", "topic"]
                      }
                    }
                  },
                  required: ["results"]
                }
              }
            });
            return { response, lastError: null };
          } catch (err: any) {
            lastError = err;
            if (isRetryableError(err) && attempts < MAX_ATTEMPTS_PER_MODEL) {
              await new Promise((resolve) => setTimeout(resolve, backoffDelayMs(attempts)));
            } else {
              break;
            }
          }
        }
        return { response, lastError };
      };

      let { response, lastError } = await callGemini(PRIMARY_MODEL);
      if (!response && lastError && isRetryableError(lastError)) {
        const fallback = await callGemini(FALLBACK_MODEL);
        response = fallback.response;
        lastError = fallback.lastError;
      }

      if (!response) {
        const err: any = new Error(
          lastError && isRetryableError(lastError)
            ? "Topic classification is temporarily unavailable. Please try again."
            : (lastError?.message || "Failed to classify topics.")
        );
        err.status = lastError?.status === 503 ? 503 : (lastError?.status || 502);
        throw err;
      }

      const parsed = JSON.parse(response.text);
      const results = Array.isArray(parsed.results) ? parsed.results : [];

      return res.json({ results });
    } catch (err: any) {
      console.error("Error in POST /api/ai/classify-topic:", err);
      return res.status(err.status || 500).json({ error: err.message || "Failed to classify topics." });
    }
  });

  app.post("/api/ai/question-chat", async (req, res) => {

    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.body?.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.body?.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const { question, history, message } = req.body || {};
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: "message is required." });
      }
      if (!question || !question.question) {
        return res.status(400).json({ error: "question context is required." });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY environment variable is not configured on the server." });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });

      const SYSTEM_INSTRUCTION = `You are a focused medical exam-preparation study assistant embedded inside a question bank (U JO TAJNEED, MOH residency exam prep). A student is asking you about ONE specific practice question they are currently reviewing.

STRICT RULES:
1. Base every answer ONLY on established, well-accepted medical knowledge as found in standard, trusted references (e.g., major internal medicine/specialty textbooks, UpToDate, StatPearls, official clinical practice guidelines from recognized medical societies). Do NOT speculate, invent mechanisms, or state anything as fact if it is not well-established medical consensus.
2. If a topic is genuinely controversial, evolving, or not well-established in mainstream guidelines, say so explicitly (e.g., "sources vary on this" or "this is not firmly established") rather than presenting one view as definitive.
3. This is EDUCATIONAL/EXAM-PREP context only — never give direct clinical advice as if to a real patient (no "you should take X mg of..."). Frame everything in terms of exam concepts, clinical reasoning, and "why this answer is correct/incorrect for this question."
4. Stay strictly scoped to the CURRENT QUESTION and directly related medical concepts. If the student asks something unrelated to medicine or to this question's topic, politely redirect them back to the question.
5. Be concise and exam-focused — this is a quick study aid during timed practice, not a long lecture. Prefer short paragraphs or brief bullet points.
6. Never contradict the question's own stated correct answer and explanation without very strong, clearly-labeled justification — your role is to help the student understand the established reasoning, not to relitigate the question.

CURRENT QUESTION CONTEXT:
Stem: ${question.question}
Options: A) ${question.options?.A || ''} B) ${question.options?.B || ''} C) ${question.options?.C || ''} D) ${question.options?.D || ''}
Correct Answer: ${question.correctAnswer || 'N/A'}
Official Explanation: ${question.explanation || 'N/A'}
Specialty: ${question.major || 'N/A'} — ${question.topic || 'N/A'}`;

      const conversationHistory: Array<{ role: string; parts: { text: string }[] }> = Array.isArray(history)
        ? history.slice(-10).map((h: any) => ({
            role: h.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: String(h.content || '').slice(0, 2000) }]
          }))
        : [];

      const MAX_ATTEMPTS = 3;
      const isRetryableChatError = (err: any): boolean => {
        const status = err?.status;
        const msg = String(err?.message || '');
        return status === 429 || status === 503 || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('UNAVAILABLE') || msg.toLowerCase().includes('quota');
      };
      const backoff = (attempt: number) => 1000 * Math.pow(2, attempt - 1) + Math.random() * 1000 * Math.pow(2, attempt - 1);

      let response: any = null;
      let lastError: any = null;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const chat = ai.chats.create({
            model: "gemini-3.6-flash",
            config: { systemInstruction: SYSTEM_INSTRUCTION },
            history: conversationHistory
          });
          response = await chat.sendMessage({ message: message.trim().slice(0, 2000) });
          break;
        } catch (err: any) {
          lastError = err;
          if (isRetryableChatError(err) && attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, backoff(attempt)));
          } else {
            break;
          }
        }
      }

      if (!response) {
        const err: any = new Error(
          lastError && isRetryableChatError(lastError)
            ? "The study assistant is temporarily unavailable. Please try again."
            : (lastError?.message || "Failed to get a response from the study assistant.")
        );
        err.status = lastError?.status || 502;
        throw err;
      }

      return res.json({ reply: response.text || '' });
    } catch (err: any) {
      console.error("Error in POST /api/ai/question-chat:", err);
      return res.status(err.status || 500).json({ error: err.message || "Failed to get a response from the study assistant." });
    }
  });


  function mapDbRowToBlock(row: any, userTelegramId?: string) {
    let feStatus: 'ACTIVE' | 'SAVED' | 'COMPLETED' = 'ACTIVE';
    const statusLower = String(row.status || '').toLowerCase();
    if (statusLower === 'saved') {
      feStatus = 'SAVED';
    } else if (statusLower === 'completed' || statusLower === 'finished') {
      feStatus = 'COMPLETED';
    } else {
      feStatus = 'ACTIVE';
    }

    return {
      id: row.custom_id || row.id,
      userId: userTelegramId || row.user_id,
      bankId: row.bank_id || 'human_medicine',
      bankName: (row.bank_id || 'human_medicine') === 'dentistry' ? 'Dentistry' : 'Human Medicine',
      questionIds: Array.isArray(row.question_ids) ? row.question_ids : [],
      status: feStatus,
      currentIndex: Number(row.current_question_index || 0),
      filters: row.filters && typeof row.filters === 'object' ? row.filters : {},
      answers: row.answers && typeof row.answers === 'object' ? row.answers : {},
      annotations: row.annotations && typeof row.annotations === 'object' ? row.annotations : {},
      createdAt: row.started_at || row.created_at || new Date().toISOString(),
      updatedAt: row.updated_at || new Date().toISOString(),
      score: row.score !== null && row.score !== undefined ? Number(row.score) : undefined,
      timeSpentSeconds: row.time_spent_seconds !== null && row.time_spent_seconds !== undefined ? Number(row.time_spent_seconds) : undefined
    };
  }

  // Phase 4: Blocks API Endpoints
  // POST /api/blocks - Create or Upsert block
  app.post("/api/blocks", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || req.body?.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || req.body?.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const blockObj = req.body?.block || req.body;
      if (!blockObj || (!blockObj.id && !blockObj.customId)) {
        return res.status(400).json({ error: "Invalid block payload: id/customId is required." });
      }

      const supabase = getSupabase();
      if (!supabase) {
        return res.json({
          synced: false,
          note: "Supabase client not configured on server."
        });
      }

      // Resolve Supabase user account
      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      if (!userRow || !userRow.id) {
        return res.status(500).json({ error: "Failed to resolve or create Supabase user account." });
      }

      // Single-active-session enforcement (see checkAndRegisterSession above).
      const incomingSessionId = (req.headers['x-session-id'] || req.body?.sessionId || null) as string | null;
      const sessionCheck = await checkAndRegisterSession(userRow.id, incomingSessionId);
      if (!sessionCheck.ok) {
        return res.status(409).json({ error: sessionCheck.reason, code: 'SESSION_CONFLICT' });
      }

      recordBlockActivity(userRow.id);

      const customId = String(blockObj.id || blockObj.customId).trim();

      // Security check: Check if block exists and belongs to a different user
      const { data: existingBlock } = await supabase
        .from('blocks')
        .select('id, user_id')
        .eq('custom_id', customId)
        .maybeSingle();

      if (existingBlock && existingBlock.user_id !== userRow.id) {
        return res.status(403).json({ error: "Access denied: Block belongs to another user." });
      }

      // Status mapping: FE ACTIVE -> DB in_progress; SAVED -> saved; COMPLETED -> finished
      let dbStatus = 'in_progress';
      const feStatus = String(blockObj.status || 'ACTIVE').toUpperCase();
      if (feStatus === 'SAVED') dbStatus = 'saved';
      else if (feStatus === 'COMPLETED' || feStatus === 'FINISHED') dbStatus = 'finished';

      const now = new Date().toISOString();
      const questionIds = Array.isArray(blockObj.questionIds) ? blockObj.questionIds : (Array.isArray(blockObj.question_ids) ? blockObj.question_ids : []);

      const blockRowData = {
        custom_id: customId,
        user_id: userRow.id,
        bank_id: blockObj.bankId || blockObj.bank_id || 'human_medicine',
        mode: blockObj.filters?.mode || blockObj.mode || 'tutor',
        question_ids: questionIds,
        filters: blockObj.filters || {},
        answers: blockObj.answers || {},
        annotations: blockObj.annotations || {},
        status: dbStatus,
        current_question_index: typeof blockObj.currentIndex === 'number' ? blockObj.currentIndex : (blockObj.current_question_index || 0),
        total_questions: questionIds.length,
        score: typeof blockObj.score === 'number' ? blockObj.score : null,
        time_spent_seconds: typeof blockObj.timeSpentSeconds === 'number' ? blockObj.timeSpentSeconds : (blockObj.time_spent_seconds || 0),
        started_at: blockObj.createdAt || blockObj.started_at || now,
        saved_at: feStatus === 'SAVED' ? now : null,
        finished_at: (feStatus === 'COMPLETED' || feStatus === 'FINISHED') ? now : null,
        updated_at: now
      };

      const { data: upsertedRow, error: upsertErr } = await supabase
        .from('blocks')
        .upsert(blockRowData, { onConflict: 'custom_id' })
        .select()
        .single();

      if (upsertErr) {
        console.error("Error upserting block in Supabase:", upsertErr.message);
        return res.status(500).json({ error: upsertErr.message });
      }

      return res.json({
        synced: true,
        block: mapDbRowToBlock(upsertedRow, requesterId || userRow.telegram_id)
      });
    } catch (err: any) {
      console.error("Error in POST /api/blocks:", err);
      return res.status(500).json({ error: err.message || "Failed to create or update block." });
    }
  });

  // GET /api/blocks - Retrieve user's blocks
  app.get("/api/blocks", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const supabase = getSupabase();
      if (!supabase) {
        return res.json({ blocks: [], note: "Supabase client not configured." });
      }

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      if (!userRow || !userRow.id) {
        return res.json({ blocks: [] });
      }

      let query = supabase.from('blocks').select('*').eq('user_id', userRow.id);

      const statusFilter = req.query.status ? String(req.query.status).trim().toUpperCase() : null;
      if (statusFilter) {
        if (statusFilter === 'ACTIVE' || statusFilter === 'IN_PROGRESS') {
          query = query.in('status', ['in_progress', 'ACTIVE']);
        } else if (statusFilter === 'SAVED') {
          query = query.in('status', ['saved', 'SAVED']);
        } else if (statusFilter === 'COMPLETED' || statusFilter === 'FINISHED') {
          query = query.in('status', ['finished', 'completed', 'COMPLETED', 'FINISHED']);
        }
      }

      const bankIdFilter = req.query.bankId ? String(req.query.bankId).trim() : null;
      if (bankIdFilter) {
        query = query.eq('bank_id', bankIdFilter);
      }

      const { data: rows, error } = await query.order('updated_at', { ascending: false });

      if (error) {
        console.error("Error fetching blocks from Supabase:", error.message);
        return res.status(500).json({ error: error.message });
      }

      const mappedBlocks = (rows || []).map((row: any) => mapDbRowToBlock(row, requesterId || userRow.telegram_id));

      return res.json({ blocks: mappedBlocks });
    } catch (err: any) {
      console.error("Error in GET /api/blocks:", err);
      return res.status(500).json({ error: err.message || "Failed to fetch blocks." });
    }
  });

  // GET /api/blocks/:customId - Retrieve single block by customId
  app.get("/api/blocks/:customId", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const customId = req.params.customId;
      if (!customId) return res.status(400).json({ error: "customId parameter is required." });

      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: "Supabase client not configured." });

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      if (!userRow || !userRow.id) return res.status(404).json({ error: "User not found." });

      const { data: row, error } = await supabase
        .from('blocks')
        .select('*')
        .eq('custom_id', customId)
        .eq('user_id', userRow.id)
        .maybeSingle();

      if (error) return res.status(500).json({ error: error.message });
      if (!row) return res.status(404).json({ error: "Block not found or access denied." });

      return res.json({ block: mapDbRowToBlock(row, requesterId || userRow.telegram_id) });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/blocks/:customId - Update single block
  app.put("/api/blocks/:customId", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || req.body?.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || req.body?.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const customId = req.params.customId;
      if (!customId) return res.status(400).json({ error: "customId parameter is required." });

      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: "Supabase client not configured." });

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      if (!userRow || !userRow.id) return res.status(404).json({ error: "User not found." });

      // Verify block ownership
      const { data: existing } = await supabase
        .from('blocks')
        .select('id, user_id')
        .eq('custom_id', customId)
        .maybeSingle();

      if (!existing) {
        return res.status(404).json({ error: "Block not found." });
      }
      if (existing.user_id !== userRow.id) {
        return res.status(403).json({ error: "Access denied: Block belongs to another user." });
      }

      const updates = req.body?.block || req.body || {};
      const now = new Date().toISOString();

      const updateData: Record<string, any> = {
        updated_at: now
      };

      if (updates.currentIndex !== undefined) updateData.current_question_index = updates.currentIndex;
      if (updates.questionIds !== undefined) {
        updateData.question_ids = updates.questionIds;
        updateData.total_questions = updates.questionIds.length;
      }
      if (updates.filters !== undefined) updateData.filters = updates.filters;
      if (updates.answers !== undefined) updateData.answers = updates.answers;
      if (updates.annotations !== undefined) updateData.annotations = updates.annotations;
      if (updates.score !== undefined) updateData.score = updates.score;
      if (updates.timeSpentSeconds !== undefined) updateData.time_spent_seconds = updates.timeSpentSeconds;

      if (updates.status !== undefined) {
        const feStatus = String(updates.status).toUpperCase();
        if (feStatus === 'SAVED') {
          updateData.status = 'saved';
          updateData.saved_at = now;
        } else if (feStatus === 'COMPLETED' || feStatus === 'FINISHED') {
          updateData.status = 'finished';
          updateData.finished_at = now;
        } else {
          updateData.status = 'in_progress';
        }
      }

      const { data: updatedRow, error: updateErr } = await supabase
        .from('blocks')
        .update(updateData)
        .eq('custom_id', customId)
        .eq('user_id', userRow.id)
        .select()
        .single();

      if (updateErr) return res.status(500).json({ error: updateErr.message });

      return res.json({
        synced: true,
        block: mapDbRowToBlock(updatedRow, requesterId || userRow.telegram_id)
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/blocks/:customId
  app.delete("/api/blocks/:customId", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required." });
      }

      const customId = req.params.customId;
      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: "Supabase client not configured." });

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      if (!userRow || !userRow.id) return res.status(404).json({ error: "User not found." });

      const { error } = await supabase
        .from('blocks')
        .delete()
        .eq('custom_id', customId)
        .eq('user_id', userRow.id);

      if (error) return res.status(500).json({ error: error.message });

      return res.json({ deleted: true, customId });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Helper: map DB flashcard row to frontend model
  function mapDbRowToFlashcard(row: any): any {
    return {
      id: row.custom_id,
      question: row.question || '',
      answer: row.answer || '',
      front: row.question || '',
      back: row.answer || '',
      questionId: row.question_id || null,
      major: row.major || null,
      topic: row.topic || null,
      isCustom: row.is_custom ?? false,
      easeFactor: row.ease_factor ?? 2.5,
      interval: row.interval ?? 0,
      repetitions: row.repetitions ?? 0,
      nextReviewDate: row.next_review_date || null,
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt: row.updated_at || new Date().toISOString()
    };
  }

  // ==========================================
  // PHASE 5: FLASHCARDS ENDPOINTS
  // ==========================================

  // GET /api/flashcards - Retrieve global + user's personal flashcards
  app.get("/api/flashcards", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const supabase = getSupabase();
      if (!supabase) {
        return res.json({ flashcards: [], note: "Supabase client not configured." });
      }

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      if (!userRow || !userRow.id) {
        return res.json({ flashcards: [] });
      }

      // Query global flashcards (user_id IS NULL) OR user's personal flashcards (user_id = userRow.id)
      const { data: rows, error } = await supabase
        .from('flashcards')
        .select('*')
        .or(`user_id.is.null,user_id.eq.${userRow.id}`)
        .order('created_at', { ascending: false });

      if (error) {
        console.error("Error fetching flashcards from Supabase:", error.message);
        return res.status(500).json({ error: error.message });
      }

      const mappedFlashcards = (rows || []).map(mapDbRowToFlashcard);
      return res.json({ flashcards: mappedFlashcards });
    } catch (err: any) {
      console.error("Error in GET /api/flashcards:", err);
      return res.status(500).json({ error: err.message || "Failed to fetch flashcards." });
    }
  });

  // POST /api/flashcards - Create or upsert a flashcard
  app.post("/api/flashcards", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || req.body?.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || req.body?.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: "Supabase client not configured." });

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      if (!userRow || !userRow.id) return res.status(404).json({ error: "User not found." });

      const isUserAdmin = userRow.role === 'admin' || verifyServerAdminAuthorization(requesterId) || verifyServerAdminAuthorization(requesterUsername);

      const cardData = req.body?.flashcard || req.body || {};
      const questionText = (cardData.question || cardData.front || '').trim();
      const answerText = (cardData.answer || cardData.back || '').trim();

      if (!questionText || !answerText) {
        return res.status(400).json({ error: "Question and answer text are required." });
      }

      const customId = (cardData.id || `fc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`).trim();

      // Check if flashcard with this custom_id already exists
      const { data: existing } = await supabase
        .from('flashcards')
        .select('id, user_id, custom_id')
        .eq('custom_id', customId)
        .maybeSingle();

      if (existing) {
        // Enforce ownership:
        // - Personal card belonging to another user: FORBIDDEN
        if (existing.user_id && existing.user_id !== userRow.id) {
          return res.status(403).json({ error: "Access denied: Cannot modify another user's personal flashcard." });
        }
        // - Global card: Allowed ONLY if requester is admin
        if (!existing.user_id && !isUserAdmin) {
          return res.status(403).json({ error: "Access denied: Normal users cannot modify global flashcards." });
        }
      }

      // Determine ownership for new/upserted card:
      let targetUserId: string | null = userRow.id;
      let targetIsCustom = true;

      if (isUserAdmin && (cardData.isCustom === false || cardData.isGlobal === true)) {
        targetUserId = null;
        targetIsCustom = false;
      }

      const now = new Date().toISOString();
      const payload = {
        custom_id: customId,
        user_id: targetUserId,
        question: questionText,
        answer: answerText,
        question_id: cardData.questionId || null,
        major: cardData.major || null,
        topic: cardData.topic || null,
        is_custom: targetIsCustom,
        ease_factor: cardData.easeFactor ?? 2.5,
        interval: cardData.interval ?? 0,
        repetitions: cardData.repetitions ?? 0,
        next_review_date: cardData.nextReviewDate || null,
        updated_at: now
      };

      const { data: upsertedRow, error: upsertErr } = await supabase
        .from('flashcards')
        .upsert(payload, { onConflict: 'custom_id' })
        .select()
        .single();

      if (upsertErr) {
        console.error("Error upserting flashcard in Supabase:", upsertErr.message);
        return res.status(500).json({ error: upsertErr.message });
      }

      return res.json({
        synced: true,
        flashcard: mapDbRowToFlashcard(upsertedRow)
      });
    } catch (err: any) {
      console.error("Error in POST /api/flashcards:", err);
      return res.status(500).json({ error: err.message || "Failed to create/upsert flashcard." });
    }
  });

  // PUT /api/flashcards/:customId - Modify an existing flashcard
  app.put("/api/flashcards/:customId", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || req.body?.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || req.body?.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const customId = req.params.customId;
      if (!customId) return res.status(400).json({ error: "customId parameter is required." });

      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: "Supabase client not configured." });

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      if (!userRow || !userRow.id) return res.status(404).json({ error: "User not found." });

      const isUserAdmin = userRow.role === 'admin' || verifyServerAdminAuthorization(requesterId) || verifyServerAdminAuthorization(requesterUsername);

      // Verify flashcard existence and ownership
      const { data: existing } = await supabase
        .from('flashcards')
        .select('*')
        .eq('custom_id', customId)
        .maybeSingle();

      if (!existing) {
        return res.status(404).json({ error: "Flashcard not found." });
      }

      // Check access permission:
      // - Allowed if personal card belongs to authenticated user
      // - Allowed if global card and user is admin
      const isOwner = existing.user_id === userRow.id;
      const isGlobalAndAdmin = existing.user_id === null && isUserAdmin;

      if (!isOwner && !isGlobalAndAdmin) {
        return res.status(403).json({ error: "Access denied: You do not have permission to modify this flashcard." });
      }

      const updates = req.body?.flashcard || req.body || {};
      const now = new Date().toISOString();
      const updatePayload: Record<string, any> = {
        updated_at: now
      };

      if (updates.question !== undefined || updates.front !== undefined) {
        updatePayload.question = (updates.question || updates.front || '').trim();
      }
      if (updates.answer !== undefined || updates.back !== undefined) {
        updatePayload.answer = (updates.answer || updates.back || '').trim();
      }
      if (updates.questionId !== undefined) updatePayload.question_id = updates.questionId || null;
      if (updates.major !== undefined) updatePayload.major = updates.major || null;
      if (updates.topic !== undefined) updatePayload.topic = updates.topic || null;
      if (updates.easeFactor !== undefined) updatePayload.ease_factor = updates.easeFactor;
      if (updates.interval !== undefined) updatePayload.interval = updates.interval;
      if (updates.repetitions !== undefined) updatePayload.repetitions = updates.repetitions;
      if (updates.nextReviewDate !== undefined) updatePayload.next_review_date = updates.nextReviewDate || null;

      const { data: updatedRow, error: updateErr } = await supabase
        .from('flashcards')
        .update(updatePayload)
        .eq('custom_id', customId)
        .select()
        .single();

      if (updateErr) return res.status(500).json({ error: updateErr.message });

      return res.json({
        synced: true,
        flashcard: mapDbRowToFlashcard(updatedRow)
      });
    } catch (err: any) {
      console.error("Error in PUT /api/flashcards/:customId:", err);
      return res.status(500).json({ error: err.message || "Failed to update flashcard." });
    }
  });

  // DELETE /api/flashcards/:customId - Delete a flashcard
  app.delete("/api/flashcards/:customId", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required." });
      }

      const customId = req.params.customId;
      if (!customId) return res.status(400).json({ error: "customId parameter is required." });

      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: "Supabase client not configured." });

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      if (!userRow || !userRow.id) return res.status(404).json({ error: "User not found." });

      const isUserAdmin = userRow.role === 'admin' || verifyServerAdminAuthorization(requesterId) || verifyServerAdminAuthorization(requesterUsername);

      const { data: existing } = await supabase
        .from('flashcards')
        .select('id, user_id')
        .eq('custom_id', customId)
        .maybeSingle();

      if (!existing) {
        return res.status(404).json({ error: "Flashcard not found." });
      }

      const isOwner = existing.user_id === userRow.id;
      const isGlobalAndAdmin = existing.user_id === null && isUserAdmin;

      if (!isOwner && !isGlobalAndAdmin) {
        return res.status(403).json({ error: "Access denied: You do not have permission to delete this flashcard." });
      }

      const { error: deleteErr } = await supabase
        .from('flashcards')
        .delete()
        .eq('custom_id', customId);

      if (deleteErr) return res.status(500).json({ error: deleteErr.message });

      return res.json({ deleted: true, customId });
    } catch (err: any) {
      console.error("Error in DELETE /api/flashcards/:customId:", err);
      return res.status(500).json({ error: err.message || "Failed to delete flashcard." });
    }
  });

  // Phase 6: Admin Infrastructure & Live Telemetry Endpoints
  let serverAdminConfig = {
    paymentPhoneNumber: '079 812 3456',
    paymentAccountName: 'Saif Al-Deen (U JO TAJNEED)',
    subscriptionPrice: 25,
    subscriptionDurationDays: 30,
    paymentInstructions: 'Transfer via Zain Cash or CliQ to the phone number above. Enter your Telegram username and optional transaction reference ID when submitting.'
  };

  // GET /api/admin/flashcard-feedback - admin-only list of all flashcard
  // feedback (mirrors GET /api/admin/question-feedback exactly).
  app.get("/api/admin/flashcard-feedback", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: "Supabase client not configured." });

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      const isAuthorizedAdmin =
        (userRow && userRow.role === 'admin') ||
        verifyServerAdminAuthorization(requesterId) ||
        verifyServerAdminAuthorization(requesterUsername);

      if (!isAuthorizedAdmin) {
        return res.status(403).json({ error: "Access denied: Administrator privileges required." });
      }

      const { data: feedbackRows, error } = await supabase
        .from('flashcard_feedback')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        if (error.code === '42P01') {
          return res.json({ feedback: [] });
        }
        return res.status(500).json({ error: error.message });
      }

      const flashcardIds = Array.from(new Set((feedbackRows || []).map((r: any) => r.flashcard_id).filter(Boolean)));
      const cardMap = new Map<string, any>();
      if (flashcardIds.length > 0) {
        const { data: cRows } = await supabase
          .from('flashcards')
          .select('id, question, answer')
          .in('id', flashcardIds);
        (cRows || []).forEach((c: any) => cardMap.set(String(c.id), c));
      }

      const userIds = Array.from(new Set((feedbackRows || []).map((r: any) => r.user_id).filter(Boolean)));
      const userMap = new Map<string, any>();
      if (userIds.length > 0) {
        const { data: uRows } = await supabase
          .from('users')
          .select('id, full_name, telegram_username, telegram_id')
          .in('id', userIds);
        (uRows || []).forEach((u: any) => userMap.set(String(u.id), u));
      }

      const mapped = (feedbackRows || []).map((row: any) => {
        const c = cardMap.get(String(row.flashcard_id));
        const reporter = row.user_id ? userMap.get(String(row.user_id)) : null;
        return {
          id: row.id,
          flashcardId: row.flashcard_id,
          flashcardQuestionPreview: c?.question ? String(c.question).slice(0, 200) : null,
          flashcardAnswerPreview: c?.answer ? String(c.answer).slice(0, 200) : null,
          message: row.message || null,
          reporterName: reporter?.full_name || (reporter?.telegram_username ? `@${reporter.telegram_username}` : null) || row.telegram_id || 'Unknown',
          resolved: Boolean(row.resolved),
          createdAt: row.created_at
        };
      });

      return res.json({ feedback: mapped });
    } catch (err: any) {
      console.error("Error in GET /api/admin/flashcard-feedback:", err);
      return res.status(500).json({ error: err.message || "Failed to fetch flashcard feedback." });
    }
  });

  // POST /api/admin/flashcard-feedback/:id/resolve
  app.post("/api/admin/flashcard-feedback/:id/resolve", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;

      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: "Supabase client not configured." });

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      const isAuthorizedAdmin =
        (userRow && userRow.role === 'admin') ||
        verifyServerAdminAuthorization(requesterId) ||
        verifyServerAdminAuthorization(requesterUsername);

      if (!isAuthorizedAdmin) {
        return res.status(403).json({ error: "Access denied: Administrator privileges required." });
      }

      const feedbackId = req.params.id;
      const resolvedValue = req.body?.resolved !== false;

      const { error } = await supabase
        .from('flashcard_feedback')
        .update({ resolved: resolvedValue })
        .eq('id', feedbackId);

      if (error) return res.status(500).json({ error: error.message });

      return res.json({ success: true });
    } catch (err: any) {
      console.error("Error in POST /api/admin/flashcard-feedback/:id/resolve:", err);
      return res.status(500).json({ error: err.message || "Failed to update feedback status." });
    }
  });

  // GET /api/admin/question-feedback - admin-only list of all feedback
  // submitted by users on questions, so the admin can jump straight to
  // fixing the flagged question. Schema-safe: if question_feedback doesn't
  // exist yet, returns an empty list rather than erroring the dashboard.
  app.get("/api/admin/question-feedback", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: "Supabase client not configured." });

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      const isAuthorizedAdmin =
        (userRow && userRow.role === 'admin') ||
        verifyServerAdminAuthorization(requesterId) ||
        verifyServerAdminAuthorization(requesterUsername);

      if (!isAuthorizedAdmin) {
        return res.status(403).json({ error: "Access denied: Administrator privileges required." });
      }

      const { data: feedbackRows, error } = await supabase
        .from('question_feedback')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        if (error.code === '42P01') {
          // Table not migrated yet — treat as "no feedback" rather than an error.
          return res.json({ feedback: [] });
        }
        return res.status(500).json({ error: error.message });
      }

      const questionIds = Array.from(new Set((feedbackRows || []).map((r: any) => r.question_id).filter(Boolean)));
      const questionMap = new Map<string, any>();
      if (questionIds.length > 0) {
        const { data: qRows } = await supabase
          .from('questions')
          .select('id, question, major, topic, year')
          .in('id', questionIds);
        (qRows || []).forEach((q: any) => questionMap.set(String(q.id), q));
      }

      const userIds = Array.from(new Set((feedbackRows || []).map((r: any) => r.user_id).filter(Boolean)));
      const userMap = new Map<string, any>();
      if (userIds.length > 0) {
        const { data: uRows } = await supabase
          .from('users')
          .select('id, full_name, telegram_username, telegram_id')
          .in('id', userIds);
        (uRows || []).forEach((u: any) => userMap.set(String(u.id), u));
      }

      const mapped = (feedbackRows || []).map((row: any) => {
        const q = questionMap.get(String(row.question_id));
        const reporter = row.user_id ? userMap.get(String(row.user_id)) : null;
        return {
          id: row.id,
          questionId: row.question_id,
          questionPreview: q?.question ? String(q.question).slice(0, 200) : null,
          questionMajor: q?.major || null,
          questionTopic: q?.topic || null,
          questionYear: q?.year || null,
          message: row.message || null,
          reporterName: reporter?.full_name || (reporter?.telegram_username ? `@${reporter.telegram_username}` : null) || row.telegram_id || 'Unknown',
          resolved: Boolean(row.resolved),
          createdAt: row.created_at
        };
      });

      return res.json({ feedback: mapped });
    } catch (err: any) {
      console.error("Error in GET /api/admin/question-feedback:", err);
      return res.status(500).json({ error: err.message || "Failed to fetch question feedback." });
    }
  });

  // POST /api/admin/question-feedback/:id/resolve - marks a feedback entry
  // as handled (does not touch the underlying question — purely a
  // dashboard bookkeeping flag).
  app.post("/api/admin/question-feedback/:id/resolve", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;

      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: "Supabase client not configured." });

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      const isAuthorizedAdmin =
        (userRow && userRow.role === 'admin') ||
        verifyServerAdminAuthorization(requesterId) ||
        verifyServerAdminAuthorization(requesterUsername);

      if (!isAuthorizedAdmin) {
        return res.status(403).json({ error: "Access denied: Administrator privileges required." });
      }

      const feedbackId = req.params.id;
      const resolvedValue = req.body?.resolved !== false;

      const { error } = await supabase
        .from('question_feedback')
        .update({ resolved: resolvedValue })
        .eq('id', feedbackId);

      if (error) return res.status(500).json({ error: error.message });

      return res.json({ success: true });
    } catch (err: any) {
      console.error("Error in POST /api/admin/question-feedback/:id/resolve:", err);
      return res.status(500).json({ error: err.message || "Failed to update feedback status." });
    }
  });

  app.get("/api/admin/metrics", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const supabase = getSupabase();
      if (!supabase) {
        return res.status(500).json({ error: "Supabase client not configured." });
      }

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      const isAuthorizedAdmin =
        (userRow && userRow.role === 'admin') ||
        verifyServerAdminAuthorization(requesterId) ||
        verifyServerAdminAuthorization(requesterUsername);

      if (!isAuthorizedAdmin) {
        return res.status(403).json({ error: "Access denied: Administrator privileges required." });
      }

      // 1. Total Users
      const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });

      // 2. Subscriptions
      const { count: activeSubscribers } = await supabase
        .from('subscriptions')
        .select('*', { count: 'exact', head: true })
        .or('status.eq.active,status.eq.ACTIVE');

      const { count: expiredSubscribers } = await supabase
        .from('subscriptions')
        .select('*', { count: 'exact', head: true })
        .or('status.eq.expired,status.eq.EXPIRED');

      // 3. Payments
      const { count: pendingPaymentRequests } = await supabase
        .from('payments')
        .select('*', { count: 'exact', head: true })
        .or('status.eq.pending,status.eq.PENDING');

      // 4. Questions Solved
      const { count: questionsSolved } = await supabase
        .from('question_progress')
        .select('*', { count: 'exact', head: true });

      // 5. Active Blocks
      const { count: activeBlocks } = await supabase
        .from('blocks')
        .select('*', { count: 'exact', head: true })
        .or('status.eq.in_progress,status.eq.ACTIVE');

      // 6. Recently Active Users (last 7 days)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const { count: recentlyActiveUsers } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .gte('updated_at', sevenDaysAgo);

      return res.json({
        metrics: {
          totalUsers: totalUsers || 0,
          activeSubscribers: activeSubscribers || 0,
          expiredSubscribers: expiredSubscribers || 0,
          pendingPaymentRequests: pendingPaymentRequests || 0,
          questionsSolved: questionsSolved || 0,
          activeBlocks: activeBlocks || 0,
          recentlyActiveUsers: recentlyActiveUsers || 0
        }
      });
    } catch (err: any) {
      console.error("Error in GET /api/admin/metrics:", err);
      return res.status(500).json({ error: err.message || "Failed to fetch admin metrics." });
    }
  });

  // GET /api/admin/users
  app.get("/api/admin/users", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const supabase = getSupabase();
      if (!supabase) {
        return res.status(500).json({ error: "Supabase client not configured." });
      }

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      const isAuthorizedAdmin =
        (userRow && userRow.role === 'admin') ||
        verifyServerAdminAuthorization(requesterId) ||
        verifyServerAdminAuthorization(requesterUsername);

      if (!isAuthorizedAdmin) {
        return res.status(403).json({ error: "Access denied: Administrator privileges required." });
      }

      const search = req.query.q || req.query.search || req.query.query;
      let query = supabase.from('users').select('*');

      if (search) {
        const qStr = String(search).trim();
        if (/^\d+$/.test(qStr)) {
          query = query.or(`telegram_id.eq.${parseInt(qStr, 10)},telegram_username.ilike.%${qStr}%,full_name.ilike.%${qStr}%,email.ilike.%${qStr}%`);
        } else {
          query = query.or(`telegram_username.ilike.%${qStr}%,full_name.ilike.%${qStr}%,email.ilike.%${qStr}%`);
        }
      }

      const { data: users, error } = await query.order('created_at', { ascending: false });
      if (error) {
        console.error("Error fetching admin users from Supabase:", error.message);
        return res.status(500).json({ error: error.message });
      }

      // ROOT CAUSE FIX (Cancel Subscription button not flipping): this query
      // previously had no ordering, and the dedup logic below preferred ANY
      // row with status='active' over a more recent cancelled/expired row,
      // regardless of which one was actually newest. A user with more than
      // one subscriptions row (common after repeated approve/cancel/
      // re-approve cycles during testing) would keep showing as ACTIVE here
      // even after a genuinely successful, confirmed cancellation, because
      // an older leftover 'active' row was still winning the dedup. This now
      // orders by created_at descending and keeps only the first (i.e. most
      // recent) row per user — the same "one authoritative row per user"
      // rule already used by resolveAuthoritativeUserSubscription() and the
      // single-user detail endpoint, so all three agree everywhere.
      const { data: subs } = await supabase
        .from('subscriptions')
        .select('*')
        .order('created_at', { ascending: false });
      const subsMap = new Map<string, any>();
      if (subs) {
        subs.forEach((s: any) => {
          const isSubActive = String(s.status).toUpperCase() === 'ACTIVE' && (!s.expires_at || new Date(s.expires_at).getTime() > Date.now());
          const subObj = { ...s, isActiveSub: isSubActive };

          if (s.user_id) {
            const key = String(s.user_id);
            // Rows arrive newest-first due to the ordering above, so the
            // FIRST row seen for a given user_id is authoritative — do not
            // let an older row (processed later) override it, active or not.
            if (!subsMap.has(key)) {
              subsMap.set(key, subObj);
            }
          }
        });
      }

      // ROOT CAUSE FIX (Solved Questions always showing 0): the Admin
      // Dashboard user list previously displayed a "Solved Questions" count
      // computed entirely from localStorage on the ADMIN'S OWN device
      // (getUserDetails -> getUserStudyStats -> getAllStoredBlocks, all
      // client-side only, never touching Supabase). Telegram's in-app
      // WebView uses a separate, isolated storage partition from any
      // regular browser on the same device, so that localStorage was
      // essentially always empty there — showing 0 for every user
      // regardless of their real progress. This aggregates the real solved
      // count per user directly from Supabase in one query, so it is
      // identical and authoritative in every environment.
      const solvedCountMap = new Map<string, number>();
      try {
        const { data: progressRows } = await supabase
          .from('question_progress')
          .select('user_id');
        if (progressRows) {
          progressRows.forEach((row: any) => {
            if (!row.user_id) return;
            const key = String(row.user_id);
            solvedCountMap.set(key, (solvedCountMap.get(key) || 0) + 1);
          });
        }
      } catch (progressErr: any) {
        console.warn(`[SUB_AUTH] Failed to aggregate solved-question counts for admin user list: ${progressErr?.message}`);
      }

      const mappedUsers = (users || []).map((u: any) => {
        const parts = String(u.full_name || '').split(' ');
        const firstName = parts[0] || 'Resident';
        const lastName = parts.slice(1).join(' ') || '';
        const userSub = subsMap.get(u.id) || (u.telegram_id ? subsMap.get(String(u.telegram_id)) : null);

        let subStatus = 'NONE';
        if (userSub) {
          if (userSub.isActiveSub) {
            subStatus = 'ACTIVE';
          } else if (userSub.expires_at && new Date(userSub.expires_at).getTime() <= Date.now()) {
            subStatus = 'EXPIRED';
          } else {
            subStatus = String(userSub.status).toUpperCase();
          }
        }

        return {
          id: u.id,
          telegramId: String(u.telegram_id || ''),
          username: u.telegram_username || undefined,
          firstName,
          lastName,
          email: u.email || null,
          role: (u.role || 'user') as 'user' | 'admin',
          isActive: isUserAccountActive(u),
          firstSeenAt: u.created_at || new Date().toISOString(),
          lastActiveAt: u.updated_at || new Date().toISOString(),
          subscriptionStatus: subStatus,
          solvedCount: solvedCountMap.get(String(u.id)) || 0,
          recentBlockActivity: (blockActivityByUser.get(String(u.id)) || []).filter((t) => Date.now() - t < BEHAVIOR_WINDOW_MS).length,
          suspiciousActivity: (blockActivityByUser.get(String(u.id)) || []).filter((t) => Date.now() - t < BEHAVIOR_WINDOW_MS).length > BEHAVIOR_SUSPICIOUS_THRESHOLD
        };
      });

      return res.json({ users: mappedUsers });
    } catch (err: any) {
      console.error("Error in GET /api/admin/users:", err);
      return res.status(500).json({ error: err.message || "Failed to fetch admin users." });
    }
  });

  // GET /api/admin/users/:userId
  app.get("/api/admin/users/:userId", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const targetUserId = req.params.userId;
      if (!targetUserId) {
        return res.status(400).json({ error: "userId parameter is required." });
      }

      const supabase = getSupabase();
      if (!supabase) {
        return res.status(500).json({ error: "Supabase client not configured." });
      }

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      const isAuthorizedAdmin =
        (userRow && userRow.role === 'admin') ||
        verifyServerAdminAuthorization(requesterId) ||
        verifyServerAdminAuthorization(requesterUsername);

      if (!isAuthorizedAdmin) {
        return res.status(403).json({ error: "Access denied: Administrator privileges required." });
      }

      let userQuery = supabase.from('users').select('*');
      if (/^[0-9a-fA-F-]{36}$/.test(targetUserId)) {
        userQuery = userQuery.eq('id', targetUserId);
      } else if (/^\d+$/.test(targetUserId)) {
        userQuery = userQuery.eq('telegram_id', parseInt(targetUserId, 10));
      } else {
        userQuery = userQuery.eq('telegram_username', targetUserId);
      }

      const { data: targetUser, error: userErr } = await userQuery.maybeSingle();
      if (userErr) {
        return res.status(500).json({ error: userErr.message });
      }
      if (!targetUser) {
        return res.status(404).json({ error: "Target user not found." });
      }

      const { data: subscriptions } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', targetUser.id)
        .order('created_at', { ascending: false });

      const { data: progressRows } = await supabase
        .from('question_progress')
        .select('*')
        .eq('user_id', targetUser.id);

      const totalQuestionsSolved = progressRows ? progressRows.length : 0;
      const totalCorrect = progressRows ? progressRows.filter((p: any) => p.is_correct).length : 0;
      const totalIncorrect = totalQuestionsSolved - totalCorrect;
      const accuracyPercentage = totalQuestionsSolved > 0 ? Math.round((totalCorrect / totalQuestionsSolved) * 100) : 0;

      const { data: userBlocks } = await supabase
        .from('blocks')
        .select('*')
        .eq('user_id', targetUser.id);

      const blocksCompleted = userBlocks ? userBlocks.filter((b: any) => String(b.status).toLowerCase() === 'finished' || String(b.status).toLowerCase() === 'completed').length : 0;
      const activeBlocksCount = userBlocks ? userBlocks.filter((b: any) => String(b.status).toLowerCase() === 'in_progress' || String(b.status).toLowerCase() === 'active').length : 0;

      const parts = String(targetUser.full_name || '').split(' ');
      const userObj = {
        id: targetUser.id,
        telegramId: String(targetUser.telegram_id || ''),
        username: targetUser.telegram_username || undefined,
        firstName: parts[0] || 'Resident',
        lastName: parts.slice(1).join(' ') || '',
        fullName: targetUser.full_name || null,
        email: targetUser.email || null,
        role: (targetUser.role || 'user') as 'user' | 'admin',
        isActive: targetUser.is_active !== false,
        firstSeenAt: targetUser.created_at || new Date().toISOString(),
        lastActiveAt: targetUser.updated_at || new Date().toISOString()
      };

      const latestSub = subscriptions && subscriptions.length > 0 ? subscriptions[0] : null;
      const subscriptionObj = latestSub ? {
        userId: userObj.telegramId,
        bankId: latestSub.bank_id || 'human_medicine',
        status: (String(latestSub.status).toUpperCase() === 'ACTIVE' ? 'ACTIVE' : 'EXPIRED') as any,
        plan: latestSub.plan || 'MOH Pass',
        startDate: latestSub.created_at,
        expiryDate: latestSub.expires_at
      } : {
        userId: userObj.telegramId,
        bankId: 'human_medicine',
        status: 'INACTIVE' as any,
        plan: 'No Active Subscription'
      };

      return res.json({
        user: userObj,
        subscription: subscriptionObj,
        subscriptions: subscriptions || [],
        studyStats: {
          totalQuestionsSolved,
          totalCorrect,
          totalIncorrect,
          accuracyPercentage,
          blocksCompleted,
          activeBlocksCount,
          lastActivityDate: targetUser.updated_at
        }
      });
    } catch (err: any) {
      console.error("Error in GET /api/admin/users/:userId:", err);
      return res.status(500).json({ error: err.message || "Failed to fetch user details." });
    }
  });

  // PATCH /api/admin/users/:userId/status - Change user account active/inactive status
  app.patch("/api/admin/users/:userId/status", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const targetUserId = req.params.userId;
      if (!targetUserId) {
        return res.status(400).json({ error: "userId parameter is required." });
      }

      const supabase = getSupabase();
      if (!supabase) {
        return res.status(500).json({ error: "Supabase client not configured." });
      }

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      const isAuthorizedAdmin =
        (userRow && userRow.role === 'admin') ||
        verifyServerAdminAuthorization(requesterId) ||
        verifyServerAdminAuthorization(requesterUsername);

      if (!isAuthorizedAdmin) {
        return res.status(403).json({ error: "Access denied: Administrator privileges required." });
      }

      const isActiveInput = req.body?.is_active ?? req.body?.isActive ?? (req.body?.status === 'ACTIVE' || req.body?.status === true);
      const newActiveStatus = Boolean(isActiveInput);

      let userQuery = supabase.from('users').select('*');
      if (/^[0-9a-fA-F-]{36}$/.test(targetUserId)) {
        userQuery = userQuery.eq('id', targetUserId);
      } else if (/^\d+$/.test(targetUserId)) {
        userQuery = userQuery.eq('telegram_id', parseInt(targetUserId, 10));
      } else {
        userQuery = userQuery.eq('telegram_username', targetUserId);
      }

      const { data: targetUser } = await userQuery.maybeSingle();

      if (!targetUser) {
        return res.status(404).json({ error: "Target user not found." });
      }

      if (!newActiveStatus) {
        if (targetUser.id) disabledUserIds.add(targetUser.id);
        if (targetUser.telegram_id) disabledUserIds.add(String(targetUser.telegram_id));
      } else {
        if (targetUser.id) disabledUserIds.delete(targetUser.id);
        if (targetUser.telegram_id) disabledUserIds.delete(String(targetUser.telegram_id));
      }

      // ROOT CAUSE FIX: this previously only updated `updated_at` and relied
      // entirely on the in-memory `disabledUserIds` Set above to represent
      // the disabled/enabled state. That Set lives only in server RAM and is
      // wiped on every restart or redeploy, so the account-active toggle
      // silently reverted to "active" after any deploy — while the button in
      // the Admin Dashboard, which reads `isActive` from this same Supabase
      // row via isUserAccountActive(), never reflected the real intended
      // state once the process restarted. `is_active` is now written to the
      // actual database row, matching what isUserAccountActive() already
      // reads, so the state survives restarts and both server and DB agree.
      // Schema-safe: if the `is_active` column somehow doesn't exist, retry
      // without it so the request doesn't hard-fail, but log clearly so this
      // is diagnosable — the in-memory Set still provides same-process
      // coverage as a fallback in that case.
      let { data: updatedUser, error: statusUpdateErr } = await supabase
        .from('users')
        .update({
          is_active: newActiveStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', targetUser.id)
        .select()
        .maybeSingle();

      if (statusUpdateErr && statusUpdateErr.code === '42703') {
        console.warn(`[SUB_AUTH] users.is_active column not found — falling back to in-memory-only account status for userDbId=${targetUser.id}. This will NOT survive a server restart.`);
        const retry = await supabase
          .from('users')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', targetUser.id)
          .select()
          .maybeSingle();
        updatedUser = retry.data;
      } else if (statusUpdateErr) {
        console.error(`[SUB_AUTH] Failed to persist is_active for userDbId=${targetUser.id}: ${statusUpdateErr.message}`);
      }

      console.log(`[SUB_AUTH] userDbId=${targetUser.id} telegramId=${targetUser.telegram_id} is_active=${newActiveStatus} persisted=${!statusUpdateErr}`);

      return res.json({
        success: true,
        is_active: newActiveStatus,
        user: updatedUser || targetUser
      });
    } catch (err: any) {
      console.error("Error in PATCH /api/admin/users/:userId/status:", err);
      return res.status(500).json({ error: err.message || "Failed to update user status." });
    }
  });

  // POST /api/admin/users/:userId/subscription/extend - Extend subscription by days
  app.post("/api/admin/users/:userId/subscription/extend", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const targetUserId = req.params.userId;
      const days = Number(req.body?.days || 30);

      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: "Supabase client not configured." });

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      const isAuthorizedAdmin =
        (userRow && userRow.role === 'admin') ||
        verifyServerAdminAuthorization(requesterId) ||
        verifyServerAdminAuthorization(requesterUsername);

      if (!isAuthorizedAdmin) {
        return res.status(403).json({ error: "Access denied: Administrator privileges required." });
      }

      let userQuery = supabase.from('users').select('*');
      if (/^[0-9a-fA-F-]{36}$/.test(targetUserId)) {
        userQuery = userQuery.eq('id', targetUserId);
      } else if (/^\d+$/.test(targetUserId)) {
        userQuery = userQuery.eq('telegram_id', parseInt(targetUserId, 10));
      } else {
        userQuery = userQuery.eq('telegram_username', targetUserId);
      }

      const { data: targetUser } = await userQuery.maybeSingle();
      if (!targetUser) return res.status(404).json({ error: "Target user not found." });

      const tgIdStr = String(targetUser.telegram_id || targetUserId);

      const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', targetUser.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const baseTime = (existingSub && (String(existingSub.status).toLowerCase() === 'active' || String(existingSub.status).toLowerCase() === 'approved') && existingSub.expires_at)
        ? Math.max(Date.now(), new Date(existingSub.expires_at).getTime())
        : Date.now();

      const expiresAt = new Date(baseTime + days * 24 * 3600 * 1000).toISOString();
      const now = new Date().toISOString();

      let subscriptionRow: any = null;

      if (existingSub) {
        const { data: updatedSub, error: updateErr } = await supabase
          .from('subscriptions')
          .update({
            status: 'active',
            user_id: targetUser.id,
            expires_at: expiresAt,
            updated_at: now
          })
          .eq('id', existingSub.id)
          .select()
          .single();

        if (updateErr) return res.status(500).json({ error: updateErr.message });
        subscriptionRow = updatedSub;
      } else {
        const { data: insertedSub, error: insertErr } = await supabase
          .from('subscriptions')
          .insert({
            user_id: targetUser.id,
            status: 'active',
            started_at: now,
            created_at: now,
            expires_at: expiresAt,
            updated_at: now
          })
          .select()
          .single();

        if (insertErr) return res.status(500).json({ error: insertErr.message });
        subscriptionRow = insertedSub;
      }

      const logTag = existingSub && String(existingSub.status).toLowerCase() === 'active' ? 'SUB_EXTEND' : 'SUB_ACTIVATE';
      console.log(`[${logTag}] userDbId=${targetUser.id} telegramId=${tgIdStr} subscriptionId=${subscriptionRow.id} days=${days} expiresAt=${expiresAt}`);

      // PART 6 requirement: notify the user their access was activated/extended.
      try {
        if (targetUser.telegram_id) {
          const msg = `✅ تم تفعيل/تمديد اشتراكك من قبل الإدارة.\n📅 ينتهي الاشتراك في: ${new Date(expiresAt).toLocaleDateString('en-GB')}\n\nيمكنك الآن الدخول إلى المنصة.`;
          await sendTelegramMessage(targetUser.telegram_id, msg);
        }
      } catch (notifyErr: any) {
        console.error(`[${logTag}] Telegram notification failed for userDbId=${targetUser.id}:`, notifyErr?.message || notifyErr);
      }

      return res.json({ success: true, subscription: subscriptionRow });
    } catch (err: any) {
      console.error("Error extending subscription:", err);
      return res.status(500).json({ error: err.message || "Failed to extend subscription." });
    }
  });

  // POST /api/admin/users/:userId/subscription/cancel - Cancel / Deactivate subscription
  app.post("/api/admin/users/:userId/subscription/cancel", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const targetUserId = req.params.userId;
      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: "Supabase client not configured." });

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      const isAuthorizedAdmin =
        (userRow && userRow.role === 'admin') ||
        verifyServerAdminAuthorization(requesterId) ||
        verifyServerAdminAuthorization(requesterUsername);

      if (!isAuthorizedAdmin) {
        return res.status(403).json({ error: "Access denied: Administrator privileges required." });
      }

      let userQuery = supabase.from('users').select('*');
      if (/^[0-9a-fA-F-]{36}$/.test(targetUserId)) {
        userQuery = userQuery.eq('id', targetUserId);
      } else if (/^\d+$/.test(targetUserId)) {
        userQuery = userQuery.eq('telegram_id', parseInt(targetUserId, 10));
      } else {
        userQuery = userQuery.eq('telegram_username', targetUserId);
      }

      const { data: targetUser } = await userQuery.maybeSingle();
      if (!targetUser) return res.status(404).json({ error: "Target user not found." });

      const tgIdStr = String(targetUser.telegram_id || targetUserId);

      // Update existing subscriptions to expired (DB check constraint only allows
      // 'active' | 'expired' | 'pending' | 'rejected' - 'cancelled' is NOT a valid value
      // and silently fails the constraint if used).
      const now = new Date().toISOString();
      const epoch = new Date(0).toISOString();
      const { error: cancelErr, data: cancelledRows } = await supabase
        .from('subscriptions')
        .update({
          status: 'expired',
          expires_at: epoch,
          updated_at: now
        })
        .eq('user_id', targetUser.id)
        .select();

      console.log(`[SUB_CANCEL] userDbId=${targetUser.id} telegramId=${tgIdStr} rowsAffected=${cancelledRows ? cancelledRows.length : 0}`);

      if (cancelErr) {
        console.error("Error updating subscription status in Supabase:", cancelErr.message);
        return res.status(500).json({ error: `Failed to cancel subscription: ${cancelErr.message}` });
      }

      try {
        if (targetUser && targetUser.telegram_id) {
          const cancelMsg = `❌ تم إلغاء اشتراكك من قبل الإدارة.\n\nتم إيقاف صلاحية الوصول إلى المحتوى المدفوع.`;
          await sendTelegramMessage(targetUser.telegram_id, cancelMsg);
        }
      } catch (notifyErr) {
        console.error("Error sending Telegram cancellation message:", notifyErr);
      }

      return res.json({ success: true, message: "Subscription canceled successfully." });
    } catch (err: any) {
      console.error("Error canceling subscription:", err);
      return res.status(500).json({ error: err.message || "Failed to cancel subscription." });
    }
  });

  // POST /api/admin/subscriptions/cancel-all - Cancel all active subscriptions
  app.post("/api/admin/subscriptions/cancel-all", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: "Supabase client not configured." });

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      const isAuthorizedAdmin =
        (userRow && userRow.role === 'admin') ||
        verifyServerAdminAuthorization(requesterId) ||
        verifyServerAdminAuthorization(requesterUsername);

      if (!isAuthorizedAdmin) {
        return res.status(403).json({ error: "Access denied: Administrator privileges required." });
      }

      const now = new Date().toISOString();
      const { data: affectedSubs, error: cancelAllErr } = await supabase
        .from('subscriptions')
        .update({
          status: 'expired',
          expires_at: now,
          updated_at: now
        })
        .eq('status', 'active')
        .select();

      if (cancelAllErr) {
        console.error("Error canceling all active subscriptions:", cancelAllErr.message);
        return res.status(500).json({ error: cancelAllErr.message });
      }

      const affectedCount = affectedSubs ? affectedSubs.length : 0;
      return res.json({ success: true, affected: affectedCount });
    } catch (err: any) {
      console.error("Error in POST /api/admin/subscriptions/cancel-all:", err);
      return res.status(500).json({ error: err.message || "Failed to cancel all subscriptions." });
    }
  });

  // DELETE /api/admin/users/:userId - Delete user and associated records safely
  app.delete("/api/admin/users/:userId", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const targetUserId = req.params.userId;
      if (!targetUserId) {
        return res.status(400).json({ error: "userId parameter is required." });
      }

      const supabase = getSupabase();
      if (!supabase) {
        return res.status(500).json({ error: "Supabase client not configured." });
      }

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      const isAuthorizedAdmin =
        (userRow && userRow.role === 'admin') ||
        verifyServerAdminAuthorization(requesterId) ||
        verifyServerAdminAuthorization(requesterUsername);

      if (!isAuthorizedAdmin) {
        return res.status(403).json({ error: "Access denied: Administrator privileges required." });
      }

      // 1. Find user in Supabase
      let userQuery = supabase.from('users').select('*');
      if (/^[0-9a-fA-F-]{36}$/.test(targetUserId)) {
        userQuery = userQuery.eq('id', targetUserId);
      } else if (/^\d+$/.test(targetUserId)) {
        userQuery = userQuery.eq('telegram_id', parseInt(targetUserId, 10));
      } else {
        userQuery = userQuery.eq('telegram_username', targetUserId);
      }

      const { data: targetUser } = await userQuery.maybeSingle();

      const userDbId = targetUser?.id;
      const tgIdStr = targetUser?.telegram_id ? String(targetUser.telegram_id) : targetUserId;

      // 2. Safely cleanup associated records first (to prevent foreign key cascade errors)
      if (userDbId) {
        await supabase.from('subscriptions').delete().eq('user_id', userDbId);
        await supabase.from('payments').delete().or(`user_id.eq.${userDbId},telegram_user_id.eq.${tgIdStr}`);
        await supabase.from('question_progress').delete().eq('user_id', userDbId);
        await supabase.from('blocks').delete().eq('user_id', userDbId);
        await supabase.from('flashcards').delete().eq('user_id', userDbId);
        await supabase.from('users').delete().eq('id', userDbId);
      } else if (/^\d+$/.test(targetUserId)) {
        const tgNum = parseInt(targetUserId, 10);
        await supabase.from('payments').delete().eq('telegram_user_id', targetUserId);
        await supabase.from('users').delete().eq('telegram_id', tgNum);
      }

      return res.json({
        success: true,
        deleted: true,
        userId: targetUserId
      });
    } catch (err: any) {
      console.error("Error in DELETE /api/admin/users/:userId:", err);
      return res.status(500).json({ error: err.message || "Failed to delete user." });
    }
  });

  // GET /api/admin/config
  app.get("/api/admin/config", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      const isAuthorizedAdmin =
        (userRow && userRow.role === 'admin') ||
        verifyServerAdminAuthorization(requesterId) ||
        verifyServerAdminAuthorization(requesterUsername);

      if (!isAuthorizedAdmin) {
        return res.status(403).json({ error: "Access denied: Administrator privileges required." });
      }

      return res.json({ config: serverAdminConfig });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to fetch admin config." });
    }
  });

  // PUT /api/admin/config
  app.put("/api/admin/config", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || req.body?.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || req.body?.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      const isAuthorizedAdmin =
        (userRow && userRow.role === 'admin') ||
        verifyServerAdminAuthorization(requesterId) ||
        verifyServerAdminAuthorization(requesterUsername);

      if (!isAuthorizedAdmin) {
        return res.status(403).json({ error: "Access denied: Administrator privileges required." });
      }

      const newConfig = req.body?.config || req.body;
      if (newConfig && typeof newConfig === 'object') {
        serverAdminConfig = {
          paymentPhoneNumber: String(newConfig.paymentPhoneNumber || serverAdminConfig.paymentPhoneNumber),
          paymentAccountName: String(newConfig.paymentAccountName || serverAdminConfig.paymentAccountName),
          subscriptionPrice: Number(newConfig.subscriptionPrice ?? serverAdminConfig.subscriptionPrice),
          subscriptionDurationDays: Number(newConfig.subscriptionDurationDays ?? serverAdminConfig.subscriptionDurationDays),
          paymentInstructions: String(newConfig.paymentInstructions || serverAdminConfig.paymentInstructions)
        };
      }

      return res.json({ config: serverAdminConfig, updated: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to update admin config." });
    }
  });

  // ==========================================
  // PHASE 8: PAYMENT WORKFLOW ENDPOINTS
  // ==========================================

  // Global disabled users set for account deactivation
const disabledUserIds = new Set<string>();

function isUserAccountActive(userRow: any): boolean {
  if (!userRow) return false;
  if (userRow.id && disabledUserIds.has(userRow.id)) return false;
  if (userRow.telegram_id && disabledUserIds.has(String(userRow.telegram_id))) return false;
  if (userRow.is_active === false) return false;
  return true;
}
  function getTelegramBotToken(): string {
    return (
      process.env.TELEGRAM_BOT_TOKEN ||
      process.env.BOT_TOKEN ||
      process.env.TELEGRAM_TOKEN ||
      ''
    ).trim();
  }

  // Helper to send a message via Telegram Bot API
  async function sendTelegramMessage(chatId: string | number, text: string, replyMarkup?: any): Promise<boolean> {
    const token = getTelegramBotToken();
    if (!token || !chatId) {
      console.warn(`[Telegram Bot] Cannot send message: token Present=${Boolean(token)}, chatId=${chatId}`);
      return false;
    }
    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const bodyPayload: any = {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML'
      };
      if (replyMarkup) {
        bodyPayload.reply_markup = replyMarkup;
      }
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });
      const data = await response.json();
      if (!data.ok) {
        console.error(`[Telegram Bot] Send message API error:`, data);
        return false;
      }
      console.log(`[Telegram Bot] Successfully sent message to chatId: ${chatId}`);
      return true;
    } catch (err) {
      console.error(`[Telegram Bot] Error sending message to chatId: ${chatId}`, err);
      return false;
    }
  }

  // Sends a photo already known to Telegram (by file_id) to a given chat,
  // with an optional HTML-formatted caption and inline keyboard — used to
  // forward a user's payment proof photo to the admin's own chat together
  // with Approve/Reject buttons, so the proof is visible without opening
  // the web dashboard.
  async function sendTelegramPhoto(chatId: string | number, photoFileId: string, caption?: string, replyMarkup?: any): Promise<boolean> {
    const token = getTelegramBotToken();
    if (!token || !chatId || !photoFileId) return false;
    try {
      const bodyPayload: any = {
        chat_id: chatId,
        photo: photoFileId,
        parse_mode: 'HTML'
      };
      if (caption) bodyPayload.caption = caption;
      if (replyMarkup) bodyPayload.reply_markup = replyMarkup;

      const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });
      const data = await response.json();
      if (!data.ok) {
        console.error('[Telegram Bot] sendPhoto API error:', data);
        return false;
      }
      return true;
    } catch (err) {
      console.error(`[Telegram Bot] Error sending photo to chatId: ${chatId}`, err);
      return false;
    }
  }

  // Acknowledges a button press (removes the loading spinner Telegram
  // shows on the button until this is called). Needed for the bank-choice
  // inline buttons in the webhook handler below.
  async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    const token = getTelegramBotToken();
    if (!token || !callbackQueryId) return;
    try {
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId, text: text || '' })
      });
    } catch (err) {
      console.error('[Telegram Bot] Error answering callback query:', err);
    }
  }

  // GET /api/admin/payments/:paymentId/proof - Serve/Proxy payment proof image securely by payment ID or custom_id
  app.get("/api/admin/payments/:paymentId/proof", async (req, res) => {
    try {
      const paymentId = req.params.paymentId;
      if (!paymentId) return res.status(400).send("paymentId parameter required.");

      const supabase = getSupabase();
      if (!supabase) return res.status(500).send("Supabase client not configured.");

      let payQuery = supabase.from('payments').select('*');
      if (/^[0-9a-fA-F-]{36}$/.test(paymentId)) {
        payQuery = payQuery.eq('id', paymentId);
      } else {
        payQuery = payQuery.eq('custom_id', paymentId);
      }

      const { data: payRow } = await payQuery.maybeSingle();
      const proofFileId = payRow?.proof_file_id || req.query.fileId || req.query.proofFileId;
      const proofFileUrl = payRow?.proof_file_url || req.query.url;

      if (proofFileUrl && (typeof proofFileUrl === 'string') && (proofFileUrl.startsWith('http://') || proofFileUrl.startsWith('https://'))) {
        return res.redirect(proofFileUrl);
      }

      if (!proofFileId || proofFileId === 'telegram_photo_receipt') {
        res.setHeader("Content-Type", "image/svg+xml");
        return res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="350" viewBox="0 0 600 350" fill="none">
          <rect width="600" height="350" rx="16" fill="#0f172a"/>
          <rect x="2" y="2" width="596" height="346" rx="14" stroke="#334155" stroke-width="2"/>
          <circle cx="300" cy="130" r="36" fill="#1e293b" stroke="#06b6d4" stroke-width="2"/>
          <path d="M288 130L296 138L312 122" stroke="#06b6d4" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          <text x="300" y="210" fill="#f8fafc" font-family="sans-serif" font-size="18" font-weight="bold" text-anchor="middle">صورة وصل الدفع / الحوالة مرفقة</text>
          <text x="300" y="240" fill="#94a3b8" font-family="sans-serif" font-size="13" text-anchor="middle">تم تسجيل إيصال الدفع بنجاح في النظام</text>
        </svg>`);
      }

      const cleanFileId = String(proofFileId).trim();
      if (cleanFileId.startsWith('http://') || cleanFileId.startsWith('https://')) {
        return res.redirect(cleanFileId);
      }

      const token = getTelegramBotToken();
      if (!token) {
        res.setHeader("Content-Type", "image/svg+xml");
        return res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="350" viewBox="0 0 600 350" fill="none">
          <rect width="600" height="350" rx="16" fill="#0f172a"/>
          <text x="300" y="195" fill="#f8fafc" font-family="sans-serif" font-size="18" font-weight="bold" text-anchor="middle">إيصال الدفع مرفق بنجاح</text>
          <text x="300" y="225" fill="#94a3b8" font-family="sans-serif" font-size="13" text-anchor="middle">معرّف الصورة: ${cleanFileId.substring(0, 30)}...</text>
        </svg>`);
      }

      const fileInfoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(cleanFileId)}`);
      const fileInfo = await fileInfoRes.json();

      if (!fileInfo.ok || !fileInfo.result?.file_path) {
        res.setHeader("Content-Type", "image/svg+xml");
        return res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="350" viewBox="0 0 600 350" fill="none">
          <rect width="600" height="350" rx="16" fill="#0f172a"/>
          <text x="300" y="175" fill="#f8fafc" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="middle">صورة الوصل مسجلة في طلب الدفع</text>
        </svg>`);
      }

      const filePath = fileInfo.result.file_path;
      const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;

      const imgRes = await fetch(fileUrl);
      if (!imgRes.ok) {
        return res.status(500).send("Failed to fetch image binary from Telegram servers.");
      }

      const contentType = imgRes.headers.get("content-type") || "image/jpeg";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");

      const arrayBuffer = await imgRes.arrayBuffer();
      return res.send(Buffer.from(arrayBuffer));
    } catch (err: any) {
      console.error("Error in payment proof endpoint:", err);
      res.setHeader("Content-Type", "image/svg+xml");
      return res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="350" viewBox="0 0 600 350" fill="none">
        <rect width="600" height="350" rx="16" fill="#0f172a"/>
        <text x="300" y="175" fill="#f8fafc" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="middle">إيصال الدفع مرفق بالطلب</text>
      </svg>`);
    }
  });

  // GET /api/telegram/file/:fileId - Proxy Telegram proof image files to Admin Dashboard
  app.get("/api/telegram/file/:fileId", async (req, res) => {
    try {
      const fileId = req.params.fileId;
      const queryUrl = (req.query.url || req.query.proofFileUrl || req.query.proof_file_url) as string | undefined;

      if (queryUrl && (queryUrl.startsWith('http://') || queryUrl.startsWith('https://'))) {
        return res.redirect(queryUrl);
      }

      if (!fileId || fileId === 'telegram_photo_receipt') {
        if (queryUrl && (queryUrl.startsWith('http://') || queryUrl.startsWith('https://'))) {
          return res.redirect(queryUrl);
        }
        res.setHeader("Content-Type", "image/svg+xml");
        return res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="350" viewBox="0 0 600 350" fill="none">
          <rect width="600" height="350" rx="16" fill="#0f172a"/>
          <rect x="2" y="2" width="596" height="346" rx="14" stroke="#334155" stroke-width="2"/>
          <circle cx="300" cy="130" r="36" fill="#1e293b" stroke="#06b6d4" stroke-width="2"/>
          <path d="M288 130L296 138L312 122" stroke="#06b6d4" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          <text x="300" y="210" fill="#f8fafc" font-family="sans-serif" font-size="18" font-weight="bold" text-anchor="middle">صورة وصل الدفع / الحوالة مرفقة</text>
          <text x="300" y="240" fill="#94a3b8" font-family="sans-serif" font-size="13" text-anchor="middle">تم تسجيل إيصال الدفع بنجاح في النظام</text>
        </svg>`);
      }

      if (fileId.startsWith('http://') || fileId.startsWith('https://')) {
        return res.redirect(fileId);
      }

      const token = getTelegramBotToken();
      if (!token) {
        res.setHeader("Content-Type", "image/svg+xml");
        return res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="350" viewBox="0 0 600 350" fill="none">
          <rect width="600" height="350" rx="16" fill="#0f172a"/>
          <rect x="2" y="2" width="596" height="346" rx="14" stroke="#334155" stroke-width="2"/>
          <circle cx="300" cy="120" r="36" fill="#1e293b" stroke="#06b6d4" stroke-width="2"/>
          <path d="M288 120L296 128L312 112" stroke="#06b6d4" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          <text x="300" y="195" fill="#f8fafc" font-family="sans-serif" font-size="18" font-weight="bold" text-anchor="middle">إيصال الدفع مرفق بنجاح</text>
          <text x="300" y="225" fill="#94a3b8" font-family="sans-serif" font-size="13" text-anchor="middle">معرّف الصورة على تيليجرام: ${fileId.substring(0, 30)}...</text>
          <text x="300" y="260" fill="#64748b" font-family="sans-serif" font-size="11" text-anchor="middle">للجلب المباشر عبر Telegram API يمكنك ضبط TELEGRAM_BOT_TOKEN في إعدادات البيئة</text>
        </svg>`);
      }

      // Step 1: Query Telegram Bot API for file_path
      const fileInfoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
      const fileInfo = await fileInfoRes.json();

      if (!fileInfo.ok || !fileInfo.result?.file_path) {
        console.error("Telegram getFile error:", fileInfo);
        res.setHeader("Content-Type", "image/svg+xml");
        return res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="350" viewBox="0 0 600 350" fill="none">
          <rect width="600" height="350" rx="16" fill="#0f172a"/>
          <rect x="2" y="2" width="596" height="346" rx="14" stroke="#334155" stroke-width="2"/>
          <text x="300" y="175" fill="#f8fafc" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="middle">صورة الوصل مسجلة في طلب الدفع</text>
          <text x="300" y="210" fill="#94a3b8" font-family="sans-serif" font-size="12" text-anchor="middle">(Telegram File ID: ${fileId.substring(0, 25)}...)</text>
        </svg>`);
      }

      const filePath = fileInfo.result.file_path;
      const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;

      // Step 2: Download the image binary and proxy to response
      const imgRes = await fetch(fileUrl);
      if (!imgRes.ok) {
        return res.status(500).send("Failed to fetch image binary from Telegram servers");
      }

      const contentType = imgRes.headers.get("content-type") || "image/jpeg";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");

      const arrayBuffer = await imgRes.arrayBuffer();
      return res.send(Buffer.from(arrayBuffer));
    } catch (err: any) {
      console.error("Error proxying Telegram file:", err);
      res.setHeader("Content-Type", "image/svg+xml");
      return res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="350" viewBox="0 0 600 350" fill="none">
        <rect width="600" height="350" rx="16" fill="#0f172a"/>
        <text x="300" y="175" fill="#f8fafc" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="middle">إيصال الدفع مرفق بالطلب</text>
      </svg>`);
    }
  });

  // Helper to map DB payment row to API response shape
  function mapDbRowToPayment(row: any): any {

    if (!row) return null;
    return {
      id: row.id,
      customId: row.custom_id,
      custom_id: row.custom_id,
      userId: row.user_id,
      user_id: row.user_id,
      telegramUserId: row.telegram_user_id,
      telegram_user_id: row.telegram_user_id,
      telegramUsername: row.telegram_username,
      telegram_username: row.telegram_username,
      amountSyp: row.amount_syp,
      amount_syp: row.amount_syp,
      amount: row.amount_syp,
      paymentMethod: row.payment_method,
      payment_method: row.payment_method,
      transactionRef: row.transaction_ref,
      transaction_ref: row.transaction_ref,
      proofFileId: row.proof_file_id,
      proof_file_id: row.proof_file_id,
      proofFileUrl: row.proof_file_url,
      proof_file_url: row.proof_file_url,
      status: row.status,
      reviewedBy: row.reviewed_by,
      reviewed_by: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      reviewed_at: row.reviewed_at,
      createdAt: row.created_at,
      created_at: row.created_at,
      updatedAt: row.updated_at,
      updated_at: row.updated_at
    };
  }

  // POST /api/payments/submit - Telegram user submits proof of payment (does NOT activate subscription)
  app.post("/api/payments/submit", async (req, res) => {
    try {
      const requesterId = (
        req.headers['x-telegram-user-id'] ||
        req.query.telegramUserId ||
        req.query.telegram_id ||
        req.query.telegramId ||
        req.query.user_id ||
        req.body?.telegramId ||
        req.body?.telegram_id ||
        req.body?.telegramUserId ||
        req.body?.telegram_user_id ||
        req.body?.user_id ||
        req.body?.userId ||
        ''
      ) as string;

      const requesterUsername = (
        req.headers['x-telegram-username'] ||
        req.query.username ||
        req.query.telegram_username ||
        req.query.telegramUsername ||
        req.body?.username ||
        req.body?.telegram_username ||
        req.body?.telegramUsername ||
        ''
      ) as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({
          success: false,
          error: "Authentication required: Telegram user identity headers missing."
        });
      }

      const body = req.body || {};

      // REQUIRED now: Human Medicine and Dentistry each have their own
      // price and their own subscription — a payment with no bankId is
      // ambiguous and must be rejected rather than silently defaulting.
      const bankId = String(body.bankId || body.bank_id || '').trim();
      if (!bankId || !['human_medicine', 'dentistry'].includes(bankId)) {
        return res.status(400).json({
          success: false,
          error: "bankId is required and must be 'human_medicine' or 'dentistry'."
        });
      }

      const supabase = getSupabase();
      if (!supabase) {
        return res.status(500).json({ success: false, error: "Supabase client not configured." });
      }

      // Resolve the price authoritatively from bank_pricing — never trust
      // a client-supplied amount, so a modified request can't under-report
      // what was actually paid.
      const { data: pricingRow } = await supabase
        .from('bank_pricing')
        .select('price, payment_number, payment_name')
        .eq('bank_id', bankId)
        .maybeSingle();

      const amount = pricingRow ? Number(pricingRow.price) : (Number(body.amount ?? body.amount_syp) || 25);

      const paymentMethod = String(body.paymentMethod || body.payment_method || body.method || 'Zain Cash').trim();
      const transactionRef = body.transactionRef || body.transaction_ref || body.reference || body.ref ? String(body.transactionRef || body.transaction_ref || body.reference || body.ref).trim() : null;
      const proofFileId = body.proofFileId || body.proof_file_id || body.file_id || body.photo_id || body.telegram_file_id ? String(body.proofFileId || body.proof_file_id || body.file_id || body.photo_id || body.telegram_file_id).trim() : null;
      const proofFileUrl = body.proofFileUrl || body.proof_file_url || body.photo_url || body.image_url || body.url ? String(body.proofFileUrl || body.proof_file_url || body.photo_url || body.image_url || body.url).trim() : null;

      // Fallback for proof file if neither URL nor ID is specified (e.g. text receipt)
      const finalProofFileId = proofFileId || proofFileUrl || 'telegram_photo_receipt';

      // Resolve Supabase user record via existing helper
      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      if (!userRow || !userRow.id) {
        return res.status(500).json({ success: false, error: "Failed to resolve or create Supabase user account." });
      }

      const now = new Date().toISOString();
      const customId = `pay_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      const paymentRowData = {
        custom_id: customId,
        user_id: userRow.id,
        bank_id: bankId,
        amount_syp: amount,
        payment_method: paymentMethod,
        transaction_ref: transactionRef,
        telegram_user_id: String(requesterId || userRow.telegram_id || '').trim(),
        telegram_username: requesterUsername ? String(requesterUsername).trim() : (userRow.telegram_username || null),
        proof_file_id: finalProofFileId,
        proof_file_url: proofFileUrl,
        status: 'PENDING',
        created_at: now,
        updated_at: now
      };

      const { data: insertedRow, error: insertErr } = await supabase
        .from('payments')
        .insert(paymentRowData)
        .select()
        .single();

      if (insertErr) {
        console.error("Error inserting payment in Supabase:", insertErr.message);
        return res.status(500).json({ success: false, error: insertErr.message });
      }

      const mappedPayment = mapDbRowToPayment(insertedRow);

      // Trigger Telegram notification to configured Admin Telegram IDs (side-effect)
      try {
        const adminIds = getAdminTelegramIds();
        if (adminIds.length > 0) {
          const userDisplayName = userRow.full_name || (userRow.telegram_username ? `@${userRow.telegram_username}` : `User ${userRow.telegram_id}`);
          const telegramUsernameStr = requesterUsername ? `@${requesterUsername.replace(/^@/, '')}` : (userRow.telegram_username ? `@${userRow.telegram_username}` : 'N/A');
          const specialtyLabel = bankId === 'dentistry' ? 'طب الأسنان' : 'الطب البشري';

          const notificationMessage = `🔔 <b>طلب دفع جديد (Payment Request)</b>\n\n` +
            `👤 <b>المستخدم:</b> ${userDisplayName}\n` +
            `🏷 <b>اسم المستخدم:</b> ${telegramUsernameStr}\n` +
            `🆔 <b>Telegram ID:</b> <code>${requesterId || userRow.telegram_id}</code>\n` +
            `🩺 <b>التخصص:</b> ${specialtyLabel}\n` +
            `💰 <b>المبلغ:</b> ${amount} JOD\n` +
            `💳 <b>طريقة الدفع:</b> ${paymentMethod}\n` +
            `📄 <b>رقم العملية/المرجع:</b> ${transactionRef || 'غير محدد'}\n` +
            `🆔 <b>معرف الطلب:</b> <code>${mappedPayment.id}</code>\n` +
            `📅 <b>التاريخ:</b> ${new Date().toLocaleString('ar-SA')}`;

          const approvalKeyboard = {
            inline_keyboard: [[
              { text: '✅ Approve', callback_data: `approve_payment:${mappedPayment.id}` },
              { text: '❌ Reject', callback_data: `reject_payment:${mappedPayment.id}` }
            ]]
          };

          let sentCount = 0;
          for (const adminId of adminIds) {
            if (/^\d+$/.test(adminId)) {
              // Send the actual proof photo with the details as its
              // caption and Approve/Reject buttons attached directly —
              // falls back to a plain text message if the photo send
              // fails (e.g. a non-photo/text-only proof).
              let success = false;
              if (finalProofFileId && finalProofFileId !== 'telegram_photo_receipt') {
                success = await sendTelegramPhoto(adminId, finalProofFileId, notificationMessage, approvalKeyboard);
              }
              if (!success) {
                success = await sendTelegramMessage(adminId, notificationMessage, approvalKeyboard);
              }
              if (success) sentCount++;
            }
          }
          console.log(`[Payment Notification] Sent Telegram notification for payment ${mappedPayment.id} to ${sentCount}/${adminIds.length} admins.`);
        } else {
          console.warn("[Payment Notification] No admin Telegram IDs configured for notification.");
        }
      } catch (notifyErr: any) {
        console.error("Non-blocking error sending Telegram payment notification to admins:", notifyErr?.message || notifyErr);
      }

      return res.status(200).json({
        ok: true,
        success: true,
        synced: true,
        status: 'PENDING',
        payment_id: mappedPayment.id,
        paymentId: mappedPayment.id,
        payment: mappedPayment
      });
    } catch (err: any) {
      console.error("Error in POST /api/payments/submit:", err);
      return res.status(500).json({ success: false, error: err.message || "Failed to submit payment." });
    }
  });

  // GET /api/payments/my-status - Authenticated user checks status of their latest payment request
  app.get("/api/payments/my-status", async (req, res) => {
    try {
      const requesterId = (
        req.headers['x-telegram-user-id'] ||
        req.query.telegramUserId ||
        req.query.telegram_id ||
        req.query.telegramId ||
        req.query.user_id ||
        req.query.userId ||
        ''
      ) as string;

      const requesterUsername = (
        req.headers['x-telegram-username'] ||
        req.query.username ||
        req.query.telegram_username ||
        req.query.telegramUsername ||
        ''
      ) as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ success: false, error: "Authentication required: Telegram user identity missing." });
      }

      const supabase = getSupabase();
      if (!supabase) {
        return res.status(500).json({ success: false, error: "Supabase client not configured." });
      }

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);

      let query = supabase
        .from('payments')
        .select('*')
        .order('created_at', { ascending: false });

      if (userRow && userRow.id) {
        if (requesterId) {
          query = query.or(`user_id.eq.${userRow.id},telegram_user_id.eq.${requesterId}`);
        } else {
          query = query.eq('user_id', userRow.id);
        }
      } else if (requesterId) {
        query = query.eq('telegram_user_id', requesterId);
      } else if (requesterUsername) {
        query = query.eq('telegram_username', requesterUsername);
      }

      const { data: latestPayment, error } = await query.limit(1).maybeSingle();

      if (error) {
        console.error("Error fetching payment status from Supabase:", error.message);
        return res.status(500).json({ success: false, error: error.message });
      }

      const mapped = latestPayment ? mapDbRowToPayment(latestPayment) : null;
      const statusValue = latestPayment ? String(latestPayment.status).toUpperCase() : 'NONE';

      return res.json({
        success: true,
        status: statusValue,
        payment: mapped
      });
    } catch (err: any) {
      console.error("Error in GET /api/payments/my-status:", err);
      return res.status(500).json({ success: false, error: err.message || "Failed to fetch payment status." });
    }
  });

  // GET /api/subscriptions/status - Check if a user has an active subscription
  // ============================================================
  // VIDEOS — Netflix-style video library, scoped per bank. Public list
  // endpoint requires an active subscription for that bank (same gate as
  // questions); admin endpoints allow full CRUD management.
  // ============================================================

  // Video/thumbnail files are uploaded as multipart/form-data and held in
  // memory only long enough to forward the buffer to Supabase Storage —
  // never written to local disk (this server's filesystem is ephemeral on
  // Render and unsuitable for permanent file storage anyway).
  const videoUpload = multer({
    storage: multer.memoryStorage(),
    // Matches this Supabase project's own global Storage file size limit
    // (50MB) — keeping these in sync means an oversized file gets a clear
    // error immediately here, instead of failing confusingly later at the
    // Supabase Storage upload step.
    limits: { fileSize: 50 * 1024 * 1024 }
  });

  // POST /api/admin/videos/upload — accepts a single file field named
  // "file" plus a "kind" field ("video" or "thumbnail"), uploads it to the
  // "videos" Supabase Storage bucket, and returns its public URL. The
  // admin UI calls this once per file BEFORE creating/updating the video
  // record, then saves the returned URL as thumbnailUrl/videoUrl.
  app.post("/api/admin/videos/upload", (req, res, next) => {
    videoUpload.single('file')(req, res, (err: any) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, error: "File is too large. This project's Storage limit is 50MB per file." });
        }
        return res.status(400).json({ success: false, error: err.message || "Upload failed." });
      }
      next();
    });
  }, async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.body?.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.body?.username || '') as string;
      if (!verifyServerAdminAuthorization(requesterId) && !verifyServerAdminAuthorization(requesterUsername)) {
        return res.status(403).json({ success: false, error: "Administrator privileges required." });
      }

      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) {
        return res.status(400).json({ success: false, error: "No file was uploaded (expected field name 'file')." });
      }

      const kind = String(req.body?.kind || 'video');
      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ success: false, error: "Supabase client not configured." });

      const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const storagePath = `${kind}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;

      const { error: uploadErr } = await supabase.storage
        .from('videos')
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });

      if (uploadErr) {
        console.error('[VIDEO_UPLOAD] Supabase Storage error:', uploadErr.message);
        return res.status(500).json({ success: false, error: `Storage upload failed: ${uploadErr.message}` });
      }

      const { data: publicUrlData } = supabase.storage.from('videos').getPublicUrl(storagePath);

      return res.json({ success: true, url: publicUrlData.publicUrl, path: storagePath });
    } catch (err: any) {
      console.error("Error in POST /api/admin/videos/upload:", err);
      return res.status(500).json({ success: false, error: err.message || "Upload failed." });
    }
  });

  // GET /api/videos?bankId=human_medicine — student-facing list, gated by
  // an active subscription for that specific bank.
  app.get("/api/videos", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;
      const bankId = String(req.query.bankId || '').trim();

      if (!bankId) {
        return res.status(400).json({ success: false, error: "bankId is required." });
      }

      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ success: false, error: "Supabase client not configured." });

      const isAdminCaller = verifyServerAdminAuthorization(requesterId) || verifyServerAdminAuthorization(requesterUsername);

      if (!isAdminCaller) {
        const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
        if (!userRow?.id) return res.status(403).json({ success: false, error: "Subscription required." });
        const subAuth = await resolveAuthoritativeUserSubscription(userRow.id, bankId);
        if (!subAuth.isSubscribed) {
          return res.status(403).json({ success: false, error: "An active subscription for this bank is required to view videos." });
        }
      }

      const { data, error } = await supabase
        .from('videos')
        .select('*')
        .eq('bank_id', bankId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) return res.status(500).json({ success: false, error: error.message });

      return res.json({ success: true, videos: data || [] });
    } catch (err: any) {
      console.error("Error in GET /api/videos:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ---- Admin video management ----
  const requireAdminForVideos = (req: express.Request): boolean => {
    const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || req.body?.telegramUserId || '') as string;
    const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || req.body?.username || '') as string;
    return verifyServerAdminAuthorization(requesterId) || verifyServerAdminAuthorization(requesterUsername);
  };

  app.post("/api/admin/videos", async (req, res) => {
    try {
      if (!requireAdminForVideos(req)) return res.status(403).json({ success: false, error: "Administrator privileges required." });

      const { bankId, title, description, thumbnailUrl, videoUrl, category, durationLabel, sortOrder } = req.body || {};
      if (!bankId || !title || !videoUrl) {
        return res.status(400).json({ success: false, error: "bankId, title, and videoUrl are required." });
      }

      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ success: false, error: "Supabase client not configured." });

      const { data, error } = await supabase
        .from('videos')
        .insert({
          bank_id: bankId,
          title: String(title).trim(),
          description: description ? String(description).trim() : null,
          thumbnail_url: thumbnailUrl || null,
          video_url: String(videoUrl).trim(),
          category: category || null,
          duration_label: durationLabel || null,
          sort_order: Number(sortOrder) || 0
        })
        .select()
        .single();

      if (error) return res.status(500).json({ success: false, error: error.message });
      return res.json({ success: true, video: data });
    } catch (err: any) {
      console.error("Error in POST /api/admin/videos:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.put("/api/admin/videos/:id", async (req, res) => {
    try {
      if (!requireAdminForVideos(req)) return res.status(403).json({ success: false, error: "Administrator privileges required." });

      const { title, description, thumbnailUrl, videoUrl, category, durationLabel, sortOrder } = req.body || {};
      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ success: false, error: "Supabase client not configured." });

      const updatePayload: Record<string, any> = { updated_at: new Date().toISOString() };
      if (title !== undefined) updatePayload.title = String(title).trim();
      if (description !== undefined) updatePayload.description = description ? String(description).trim() : null;
      if (thumbnailUrl !== undefined) updatePayload.thumbnail_url = thumbnailUrl || null;
      if (videoUrl !== undefined) updatePayload.video_url = String(videoUrl).trim();
      if (category !== undefined) updatePayload.category = category || null;
      if (durationLabel !== undefined) updatePayload.duration_label = durationLabel || null;
      if (sortOrder !== undefined) updatePayload.sort_order = Number(sortOrder) || 0;

      const { data, error } = await supabase
        .from('videos')
        .update(updatePayload)
        .eq('id', req.params.id)
        .select()
        .single();

      if (error) return res.status(500).json({ success: false, error: error.message });
      return res.json({ success: true, video: data });
    } catch (err: any) {
      console.error("Error in PUT /api/admin/videos/:id:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete("/api/admin/videos/:id", async (req, res) => {
    try {
      if (!requireAdminForVideos(req)) return res.status(403).json({ success: false, error: "Administrator privileges required." });

      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ success: false, error: "Supabase client not configured." });

      const { error } = await supabase.from('videos').delete().eq('id', req.params.id);
      if (error) return res.status(500).json({ success: false, error: error.message });
      return res.json({ success: true });
    } catch (err: any) {
      console.error("Error in DELETE /api/admin/videos/:id:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/admin/videos", async (req, res) => {
    try {
      if (!requireAdminForVideos(req)) return res.status(403).json({ success: false, error: "Administrator privileges required." });

      const bankId = String(req.query.bankId || '').trim();
      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ success: false, error: "Supabase client not configured." });

      let query = supabase.from('videos').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: false });
      if (bankId) query = query.eq('bank_id', bankId);

      const { data, error } = await query;
      if (error) return res.status(500).json({ success: false, error: error.message });
      return res.json({ success: true, videos: data || [] });
    } catch (err: any) {
      console.error("Error in GET /api/admin/videos:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get(["/api/subscriptions/status", "/api/subscriptions/my-status"], async (req, res) => {
    try {
      const requesterId = (
        req.headers['x-telegram-user-id'] ||
        req.query.telegramUserId ||
        req.query.telegram_id ||
        req.query.telegramId ||
        req.query.user_id ||
        req.query.userId ||
        ''
      ) as string;

      const requesterUsername = (
        req.headers['x-telegram-username'] ||
        req.query.username ||
        req.query.telegram_username ||
        req.query.telegramUsername ||
        ''
      ) as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ success: false, error: "Authentication required." });
      }

      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ success: false, error: "Supabase client not configured." });

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      if (!userRow) return res.json({ success: true, subscribed: false, status: 'INACTIVE', subscription: null });

      // bankId is now REQUIRED for a meaningful answer, since Human
      // Medicine and Dentistry each have their own independent
      // subscription. Callers that don't specify one (older code paths)
      // get status for every bank instead of one ambiguous answer.
      const requestedBankId = (req.query.bankId || req.query.bank_id || '') as string;

      if (requestedBankId) {
        const subAuth = await resolveAuthoritativeUserSubscription(userRow.id, requestedBankId);
        return res.json({
          success: true,
          bankId: requestedBankId,
          subscribed: subAuth.isSubscribed,
          status: subAuth.normalizedStatus,
          subscription: subAuth.subscription
        });
      }

      const [humanMed, dent] = await Promise.all([
        resolveAuthoritativeUserSubscription(userRow.id, 'human_medicine'),
        resolveAuthoritativeUserSubscription(userRow.id, 'dentistry')
      ]);

      return res.json({
        success: true,
        subscribed: humanMed.isSubscribed || dent.isSubscribed,
        status: humanMed.isSubscribed ? humanMed.normalizedStatus : dent.normalizedStatus,
        subscription: humanMed.isSubscribed ? humanMed.subscription : dent.subscription,
        subscriptionsByBank: { human_medicine: humanMed, dentistry: dent }
      });
    } catch (err: any) {
      console.error("Error in GET /api/subscriptions/status:", err);
      return res.status(500).json({ success: false, error: err.message || "Failed to fetch subscription status." });
    }
  });

  // GET /api/admin/payments - Admin-only list of payment requests, optional ?status= filter
  app.get("/api/admin/payments", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const supabase = getSupabase();
      if (!supabase) {
        return res.status(500).json({ error: "Supabase client not configured." });
      }

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      const isAuthorizedAdmin =
        (userRow && userRow.role === 'admin') ||
        verifyServerAdminAuthorization(requesterId) ||
        verifyServerAdminAuthorization(requesterUsername);

      if (!isAuthorizedAdmin) {
        return res.status(403).json({ error: "Access denied: Administrator privileges required." });
      }

      let query = supabase.from('payments').select('*');

      const statusFilter = req.query.status ? String(req.query.status).trim().toUpperCase() : null;
      if (statusFilter) {
        query = query.eq('status', statusFilter);
      }

      const { data: rows, error } = await query.order('created_at', { ascending: false });

      if (error) {
        console.error("Error fetching payments from Supabase:", error.message);
        return res.status(500).json({ error: error.message });
      }

      const mappedPayments = (rows || []).map(mapDbRowToPayment);

      return res.json({ payments: mappedPayments });
    } catch (err: any) {
      console.error("Error in GET /api/admin/payments:", err);
      return res.status(500).json({ error: err.message || "Failed to fetch payments." });
    }
  });

  // POST /api/admin/payments/:id/approve - Admin-only approval; activates the user's subscription
  app.post("/api/admin/payments/:id/approve", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || req.body?.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || req.body?.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const paymentId = req.params.id;
      if (!paymentId) return res.status(400).json({ error: "Payment id parameter is required." });

      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: "Supabase client not configured." });

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      const isAuthorizedAdmin =
        (userRow && userRow.role === 'admin') ||
        verifyServerAdminAuthorization(requesterId) ||
        verifyServerAdminAuthorization(requesterUsername);

      if (!isAuthorizedAdmin || !userRow || !userRow.id) {
        return res.status(403).json({ error: "Access denied: Administrator privileges required." });
      }

      const { data: existingPayment, error: fetchErr } = await supabase
        .from('payments')
        .select('*')
        .or(`id.eq.${paymentId},custom_id.eq.${paymentId}`)
        .maybeSingle();

      if (fetchErr) return res.status(500).json({ error: fetchErr.message });
      if (!existingPayment) return res.status(404).json({ error: "Payment request not found." });

      const currentPaymentStatus = String(existingPayment.status || '').toUpperCase();
      if (currentPaymentStatus !== 'PENDING') {
        // PART 3 fix: no longer permits re-approving an already-APPROVED payment.
        // The old check allowed APPROVED payments through too, which meant an
        // accidental double-click could re-run subscription writes + a second
        // Telegram notification for the same payment.
        return res.status(400).json({ error: `Payment request has already been reviewed (status: ${existingPayment.status}).` });
      }

      // Authoritative User Resolution for the payer
      const payerTgIdStr = String(existingPayment.telegram_user_id || '').trim();
      const payerUsernameStr = String(existingPayment.telegram_username || '').trim();
      let payerUser: any = null;

      if (existingPayment.user_id) {
        const { data: u } = await supabase
          .from('users')
          .select('*')
          .eq('id', existingPayment.user_id)
          .maybeSingle();
        if (u) payerUser = u;
      }

      if (!payerUser && (payerTgIdStr || payerUsernameStr)) {
        payerUser = await getOrCreateSupabaseUser(payerTgIdStr, payerUsernameStr);
      }

      if (!payerUser || !payerUser.id) {
        return res.status(400).json({ error: "Could not resolve a valid user account for this payment. Activation aborted." });
      }

      const now = new Date().toISOString();

      // Duration and price come from this payment's specific bank — Human
      // Medicine and Dentistry can have different durations/prices, and
      // must never fall back to a single global default.
      const paymentBankId = String(existingPayment.bank_id || '').trim();
      if (!paymentBankId) {
        return res.status(400).json({ error: "This payment has no bank_id recorded — cannot determine which subscription to activate." });
      }

      const { data: pricingRow } = await supabase
        .from('bank_pricing')
        .select('duration_days')
        .eq('bank_id', paymentBankId)
        .maybeSingle();

      const durationDays = Number(pricingRow?.duration_days) || Number(serverAdminConfig.subscriptionDurationDays) || 30;
      const expiresAt = new Date(Date.now() + durationDays * 24 * 3600 * 1000).toISOString();

      // Find any existing subscription for this SPECIFIC user+bank pair —
      // never just "any subscription for this user" — a user's Dentistry
      // subscription must never be touched by a Human Medicine payment.
      const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', payerUser.id)
        .eq('bank_id', paymentBankId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let subscriptionRow: any = null;

      if (existingSub) {
        const { data: updatedSub, error: subUpdateErr } = await supabase
          .from('subscriptions')
          .update({
            status: 'ACTIVE',
            user_id: payerUser.id,
            bank_id: paymentBankId,
            expires_at: expiresAt,
            updated_at: now
          })
          .eq('id', existingSub.id)
          .select()
          .single();

        if (subUpdateErr) {
          console.error("Error updating subscription in Supabase:", subUpdateErr.message);
          return res.status(500).json({ error: `Payment approval aborted: Subscription update failed (${subUpdateErr.message}).` });
        }
        subscriptionRow = updatedSub;
      } else {
        const { data: insertedSub, error: subInsertErr } = await supabase
          .from('subscriptions')
          .insert({
            user_id: payerUser.id,
            bank_id: paymentBankId,
            status: 'ACTIVE',
            expires_at: expiresAt,
            created_at: now,
            updated_at: now
          })
          .select()
          .single();

        if (subInsertErr) {
          console.error("Error creating subscription in Supabase:", subInsertErr.message);
          return res.status(500).json({ error: `Payment approval aborted: Subscription creation failed (${subInsertErr.message}).` });
        }
        subscriptionRow = insertedSub;
      }

      console.log(`[SUB_APPROVE] userDbId=${payerUser.id} telegramId=${payerUser.telegram_id} subscriptionId=${subscriptionRow.id} paymentId=${existingPayment.id} expiresAt=${expiresAt}`);

      // Update payment record to APPROVED (linked to resolved user UUID).
      // PART 14: reviewer fields (reviewed_by/reviewed_at) are only persisted if the
      // schema actually supports them — see updatePaymentReviewStatus().
      const { data: updatedPayment, error: updateErr, reviewerFieldsPersisted } =
        await updatePaymentReviewStatus(supabase, existingPayment.id, 'APPROVED', userRow.id, payerUser.id);

      if (updateErr) {
        // PART 3 fix: this is the exact partial-success state — the subscription
        // is genuinely ACTIVE at this point, but the payment row could not be
        // marked APPROVED. We report this explicitly instead of a generic failure,
        // and include machine-readable fields so the frontend can show the real state.
        console.error(
          `[SUB_APPROVE_PARTIAL] userDbId=${payerUser.id} paymentId=${existingPayment.id} subscriptionId=${subscriptionRow.id} error="${updateErr.message}"`
        );
        return res.status(500).json({
          error: `Subscription was activated, but updating the payment status failed: ${updateErr.message}`,
          partialSuccess: true,
          subscriptionActivated: true,
          paymentUpdated: false,
          subscription: subscriptionRow
        });
      }

      if (!reviewerFieldsPersisted) {
        console.warn(`[SUB_APPROVE] paymentId=${existingPayment.id} approved successfully, but reviewer metadata (reviewed_by/reviewed_at) was not stored — schema does not have these columns.`);
      }

      // Attempt to send automated Telegram confirmation message to the user.
      // Mirrors bot.py's monitor_payment() approval flow exactly: send the
      // plain success confirmation first, THEN check profile completeness
      // (Supabase is authoritative — never assume) and only send the
      // WebApp button once the profile is actually complete. If name
      // and/or email are still missing, prompt for exactly what's missing
      // instead, so the app link is never sent before the account is
      // actually usable.
      try {
        let telegramChatId = existingPayment.telegram_user_id || updatedPayment.telegram_user_id || payerUser.telegram_id;
        if (telegramChatId) {
          const appUrl = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'https://u-jo-resident.run.app';

          await sendTelegramMessage(
            telegramChatId,
            `🎉 تم الاشتراك بنجاح!\n\n✅ تم تفعيل اشتراكك في U JO TAJNEED.\n📅 ينتهي الاشتراك في: ${new Date(expiresAt).toLocaleDateString('en-GB')}`
          );

          const hasName = Boolean(payerUser.full_name);
          const hasPhone = Boolean(payerUser.phone_number);
          const hasEmail = Boolean(payerUser.email);

          if (hasName && hasPhone && hasEmail) {
            const replyMarkup = {
              inline_keyboard: [
                [{ text: "🩺 فتح U JO TAJNEED", web_app: { url: appUrl } }]
              ]
            };
            await sendTelegramMessage(telegramChatId, "بياناتك مكتملة بالفعل — تفضل بالدخول إلى U JO TAJNEED:", replyMarkup);
          } else if (!hasName) {
            await sendTelegramMessage(telegramChatId, "يرجى إرسال اسمك الثلاثي باللغة الإنجليزية.\n\nمثال: Ahmad Mohammad Ali");
          } else if (!hasPhone) {
            await sendTelegramMessage(telegramChatId, "يرجى إرسال رقم هاتفك الأردني.\n\nمثال: 0798813251");
          } else {
            await sendTelegramMessage(telegramChatId, "يرجى إرسال بريدك الإلكتروني.\n\nمثال: ahmad@example.com");
          }

          console.log(`[SUB_APPROVE] Telegram confirmation sent to chatId=${telegramChatId}, profileComplete=${hasName && hasPhone && hasEmail}`);
        } else {
          console.warn(`[SUB_APPROVE] paymentId=${existingPayment.id} approved, but telegramChatId could not be resolved for notification.`);
        }
      } catch (notifyErr: any) {
        console.error(`[SUB_APPROVE] Telegram notification failed for paymentId=${existingPayment.id}:`, notifyErr?.message || notifyErr);
      }

      return res.json({
        success: true,
        approved: true,
        status: 'APPROVED',
        payment: mapDbRowToPayment(updatedPayment),
        subscription: subscriptionRow
      });
    } catch (err: any) {
      console.error("Error in POST /api/admin/payments/:id/approve:", err);
      return res.status(500).json({ error: err.message || "Failed to approve payment." });
    }
  });

  // POST /api/admin/payments/:id/reject - Admin-only rejection; does not touch subscriptions
  app.post("/api/admin/payments/:id/reject", async (req, res) => {
    try {
      const requesterId = (req.headers['x-telegram-user-id'] || req.query.telegramUserId || req.body?.telegramUserId || '') as string;
      const requesterUsername = (req.headers['x-telegram-username'] || req.query.username || req.body?.username || '') as string;

      if (!requesterId && !requesterUsername) {
        return res.status(401).json({ error: "Authentication required: Telegram user identity headers missing." });
      }

      const paymentId = req.params.id;
      if (!paymentId) return res.status(400).json({ error: "Payment id parameter is required." });

      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: "Supabase client not configured." });

      const userRow = await getOrCreateSupabaseUser(requesterId, requesterUsername);
      const isAuthorizedAdmin =
        (userRow && userRow.role === 'admin') ||
        verifyServerAdminAuthorization(requesterId) ||
        verifyServerAdminAuthorization(requesterUsername);

      if (!isAuthorizedAdmin || !userRow || !userRow.id) {
        return res.status(403).json({ error: "Access denied: Administrator privileges required." });
      }

      const { data: existingPayment, error: fetchErr } = await supabase
        .from('payments')
        .select('*')
        .or(`id.eq.${paymentId},custom_id.eq.${paymentId}`)
        .maybeSingle();

      if (fetchErr) return res.status(500).json({ error: fetchErr.message });
      if (!existingPayment) return res.status(404).json({ error: "Payment request not found." });

      if (String(existingPayment.status).toUpperCase() !== 'PENDING') {
        return res.status(400).json({ error: `Payment request has already been reviewed (status: ${existingPayment.status}).` });
      }

      // Rejecting a payment never touches subscriptions.
      // PART 14: same schema-safe helper as approve, so reject can't fail
      // silently on the same optional reviewer columns.
      const { data: updatedPayment, error: updateErr, reviewerFieldsPersisted } =
        await updatePaymentReviewStatus(supabase, existingPayment.id, 'REJECTED', userRow.id);

      if (updateErr) {
        console.error(`[SUB_REJECT] paymentId=${existingPayment.id} error="${updateErr.message}"`);
        return res.status(500).json({ error: updateErr.message });
      }

      if (!reviewerFieldsPersisted) {
        console.warn(`[SUB_REJECT] paymentId=${existingPayment.id} rejected successfully, but reviewer metadata was not stored — schema does not have these columns.`);
      }

      console.log(`[SUB_REJECT] paymentId=${existingPayment.id} telegramId=${existingPayment.telegram_user_id || 'N/A'}`);

      // Send rejection Telegram message to user
      try {
        let telegramChatId = existingPayment.telegram_user_id || updatedPayment.telegram_user_id;
        if (!telegramChatId && existingPayment.user_id) {
          const { data: payerUser } = await supabase
            .from('users')
            .select('telegram_id')
            .eq('id', existingPayment.user_id)
            .maybeSingle();
          if (payerUser?.telegram_id) {
            telegramChatId = payerUser.telegram_id;
          }
        }

        if (telegramChatId) {
          const rejectionMsg = `❌ تم رفض طلب الدفع الخاص بك من قبل الإدارة.\n\nيرجى التواصل مع الإدارة إذا كنت تعتقد أن هناك خطأ.`;
          await sendTelegramMessage(telegramChatId, rejectionMsg);
        } else {
          console.warn("[Telegram Bot] Payment rejected, but telegramChatId could not be resolved for notification.");
        }
      } catch (notifyErr) {
        console.error("Error sending Telegram rejection notification:", notifyErr);
      }

      return res.json({
        success: true,
        rejected: true,
        status: 'REJECTED',
        payment: mapDbRowToPayment(updatedPayment)
      });
    } catch (err: any) {
      console.error("Error in POST /api/admin/payments/:id/reject:", err);
      return res.status(500).json({ error: err.message || "Failed to reject payment." });
    }
  });

  // ==================================================
  // TELEGRAM BOT WEBHOOK HANDLER FOR ISSUE 3
  // ==================================================
  const handleTelegramWebhook = async (req: express.Request, res: express.Response) => {
    try {
      const update = req.body;
      if (!update) return res.status(200).send("OK");

      const supabase = getSupabase();
      if (!supabase) return res.status(200).send("OK (Database unavailable)");

      const appUrl = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'https://u-jo-tajneed.onrender.com';

      const BANK_LABELS: Record<string, string> = {
        human_medicine: 'الطب البشري',
        dentistry: 'طب الأسنان'
      };

      const getBankPricing = async (bankId: string) => {
        const { data } = await supabase
          .from('bank_pricing')
          .select('*')
          .eq('bank_id', bankId)
          .maybeSingle();
        return data;
      };

      const siteButton = () => ({
        inline_keyboard: [[{ text: "🩺 فتح U JO TAJNEED", web_app: { url: appUrl } }]]
      });

      const promptForMissingProfile = async (chatIdArg: string | number, needName: boolean, needPhone: boolean, needEmail: boolean) => {
        // Sequential, one field at a time — Name, then Phone, then Email —
        // per the required flow order (Payment Approved → Phone → Email →
        // Platform Access), extended to keep the existing Name step first.
        if (needName) {
          await sendTelegramMessage(chatIdArg, "يرجى إرسال اسمك الثلاثي باللغة الإنجليزية.\n\nمثال: Ahmad Mohammad Ali");
        } else if (needPhone) {
          await sendTelegramMessage(chatIdArg, "يرجى إرسال رقم هاتفك الأردني.\n\nمثال: 0798813251");
        } else if (needEmail) {
          await sendTelegramMessage(chatIdArg, "يرجى إرسال بريدك الإلكتروني.\n\nمثال: ahmad@example.com");
        }
      };

      // ==========================================================
      // CALLBACK QUERY — bank-choice button presses
      // ==========================================================
      if (update.callback_query) {
        const cq = update.callback_query;
        const cqChatId = cq.message?.chat?.id || cq.from.id;
        const cqData = String(cq.data || '');
        const cqUser = cq.from;
        const cqTgId = String(cqUser.id).trim();
        const cqUsername = cqUser.username ? String(cqUser.username).trim() : null;

        if (cqData.startsWith('subscribe:')) {
          const chosenBankId = cqData.split(':')[1];
          if (!BANK_LABELS[chosenBankId]) {
            await answerCallbackQuery(cq.id);
            return res.status(200).send("OK");
          }

          const cqUserRow = await getOrCreateSupabaseUser(cqTgId, cqUsername);
          if (cqUserRow?.id) {
            await supabase.from('users').update({ pending_payment_bank_id: chosenBankId }).eq('id', cqUserRow.id);
          }

          const pricing = await getBankPricing(chosenBankId);
          const price = pricing?.price ?? 25;
          const payNum = pricing?.payment_number || '0798813251';

          await answerCallbackQuery(cq.id);
          await sendTelegramMessage(
            cqChatId,
            `💳 اشتراك ${BANK_LABELS[chosenBankId]}\n\nسعر الاشتراك: ${price} دينار\n\nطرق الدفع:\n• Zain Cash\n• CliQ\n\n📱 رقم الدفع: ${payNum}\n\nبعد إجراء الحوالة، أرسل صورة الحوالة هنا 📸\n\n⏳ سيتم مراجعة طلبك من الإدارة، وبعد الموافقة سيتم تفعيل اشتراكك في ${BANK_LABELS[chosenBankId]}.`
          );
          return res.status(200).send("OK");
        }

        // ------------------------------------------------------
        // ADMIN APPROVE / REJECT — pressed directly on the payment
        // notification sent to the admin's own Telegram chat. Only a
        // verified admin identity may trigger these, and they reuse the
        // EXACT SAME endpoints the web admin dashboard already uses (via
        // an internal localhost call), so behavior never diverges between
        // the two approval paths.
        // ------------------------------------------------------
        if (cqData.startsWith('approve_payment:') || cqData.startsWith('reject_payment:')) {
          const isApproverAdmin = verifyServerAdminAuthorization(cqTgId) || verifyServerAdminAuthorization(cqUsername);
          if (!isApproverAdmin) {
            await answerCallbackQuery(cq.id, 'غير مصرح لك بهذا الإجراء.');
            return res.status(200).send("OK");
          }

          const isApprove = cqData.startsWith('approve_payment:');
          const paymentId = cqData.split(':')[1];

          try {
            const actionRes = await fetch(
              `http://localhost:${PORT}/api/admin/payments/${paymentId}/${isApprove ? 'approve' : 'reject'}`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-telegram-user-id': cqTgId,
                  'x-telegram-username': cqUsername || ''
                }
              }
            );

            if (actionRes.ok) {
              await answerCallbackQuery(cq.id, isApprove ? 'تمت الموافقة ✅' : 'تم الرفض ❌');
              // Edit the original notification so the admin sees the
              // outcome and can't double-press the same buttons.
              const token = getTelegramBotToken();
              if (token && cq.message?.message_id) {
                await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: cqChatId,
                    message_id: cq.message.message_id,
                    reply_markup: { inline_keyboard: [[{ text: isApprove ? '✅ تمت الموافقة' : '❌ تم الرفض', callback_data: 'noop' }]] }
                  })
                });
              }
            } else {
              const errBody = await actionRes.json().catch(() => ({} as any));
              await answerCallbackQuery(cq.id, `فشل: ${errBody.error || 'خطأ غير معروف'}`);
            }
          } catch (actionErr: any) {
            console.error('[BOT_WEBHOOK] admin approve/reject error:', actionErr?.message || actionErr);
            await answerCallbackQuery(cq.id, 'حدث خطأ أثناء تنفيذ الإجراء.');
          }
          return res.status(200).send("OK");
        }

        await answerCallbackQuery(cq.id);
        return res.status(200).send("OK");
      }

      const message = update.message || update.edited_message;
      if (!message || !message.from) return res.status(200).send("OK");

      const fromUser = message.from;
      const chatId = message.chat.id || fromUser.id;
      const text = String(message.text || '').trim();
      const rawTgId = String(fromUser.id).trim();
      const tgUsername = fromUser.username ? String(fromUser.username).trim() : null;
      const telegramFullName = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ').trim();

      if (!rawTgId) return res.status(200).send("OK");

      // ADMIN
      const isAdminUser = verifyServerAdminAuthorization(rawTgId) || verifyServerAdminAuthorization(tgUsername);
      if (isAdminUser) {
        if (text.startsWith('/start')) {
          await sendTelegramMessage(
            chatId,
            "👑 أهلاً بك\n\nمرحباً بك في لوحة إدارة U JO TAJNEED.\n\n🩺 U JO TAJNEED هو منصة أسئلة مخصصة للتحضير لامتحان الخدمات الطبية (طب بشري وأسنان).\n\nيمكنك الدخول إلى الموقع وإدارة المستخدمين، طلبات الدفع والاشتراكات من خلال لوحة الإدارة.",
            siteButton()
          );
        }
        return res.status(200).send("OK");
      }

      // NORMAL USER
      const userRow = await getOrCreateSupabaseUser(rawTgId, tgUsername, telegramFullName);
      if (!userRow || !userRow.id) return res.status(200).send("OK");

      const hasName = Boolean(userRow.full_name);
      const hasPhone = Boolean(userRow.phone_number);
      const hasEmail = Boolean(userRow.email);

      const [humanMedAuth, dentAuth] = await Promise.all([
        resolveAuthoritativeUserSubscription(userRow.id, 'human_medicine'),
        resolveAuthoritativeUserSubscription(userRow.id, 'dentistry')
      ]);
      const bankAuth: Record<string, any> = { human_medicine: humanMedAuth, dentistry: dentAuth };
      const subscribedToAny = humanMedAuth.isSubscribed || dentAuth.isSubscribed;

      if (text.startsWith('/start')) {
        if (subscribedToAny && (!hasName || !hasPhone || !hasEmail)) {
          await promptForMissingProfile(chatId, !hasName, !hasPhone, !hasEmail);
          return res.status(200).send("OK");
        }

        const bodyLines: string[] = ["🤖 أهلاً وسهلاً بك في U JO TAJNEED", "", "🩺 منصة أسئلة للتحضير لامتحان الخدمات الطبية (طب بشري وأسنان).", ""];
        const buttons: any[] = [];

        for (const bankId of ['human_medicine', 'dentistry']) {
          const auth = bankAuth[bankId];
          const label = BANK_LABELS[bankId];
          if (auth.isSubscribed) {
            const expiryText = auth.subscription?.expires_at
              ? new Date(auth.subscription.expires_at).toLocaleDateString('en-GB')
              : 'مفتوح';
            bodyLines.push(`✅ ${label}: مفعّل (ينتهي ${expiryText})`);
          } else {
            const isExpired = auth.subscription && String(auth.subscription.status || '').toUpperCase() === 'EXPIRED';
            bodyLines.push(`❌ ${label}: ${isExpired ? 'منتهي' : 'غير مفعّل'}`);
            buttons.push([{ text: `💳 اشترك في ${label}`, callback_data: `subscribe:${bankId}` }]);
          }
        }

        if (subscribedToAny) {
          buttons.unshift([{ text: "🩺 فتح U JO TAJNEED", web_app: { url: appUrl } }]);
        }

        await sendTelegramMessage(chatId, bodyLines.join('\n'), { inline_keyboard: buttons });
        return res.status(200).send("OK");
      }

      // PHOTO — payment proof upload
      if (Array.isArray(message.photo) && message.photo.length > 0) {
        const pendingBankId = userRow.pending_payment_bank_id;

        if (!pendingBankId || !BANK_LABELS[pendingBankId]) {
          await sendTelegramMessage(chatId, "يرجى أولاً اختيار البنك الذي تريد الاشتراك فيه عبر /start قبل إرسال صورة الحوالة.");
          return res.status(200).send("OK");
        }

        if (bankAuth[pendingBankId].isSubscribed) {
          await sendTelegramMessage(chatId, `اشتراكك في ${BANK_LABELS[pendingBankId]} مفعّل بالفعل. اكتب /start لفتح التطبيق.`, siteButton());
          return res.status(200).send("OK");
        }

        const pricing = await getBankPricing(pendingBankId);
        const largestPhoto = message.photo[message.photo.length - 1];
        try {
          const submitRes = await fetch(`http://localhost:${PORT}/api/payments/submit`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-telegram-user-id': rawTgId,
              'x-telegram-username': tgUsername || ''
            },
            body: JSON.stringify({
              telegramId: rawTgId,
              username: tgUsername || '',
              bankId: pendingBankId,
              amount_syp: pricing?.price ?? 25,
              paymentMethod: 'Zain Cash / CliQ',
              proofFileId: largestPhoto.file_id
            })
          });

          if (submitRes.ok) {
            await supabase.from('users').update({ pending_payment_bank_id: null }).eq('id', userRow.id);
            await sendTelegramMessage(
              chatId,
              `✅ تم استلام صورة الحوالة بنجاح لاشتراك ${BANK_LABELS[pendingBankId]}.\n\n⏳ طلبك الآن قيد المراجعة.\n\n📩 عند الموافقة على الطلب، ستصلك رسالة تلقائية هنا.`
            );
          } else {
            await sendTelegramMessage(chatId, "❌ حدثت مشكلة أثناء تسجيل الحوالة.\n\nيرجى المحاولة مرة أخرى.");
          }
        } catch (submitErr: any) {
          console.error('[BOT_WEBHOOK] payment submit error:', submitErr?.message || submitErr);
          await sendTelegramMessage(chatId, "❌ حدثت مشكلة في الاتصال بالخادم.\n\nيرجى المحاولة مرة أخرى.");
        }
        return res.status(200).send("OK");
      }

      // TEXT (non-command) — sequential profile collection: Name, then
      // Phone (Jordanian 07XXXXXXXX), then Email — one field per message,
      // per the required post-approval flow order.
      if (text && !text.startsWith('/')) {
        if (subscribedToAny && (!hasName || !hasPhone || !hasEmail)) {
          const payload: any = { telegramId: rawTgId, username: tgUsername || '' };
          let expectedField: 'fullName' | 'phoneNumber' | 'email';

          if (!hasName) {
            payload.fullName = text;
            expectedField = 'fullName';
          } else if (!hasPhone) {
            payload.phoneNumber = text;
            expectedField = 'phoneNumber';
          } else {
            payload.email = text;
            expectedField = 'email';
          }

          try {
            const saveRes = await fetch(`http://localhost:${PORT}/api/users/profile`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-telegram-user-id': rawTgId,
                'x-telegram-username': tgUsername || ''
              },
              body: JSON.stringify(payload)
            });

            if (!saveRes.ok) {
              const errData = await saveRes.json().catch(() => ({} as any));
              if (errData.field === 'fullName') {
                await sendTelegramMessage(chatId, "⚠️ الاسم غير واضح. يرجى إرسال اسمك الثلاثي بالإنجليزية فقط.\n\nمثال: Ahmad Mohammad Ali");
              } else if (errData.field === 'phoneNumber') {
                await sendTelegramMessage(chatId, errData.error || "⚠️ رقم الهاتف غير صحيح. يرجى إرسال رقم أردني صحيح يبدأ بـ 07، مثال: 0798813251");
              } else if (errData.field === 'email') {
                await sendTelegramMessage(chatId, "⚠️ صيغة البريد الإلكتروني غير صحيحة.\n\nمثال: ahmad@example.com\n\nيرجى إعادة إرسال البريد الإلكتروني.");
              } else {
                await sendTelegramMessage(chatId, "❌ حدثت مشكلة أثناء حفظ البيانات. يرجى المحاولة مرة أخرى.");
              }
              return res.status(200).send("OK");
            }

            const { data: refreshedUser } = await supabase
              .from('users')
              .select('full_name, phone_number, email')
              .eq('id', userRow.id)
              .maybeSingle();

            const stillNeedName = !refreshedUser?.full_name;
            const stillNeedPhone = !refreshedUser?.phone_number;
            const stillNeedEmail = !refreshedUser?.email;

            if (!stillNeedName && !stillNeedPhone && !stillNeedEmail) {
              await sendTelegramMessage(
                chatId,
                "✅ تم حفظ بياناتك بنجاح، أنت الآن جاهز.\n\nتفضل بالدخول إلى U JO TAJNEED:",
                siteButton()
              );
            } else {
              await promptForMissingProfile(chatId, stillNeedName, stillNeedPhone, stillNeedEmail);
            }
          } catch (saveErr: any) {
            console.error('[BOT_WEBHOOK] profile save error:', saveErr?.message || saveErr);
            await sendTelegramMessage(chatId, "❌ حدثت مشكلة أثناء حفظ البيانات. يرجى المحاولة مرة أخرى.");
          }
          return res.status(200).send("OK");
        }


        const pendingBankId = userRow.pending_payment_bank_id;
        if (pendingBankId && BANK_LABELS[pendingBankId] && !bankAuth[pendingBankId].isSubscribed) {
          const { data: pendingPayment } = await supabase
            .from('payments')
            .select('id')
            .eq('user_id', userRow.id)
            .eq('bank_id', pendingBankId)
            .eq('status', 'PENDING')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (pendingPayment) {
            await sendTelegramMessage(chatId, "⏳ طلبك قيد المراجعة حاليًا. إذا كنت مشتركاً بالفعل، اكتب /start لفتح التطبيق.");
          } else {
            await sendTelegramMessage(chatId, "📸 يرجى إرسال صورة الحوالة هنا، أو اكتب /start لاختيار البنك أولاً.");
          }
        } else {
          await sendTelegramMessage(chatId, "⏳ اكتب /start لعرض حالة اشتراكك أو فتح التطبيق.");
        }
      }

      return res.status(200).send("OK");
    } catch (err) {
      console.error("Error in Telegram bot webhook:", err);
      return res.status(200).send("OK");
    }
  };

  app.post("/api/telegram/webhook", handleTelegramWebhook);
  app.post("/webhook", handleTelegramWebhook);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    // Telegram's in-app WebView caches index.html far more aggressively than a
    // normal browser and often ignores standard revalidation (ETag/Last-Modified).
    // Since index.html is what determines which hashed JS/CSS bundle gets loaded,
    // a stale cached copy means the client keeps running old code indefinitely
    // even after a successful deploy. The hashed asset files themselves (e.g.
    // index-XXXXXXXX.js) are safe to cache long-term since their filename changes
    // on every build, so only index.html needs the aggressive no-cache treatment.
    app.use(express.static(distPath, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      }
    }));
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`U JO TAJNEED App listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
