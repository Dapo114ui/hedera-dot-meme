import { createClient } from '@supabase/supabase-js';

const supabaseUrl = window.location.origin + '/api/supabase';
// A placeholder anon key when unset - createClient() itself throws on a
// falsy key, which previously took down this entire module (and every
// other feature in script.js/coin.js that imports it, since a throw
// during module evaluation prevents the rest of the file from loading
// at all). Supabase-dependent calls will now fail individually and are
// already handled by the try/catch around each of them, instead of the
// whole site breaking on every page.
if (!import.meta.env.VITE_SUPABASE_ANON_KEY) {
    console.error('VITE_SUPABASE_ANON_KEY is not set - Supabase features will not work.');
}
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'missing-supabase-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
