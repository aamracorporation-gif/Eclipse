
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://zurbdrfmwjqbrscairub.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1cmJkcmZtd2pxYnJzY2FpcnViIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI4ODI1NywiZXhwIjoyMDgyODY0MjU3fQ.Wm0ZSiSz_aKaZ3ppOaJ21OVZwL2xeGA_nrDNb4_kgl8';

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const targetUserId = '85b74e25-6bd7-4312-b874-4841b3019ac3';

async function deleteUser() {
  console.log(`Iniciando eliminación del usuario: ${targetUserId}`);

  // 1. Delete events created by the user (to handle missing CASCADE)
  console.log('Buscando eventos creados por el usuario...');
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id')
    .eq('creator_id', targetUserId);

  if (eventsError) {
    console.error('Error al buscar eventos:', eventsError);
  } else if (events && events.length > 0) {
    console.log(`Eliminando ${events.length} eventos...`);
    const { error: delEventsError } = await supabase
      .from('events')
      .delete()
      .eq('creator_id', targetUserId);
    
    if (delEventsError) {
      console.error('Error al eliminar eventos:', delEventsError);
      return;
    }
    console.log('Eventos eliminados correctamente.');
  } else {
    console.log('No se encontraron eventos creados por este usuario.');
  }

  // 2. Delete the auth user (this should cascade to profiles, wallets, etc.)
  console.log('Eliminando usuario de auth...');
  const { error: authError } = await supabase.auth.admin.deleteUser(targetUserId);

  if (authError) {
    console.error('Error al eliminar usuario de auth:', authError);
    
    // Fallback: try deleting from profiles manually if auth delete failed due to some remaining FK
    console.log('Intentando eliminación manual de perfil y dependencias...');
    
    await supabase.from('profiles').delete().eq('id', targetUserId);
    await supabase.from('wallets').delete().eq('user_id', targetUserId);
    // ... other tables if needed
    
    // Retry auth delete
    const { error: authRetryError } = await supabase.auth.admin.deleteUser(targetUserId);
    if (authRetryError) {
        console.error('Fallo definitivo al eliminar usuario de auth:', authRetryError);
    } else {
        console.log('Usuario de auth eliminado correctamente tras reintento.');
    }
  } else {
    console.log('Usuario de auth y perfil eliminados correctamente.');
  }
}

deleteUser();
