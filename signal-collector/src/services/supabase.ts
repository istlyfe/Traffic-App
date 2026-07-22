import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { envSchema } from '@/validation/schemas';

/**
 * Supabase client. Only the anon key is ever bundled with the app -- the
 * service-role key must never appear in this codebase. All data access is
 * constrained server-side by Row Level Security.
 *
 * The app is offline-first: when env vars are missing (e.g. a fresh clone
 * before Supabase is configured), collection still works and sync is simply
 * disabled.
 */

let client: SupabaseClient | null = null;
let configured: boolean | null = null;

export function isSupabaseConfigured(): boolean {
  if (configured == null) {
    configured = envSchema.safeParse({
      EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    }).success;
  }
  return configured;
}

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!client) {
    client = createClient(
      process.env.EXPO_PUBLIC_SUPABASE_URL!,
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          storage: AsyncStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
      },
    );
  }
  return client;
}
