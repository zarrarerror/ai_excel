const { createClient } = require('@supabase/supabase-js');

// Admin client — uses service role key, bypasses RLS
// Only used on the backend, never exposed to the client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

module.exports = supabase;
