const _supabaseUrl = 'https://gbgfqjuazcwqjgwgqjaw.supabase.co';
const _supabaseKey = 'sb_publishable_F5NWBNz5bKyfeJr7RaOWAA_PCI6qmAb';
const _sb = supabase.createClient(_supabaseUrl, _supabaseKey);

(async () => {
  const { data: { session } } = await _sb.auth.getSession();
  if (!session) {
    window.location.replace('login.html');
  }
})();
