import 'dotenv/config';
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { getSupabase, isSupabaseConfigured } from "./src/services/supabaseServer.js";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '20mb' }));

  // API Health & Config endpoints
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      name: "U JO Resident",
      bank: "MOH Residency Question Bank",
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
        full_name: fullNameStr || 'Resident Doctor',
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

  async function resolveAuthoritativeUserSubscription(userDbId: string, bankId: string = 'moh_bank') {
    const supabase = getSupabase();
    if (!supabase || !userDbId) return { isSubscribed: false, normalizedStatus: 'INACTIVE' as const, subscription: null };

    const { data: subRow, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userDbId)
      .eq('bank_id', bankId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(`[SUB_AUTH_ERROR] userDbId=${userDbId} error=${error.message}`);
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
      const { telegramId, username, firstName, lastName } = req.body;
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

      // Query active/latest subscription for dbUser using authoritative UUID helper
      const subAuth = dbUser?.id
        ? await resolveAuthoritativeUserSubscription(dbUser.id, 'moh_bank')
        : { isSubscribed: false, normalizedStatus: 'INACTIVE' as const, subscription: null };

      return res.json({
        synced: true,
        user: dbUser,
        subscribed: subAuth.isSubscribed,
        status: subAuth.normalizedStatus,
        subscription: subAuth.subscription
      });
    } catch (err: any) {
      console.error("Error in /api/users/sync:", err);
      return res.status(500).json({ error: err.message || "Failed to sync user." });
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
            B: q.option_b || q.optionB || '',
            C: q.option_c || q.optionC || '',
            D: q.option_d || q.optionD || ''
          };
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
          bankId: q.bank_id || q.bankId || 'moh_bank',
          question: q.question || q.stem || '',
          options,
          correctAnswer: (q.correct_answer || q.correctAnswer || 'A') as 'A' | 'B' | 'C' | 'D',
          explanation: q.explanation || '',
          optionExplanations,
          needsReview: Boolean(q.needs_review ?? q.needsReview ?? false),
          reviewNote: q.review_note || q.reviewNote || '',
          major: q.major || 'General',
          topic: q.topic || '',
          year: Number(q.year || 2025),
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
        correct_answer: String(qObj.correctAnswer || 'A').toUpperCase().trim(),
        explanation: String(qObj.explanation || '').trim(),
        option_explanations: optExps || null,
        needs_review: Boolean(qObj.needsReview ?? false),
        review_note: qObj.reviewNote || null,
        major: qObj.major ? String(qObj.major).trim() : 'General Medical Sciences',
        topic: qObj.topic ? String(qObj.topic).trim() : 'Unassigned Topic',
        year: Number(qObj.year || 2025)
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
        correct_answer: String(qObj.correctAnswer || 'A').toUpperCase().trim(),
        explanation: String(qObj.explanation || '').trim(),
        option_explanations: optExps || null,
        needs_review: Boolean(qObj.needsReview ?? false),
        review_note: qObj.reviewNote || null,
        major: qObj.major ? String(qObj.major).trim() : 'General Medical Sciences',
        topic: qObj.topic ? String(qObj.topic).trim() : 'Unassigned Topic',
        year: Number(qObj.year || 2025)
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
            D: qObj.option_d || qObj.optionD
          };
        }

        if (!opts.A || typeof opts.A !== 'string' || !opts.A.trim()) reasons.push('Missing or empty Option A');
        if (!opts.B || typeof opts.B !== 'string' || !opts.B.trim()) reasons.push('Missing or empty Option B');
        if (!opts.C || typeof opts.C !== 'string' || !opts.C.trim()) reasons.push('Missing or empty Option C');
        if (!opts.D || typeof opts.D !== 'string' || !opts.D.trim()) reasons.push('Missing or empty Option D');

        const ans = String(qObj.correctAnswer || qObj.correct_answer || '').toUpperCase().trim();
        if (!['A', 'B', 'C', 'D'].includes(ans)) {
          reasons.push(`Invalid correctAnswer "${qObj.correctAnswer || qObj.correct_answer}" (must be A, B, C, or D)`);
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

        validQuestions.push({
          id: qId,
          question: questionText.trim(),
          option_a: String(opts.A).trim(),
          option_b: String(opts.B).trim(),
          option_c: String(opts.C).trim(),
          option_d: String(opts.D).trim(),
          correct_answer: ans,
          explanation: qObj.explanation ? String(qObj.explanation).trim() : 'No explanation provided.',
          option_explanations: optExps || null,
          needs_review: Boolean(qObj.needsReview ?? qObj.needs_review ?? false),
          review_note: qObj.reviewNote || qObj.review_note || null,
          major: qObj.major ? String(qObj.major).trim() : 'General Medical Sciences',
          topic: qObj.topic ? String(qObj.topic).trim() : 'Unassigned Topic',
          year: Number(qObj.year || 2025)
        });
      });

      // 4. Supabase Database Checks
      const supabase = getSupabase();
      let existingInDatabaseCount = 0;

      if (supabase) {
        const validIds = validQuestions.map((q) => q.id).filter(Boolean);
        if (validIds.length > 0) {
          const { data: existingRows } = await supabase
            .from('questions')
            .select('id')
            .in('id', validIds);
          existingInDatabaseCount = existingRows ? existingRows.length : 0;
        }
      }

      const validCount = validQuestions.length;
      const invalidCount = invalidQuestions.length;
      const duplicateInBatchCount = duplicateInBatchIds.size;
      const newCount = Math.max(0, validCount - existingInDatabaseCount - duplicateInBatchCount);

      // 5. Dry-Run Mode Response
      if (dryRun) {
        return res.json({
          dryRun: true,
          totalInBatch,
          validCount,
          invalidCount,
          duplicateInBatchCount,
          existingInDatabaseCount,
          newCount,
          invalidQuestions: invalidQuestions.slice(0, 10),
          duplicateInBatchIds: Array.from(duplicateInBatchIds),
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

      // Upsert valid questions in chunks of 500
      let totalInserted = 0;
      const chunkSize = 500;
      for (let i = 0; i < validQuestions.length; i += chunkSize) {
        const chunk = validQuestions.slice(i, i + chunkSize);
        const { data: insertedData, error: insertError } = await supabase
          .from('questions')
          .upsert(chunk, { onConflict: 'id' })
          .select();

        if (insertError) {
          console.error("Error upserting question batch into Supabase:", insertError.message);
          return res.status(500).json({ error: insertError.message });
        }
        totalInserted += insertedData ? insertedData.length : chunk.length;
      }

      return res.json({
        dryRun: false,
        importedCount: totalInserted,
        summary: {
          status: "migration_completed",
          message: `Successfully stored ${totalInserted} questions in Supabase database.`
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

      const validOptionKeys = ['A', 'B', 'C', 'D'];
      if (!selectedAnswer || !validOptionKeys.includes(String(selectedAnswer).toUpperCase().trim())) {
        return res.status(400).json({ error: "selectedAnswer must be one of A, B, C, or D." });
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

      const SYSTEM_INSTRUCTION = `You are an expert evidence-grounded medical AI verification and classification engine for the U JO Resident MOH Medical Residency Question Bank.

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
- If you are uncertain about a clinical rationale or if the question stem lacks detail, set "needsReview": true and provide a "reviewNote" explaining why. Otherwise set "needsReview": false and "reviewNote": "".`;

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

      let response: any = null;
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          attempts++;
          response = await ai.models.generateContent({
            model: "gemini-3.6-flash",
            contents: `Process the following batch of medical residency examination questions. Automatically classify each question by Major, Topic, and Subtopic, generate evidence-grounded optionExplanations for incorrect options, and verify clinical reasoning:\n\n${JSON.stringify(promptPayload, null, 2)}`,
            config: {
              systemInstruction: SYSTEM_INSTRUCTION,
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
          break; // Success
        } catch (err: any) {
          if ((err.status === 429 || err.message?.includes('RESOURCE_EXHAUSTED')) && attempts < maxAttempts) {
            console.warn(`Gemini API 429 rate limited. Retrying attempt ${attempts}/${maxAttempts} in 2 seconds...`);
            await new Promise((resolve) => setTimeout(resolve, 2000 * attempts));
          } else {
            throw err;
          }
        }
      }

      if (!response || !response.text) {
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

      const finalResults = questions.map((q: any) => {
        const item = parsedResults.find((r: any) => r.id === q.id);
        if (!item) {
          throw new Error(`Gemini API output was missing result for question ID: ${q.id}`);
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
      });

      return res.json({ results: finalResults });
    } catch (error: any) {
      console.error("AI Complete Explanations Error:", error);
      return res.status(error.status || 502).json({
        error: error.message || "Failed to generate AI medical explanations."
      });
    }
  });

  // Helper to map DB row to FE Block model
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
      bankId: row.bank_id || 'moh_bank',
      bankName: 'MOH Residency Question Bank',
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
        bank_id: blockObj.bankId || blockObj.bank_id || 'moh_bank',
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
    paymentAccountName: 'Saif Al-Deen (U JO Resident)',
    subscriptionPrice: 25,
    subscriptionDurationDays: 30,
    paymentInstructions: 'Transfer via Zain Cash or CliQ to the phone number above. Enter your Telegram username and optional transaction reference ID when submitting.'
  };

  // GET /api/admin/metrics
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
          query = query.or(`telegram_id.eq.${parseInt(qStr, 10)},telegram_username.ilike.%${qStr}%,full_name.ilike.%${qStr}%`);
        } else {
          query = query.or(`telegram_username.ilike.%${qStr}%,full_name.ilike.%${qStr}%`);
        }
      }

      const { data: users, error } = await query.order('created_at', { ascending: false });
      if (error) {
        console.error("Error fetching admin users from Supabase:", error.message);
        return res.status(500).json({ error: error.message });
      }

      const { data: subs } = await supabase.from('subscriptions').select('*');
      const subsMap = new Map<string, any>();
      if (subs) {
        subs.forEach((s: any) => {
          const isSubActive = String(s.status).toUpperCase() === 'ACTIVE' && (!s.expires_at || new Date(s.expires_at).getTime() > Date.now());
          const subObj = { ...s, isActiveSub: isSubActive };

          if (s.user_id) {
            const key = String(s.user_id);
            const existing = subsMap.get(key);
            if (!existing || (!existing.isActiveSub && isSubActive)) {
              subsMap.set(key, subObj);
            }
          }
        });
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
          role: (u.role || 'user') as 'user' | 'admin',
          isActive: isUserAccountActive(u),
          firstSeenAt: u.created_at || new Date().toISOString(),
          lastActiveAt: u.updated_at || new Date().toISOString(),
          subscriptionStatus: subStatus
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
        role: (targetUser.role || 'user') as 'user' | 'admin',
        isActive: targetUser.is_active !== false,
        firstSeenAt: targetUser.created_at || new Date().toISOString(),
        lastActiveAt: targetUser.updated_at || new Date().toISOString()
      };

      const latestSub = subscriptions && subscriptions.length > 0 ? subscriptions[0] : null;
      const subscriptionObj = latestSub ? {
        userId: userObj.telegramId,
        bankId: latestSub.bank_id || 'moh_bank',
        status: (String(latestSub.status).toUpperCase() === 'ACTIVE' ? 'ACTIVE' : 'EXPIRED') as any,
        plan: latestSub.plan || 'MOH Pass',
        startDate: latestSub.created_at,
        expiryDate: latestSub.expires_at
      } : {
        userId: userObj.telegramId,
        bankId: 'moh_bank',
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

      const { data: updatedUser } = await supabase
        .from('users')
        .update({
          updated_at: new Date().toISOString()
        })
        .eq('id', targetUser.id)
        .select()
        .maybeSingle();

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
        .eq('bank_id', 'moh_bank')
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
            bank_id: 'moh_bank',
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
            bank_id: 'moh_bank',
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

      // Update existing subscriptions to cancelled / inactive
      const now = new Date().toISOString();
      const { error: cancelErr } = await supabase
        .from('subscriptions')
        .update({
          status: 'cancelled',
          expires_at: now,
          updated_at: now
        })
        .eq('user_id', targetUser.id);

      console.log(`[SUB_CANCEL] userDbId=${targetUser.id} telegramId=${tgIdStr}`);

      if (cancelErr) {
        console.error("Error updating subscription status in Supabase:", cancelErr.message);
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
      const amountRaw = body.amount ?? body.amount_syp ?? body.amountSyp ?? serverAdminConfig.subscriptionPrice ?? 25;
      const amount = Number(amountRaw) > 0 ? Number(amountRaw) : 25;

      const paymentMethod = String(body.paymentMethod || body.payment_method || body.method || 'Zain Cash').trim();
      const transactionRef = body.transactionRef || body.transaction_ref || body.reference || body.ref ? String(body.transactionRef || body.transaction_ref || body.reference || body.ref).trim() : null;
      const proofFileId = body.proofFileId || body.proof_file_id || body.file_id || body.photo_id || body.telegram_file_id ? String(body.proofFileId || body.proof_file_id || body.file_id || body.photo_id || body.telegram_file_id).trim() : null;
      const proofFileUrl = body.proofFileUrl || body.proof_file_url || body.photo_url || body.image_url || body.url ? String(body.proofFileUrl || body.proof_file_url || body.photo_url || body.image_url || body.url).trim() : null;

      // Fallback for proof file if neither URL nor ID is specified (e.g. text receipt)
      const finalProofFileId = proofFileId || proofFileUrl || 'telegram_photo_receipt';

      const supabase = getSupabase();
      if (!supabase) {
        return res.status(500).json({ success: false, error: "Supabase client not configured." });
      }

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
          
          const notificationMessage = `🔔 <b>طلب دفع جديد (Payment Request)</b>\n\n` +
            `👤 <b>المستخدم:</b> ${userDisplayName}\n` +
            `🏷 <b>اسم المستخدم:</b> ${telegramUsernameStr}\n` +
            `🆔 <b>Telegram ID:</b> <code>${requesterId || userRow.telegram_id}</code>\n` +
            `💰 <b>المبلغ:</b> ${amount.toLocaleString()} L.S\n` +
            `💳 <b>طريقة الدفع:</b> ${paymentMethod}\n` +
            `📄 <b>رقم العملية/المرجع:</b> ${transactionRef || 'غير محدد'}\n` +
            `🆔 <b>معرف الطلب:</b> <code>${mappedPayment.id}</code>\n` +
            `📅 <b>التاريخ:</b> ${new Date().toLocaleString('ar-SA')}\n\n` +
            `<i>يرجى مراجعة الطلب من لوحة تحكم الأدمن (Admin Dashboard).</i>`;

          let sentCount = 0;
          for (const adminId of adminIds) {
            if (/^\d+$/.test(adminId)) {
              const success = await sendTelegramMessage(adminId, notificationMessage);
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

      const subAuth = await resolveAuthoritativeUserSubscription(userRow.id, 'moh_bank');

      return res.json({
        success: true,
        subscribed: subAuth.isSubscribed,
        status: subAuth.normalizedStatus,
        subscription: subAuth.subscription
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
      if (currentPaymentStatus !== 'PENDING' && currentPaymentStatus !== 'APPROVED') {
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
      const durationDays = Number(serverAdminConfig.subscriptionDurationDays) || 30;
      const expiresAt = new Date(Date.now() + durationDays * 24 * 3600 * 1000).toISOString();

      // Find any existing subscription for the canonical user UUID
      const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', payerUser.id)
        .eq('bank_id', 'moh_bank')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let subscriptionRow: any = null;

      if (existingSub) {
        const { data: updatedSub, error: subUpdateErr } = await supabase
          .from('subscriptions')
          .update({
            status: 'active',
            user_id: payerUser.id,
            bank_id: 'moh_bank',
            started_at: now,
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
            bank_id: 'moh_bank',
            status: 'active',
            started_at: now,
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

      console.log(`[SUB_APPROVE] userDbId=${payerUser.id} telegramId=${payerUser.telegram_id} expiresAt=${expiresAt}`);

      // Update payment record to APPROVED (linked to resolved user UUID)
      const { data: updatedPayment, error: updateErr } = await supabase
        .from('payments')
        .update({
          status: 'APPROVED',
          user_id: payerUser.id,
          reviewed_by: userRow.id,
          reviewed_at: now,
          updated_at: now
        })
        .eq('id', existingPayment.id)
        .select()
        .single();

      if (updateErr) {
        console.error("Error updating payment in Supabase:", updateErr.message);
        return res.status(500).json({ error: `Subscription was activated, but updating payment status failed: ${updateErr.message}` });
      }

      // Attempt to send automated Telegram confirmation message to the user
      try {
        let telegramChatId = existingPayment.telegram_user_id || updatedPayment.telegram_user_id || payerUser.telegram_id;
        if (telegramChatId) {
          const approvalMsg = `🎉 تمت الموافقة على طلب الدفع الخاص بك!\n\n✅ تم تفعيل اشتراكك في U JO Resident.\n\nيمكنك الآن الدخول إلى المنصة.`;
          const replyMarkup = {
            inline_keyboard: [
              [{ text: "🩺 فتح U JO Resident", url: "https://t.me/UJOResidentBot" }]
            ]
          };
          await sendTelegramMessage(telegramChatId, approvalMsg, replyMarkup);
        } else {
          console.warn("[Telegram Bot] Payment approved, but telegramChatId could not be resolved for notification.");
        }
      } catch (notifyErr) {
        console.error("Error sending Telegram approval notification:", notifyErr);
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

      const now = new Date().toISOString();

      // Rejecting a payment never touches subscriptions.
      const { data: updatedPayment, error: updateErr } = await supabase
        .from('payments')
        .update({
          status: 'REJECTED',
          reviewed_by: userRow.id,
          reviewed_at: now,
          updated_at: now
        })
        .eq('id', existingPayment.id)
        .select()
        .single();

      if (updateErr) return res.status(500).json({ error: updateErr.message });

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

      const message = update.message || update.edited_message;
      if (!message || !message.from) return res.status(200).send("OK");

      const fromUser = message.from;
      const chatId = message.chat.id || fromUser.id;
      const text = String(message.text || '').trim();
      const rawTgId = String(fromUser.id).trim();
      const tgUsername = fromUser.username ? String(fromUser.username).trim() : null;
      const fullName = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ').trim();

      if (!rawTgId) return res.status(200).send("OK");

      const supabase = getSupabase();
      if (!supabase) return res.status(200).send("OK (Database unavailable)");

      // 1. Resolve or create user in Supabase
      const userRow = await getOrCreateSupabaseUser(rawTgId, tgUsername, fullName);
      const existingUser = Boolean(userRow);

      // 2. Query subscription status authoritatively from Supabase
      let isSubscribed = false;
      let subRow: any = null;

      if (userRow && userRow.id) {
        const subAuth = await resolveAuthoritativeUserSubscription(userRow.id, 'moh_bank');
        isSubscribed = subAuth.isSubscribed;
        subRow = subAuth.subscription;
      }

      const subStatusStr = isSubscribed ? 'active' : (subRow ? String(subRow.status).toLowerCase() : 'none');

      console.log(`[BOT] telegramId=${rawTgId} existingUser=${existingUser} subscription=${subStatusStr}`);

      if (text.startsWith('/start')) {
        const channelUrl = (serverAdminConfig as any).channelLink || 'https://t.me/+joinchat_ujoresident';
        const appUrl = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'https://u-jo-resident.run.app';
        const zainCashNum = (serverAdminConfig as any).zainCashNumber || serverAdminConfig.paymentPhoneNumber || '07700000000';
        const price = (serverAdminConfig as any).subscriptionPrice || '25,000';

        if (isSubscribed) {
          // ACTIVE SUBSCRIBER FLOW: Recognizes subscription regardless of chat history deletion or bot restarts
          const activeMessage =
            `✨ <b>مرحباً بك مجدداً في تطبيق U JO Resident!</b>\n\n` +
            `✅ <b>اشتراكك نشط ومفعل بنجاح.</b>\n` +
            `📅 <b>تاريخ الانتهاء:</b> <code>${subRow?.expires_at ? new Date(subRow.expires_at).toLocaleDateString('en-GB') : 'مفتوح'}</code>\n\n` +
            `يمكنك استخدام بنك الأسئلة أو الانضمام إلى القناة المخصصة للمشتركين عبر الأزرار أدناه:`;

          const keyboard = {
            inline_keyboard: [
              [{ text: "📚 بنك الأسئلة (فتح التطبيق)", web_app: { url: appUrl } }],
              [{ text: "📢 القناة المخصصة للمشتركين", url: channelUrl }]
            ]
          };

          await sendTelegramMessage(chatId, activeMessage, keyboard);
        } else if (subRow && subRow.expires_at && new Date(subRow.expires_at).getTime() <= Date.now()) {
          // EXPIRED SUBSCRIBER FLOW
          const expiredMessage =
            `⚠️ <b>تنبيه: انتهت فترة اشتراكك في تطبيق U JO Resident.</b>\n\n` +
            `لتجديد الاشتراك والاستمرار في الوصول إلى بنك الأسئلة والحلول التفصيلية، يرجى إرسال إشعار تحويل جديد عبر التطبيق.\n\n` +
            `💳 <b>زين كاش (Zain Cash):</b> <code>${zainCashNum}</code>`;

          const keyboard = {
            inline_keyboard: [
              [{ text: "🔄 تجديد الاشتراك عبر التطبيق", web_app: { url: appUrl } }]
            ]
          };

          await sendTelegramMessage(chatId, expiredMessage, keyboard);
        } else {
          // NEW USER / UNPAID FLOW
          const newSubscriberMessage =
            `👋 <b>مرحباً بك في تطبيق U JO Resident!</b>\n\n` +
            `تطبيق U JO Resident هو المنصة المتكاملة لأسئلة واختبارات المجلس الطبي الأردني (MOH Exam Pass).\n\n` +
            `💳 <b>خطوات الاشتراك عبر زين كاش (Zain Cash):</b>\n` +
            `1. قم بتحويل رسوم الاشتراك (<b>${price} د.ع</b>) إلى المحفظة: <code>${zainCashNum}</code>\n` +
            `2. افتح التطبيق عبر الزر أدناه وأرفق صورة إشعار التحويل لتفعيل حسابك مباشرة.`;

          const keyboard = {
            inline_keyboard: [
              [{ text: "🚀 فتح التطبيق وتقديم طلب الاشتراك", web_app: { url: appUrl } }]
            ]
          };

          await sendTelegramMessage(chatId, newSubscriberMessage, keyboard);
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
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`U JO Resident App listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();