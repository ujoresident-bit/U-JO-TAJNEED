import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;

/**
 * Checks if Supabase server-side environment variables are configured.
 */
export function isSupabaseConfigured(): boolean {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  return Boolean(url && key);
}

/**
 * Returns the server-side Supabase client instance (lazy-loaded).
 * Returns null if SUPABASE_URL or SUPABASE_SECRET_KEY is missing.
 */
export function getSupabase(): SupabaseClient | null {
  if (supabaseClient) {
    return supabaseClient;
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY?.trim();

  if (!supabaseUrl || !supabaseSecretKey) {
    console.warn(
      '[Supabase Server] Warning: SUPABASE_URL or SUPABASE_SECRET_KEY is missing in environment variables. Server-side database operations will be unavailable until credentials are provided.'
    );
    return null;
  }

  try {
    supabaseClient = createClient(supabaseUrl, supabaseSecretKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    console.log('[Supabase Server] Supabase client initialized successfully on server.');
    return supabaseClient;
  } catch (error) {
    console.error('[Supabase Server] Error initializing Supabase client:', error);
    return null;
  }
}

/**
 * Helper function to execute a Supabase query or fail with a clear error if unconfigured.
 */
export function requireSupabase(): SupabaseClient {
  const client = getSupabase();
  if (!client) {
    throw new Error(
      'Supabase server client is not configured. Ensure SUPABASE_URL and SUPABASE_SECRET_KEY are set in environment variables.'
    );
  }
  return client;
}
