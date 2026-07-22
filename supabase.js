import { createClient } from '@supabase/supabase-js';

const supabaseUrl = window.location.origin + '/api/supabase';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseAnonKey) {
    throw new Error('Supabase environment variable is missing! Ensure VITE_SUPABASE_ANON_KEY is set in Vercel.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
