const SUPABASE_URL = "https://rvwgjytchkqrfngvmyic.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_g4SSpTtCei72IP9RGwiXXw_mv0gmoU6";

window.pcHubSupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
