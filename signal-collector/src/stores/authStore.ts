import { create } from 'zustand';
import * as Linking from 'expo-linking';
import { getSupabase, isSupabaseConfigured } from '@/services/supabase';

/**
 * Email magic-link auth. Signing in is only required for cloud sync --
 * collection always works offline and data stays on-device until a
 * signed-in sync succeeds.
 */

interface AuthState {
  email: string | null;
  userId: string | null;
  configured: boolean;
  initializing: boolean;
  magicLinkSentTo: string | null;
  error: string | null;
  init: () => Promise<void>;
  sendMagicLink: (email: string) => Promise<boolean>;
  /** Verify the 6-digit OTP code from the sign-in email (no deep link needed). */
  verifyCode: (email: string, code: string) => Promise<boolean>;
  /** Email + password sign-in — needs no email delivery (best for solo testing). */
  signInWithPassword: (email: string, password: string) => Promise<boolean>;
  handleDeepLink: (url: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set) => ({
  email: null,
  userId: null,
  configured: isSupabaseConfigured(),
  initializing: true,
  magicLinkSentTo: null,
  error: null,

  init: async () => {
    const supabase = getSupabase();
    if (!supabase) {
      set({ initializing: false, configured: false });
      return;
    }
    const { data } = await supabase.auth.getSession();
    set({
      email: data.session?.user.email ?? null,
      userId: data.session?.user.id ?? null,
      initializing: false,
    });
    supabase.auth.onAuthStateChange((_event, session) => {
      set({
        email: session?.user.email ?? null,
        userId: session?.user.id ?? null,
      });
    });
  },

  sendMagicLink: async (email: string) => {
    const supabase = getSupabase();
    if (!supabase) {
      set({ error: 'Supabase is not configured. Add keys to .env first.' });
      return false;
    }
    const redirectTo = Linking.createURL('auth-callback');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) {
      set({ error: error.message });
      return false;
    }
    set({ magicLinkSentTo: email, error: null });
    return true;
  },

  signInWithPassword: async (email: string, password: string) => {
    const supabase = getSupabase();
    if (!supabase) {
      set({ error: 'Supabase is not configured. Add keys to .env first.' });
      return false;
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      set({ error: error.message });
      return false;
    }
    set({ error: null });
    return true;
  },

  verifyCode: async (email: string, code: string) => {
    const supabase = getSupabase();
    if (!supabase) return false;
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: 'email',
    });
    if (error) {
      set({ error: error.message });
      return false;
    }
    set({ error: null, magicLinkSentTo: null });
    return true;
  },

  handleDeepLink: async (url: string) => {
    const supabase = getSupabase();
    if (!supabase) return;
    // Magic links land as signalcollector://auth-callback#access_token=...&refresh_token=...
    const fragment = url.split('#')[1];
    if (!fragment) return;
    const params = new URLSearchParams(fragment);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) set({ error: error.message });
    }
  },

  signOut: async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.auth.signOut();
    set({ email: null, userId: null });
  },
}));
