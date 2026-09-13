import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zurbdrfmwjqbrscairub.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1cmJkcmZtd2pxYnJzY2FpcnViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyODgyNTcsImV4cCI6MjA4Mjg2NDI1N30.e81tNdU21I67m9UleGKf5t4n6vy8dGdLuJIJtSPFDIQ';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('No se encontraron SUPABASE_URL / SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Datos del creador de prueba ───────────────────────────────────────────────
// Necesitamos un creator_id válido (organizador verificado)
// Lo obtenemos de la primera fila que tenga rol organizer
const { data: creatorData } = await supabase
  .from('profiles')
  .select('id')
  .eq('role', 'organizer')
  .limit(1)
  .single();

if (!creatorData) {
  console.error('No se encontró ningún organizador verificado. Crea uno primero.');
  process.exit(1);
}
const CREATOR_ID = creatorData.id;
console.log(`Usando creator_id: ${CREATOR_ID}`);

// ── Ubicaciones de Andalucía (peso ~70% Sevilla) ──────────────────────────────
const locations = [
  // Sevilla capital y municipios (alta densidad)
  { name: 'Sevilla Centro', address: 'Plaza Nueva, Sevilla', lat: 37.3891, lng: -5.9845 },
  { name: 'Triana', address: 'Calle Betis, Triana, Sevilla', lat: 37.3833, lng: -6.0034 },
  { name: 'Los Remedios', address: 'Av. República Argentina, Sevilla', lat: 37.3761, lng: -5.9987 },
  { name: 'La Alameda', address: 'Alameda de Hércules, Sevilla', lat: 37.3963, lng: -5.9935 },
  { name: 'El Arenal', address: 'Calle Arfe, Sevilla', lat: 37.3842, lng: -5.9934 },
  { name: 'Santa Cruz', address: 'Barrio Santa Cruz, Sevilla', lat: 37.3862, lng: -5.9892 },
  { name: 'Nervión', address: 'Av. Luis de Morales, Sevilla', lat: 37.3806, lng: -5.9650 },
  { name: 'Macarena', address: 'Calle Resolana, Sevilla', lat: 37.4015, lng: -5.9875 },
  { name: 'Heliópolis', address: 'Av. de Italia, Sevilla', lat: 37.3612, lng: -5.9971 },
  { name: 'Bellavista', address: 'Bellavista, Sevilla', lat: 37.3445, lng: -5.9818 },
  { name: 'San Pablo', address: 'Av. San Pablo, Sevilla', lat: 37.4102, lng: -5.9721 },
  { name: 'Polígono Norte', address: 'Polígono Norte, Sevilla', lat: 37.4201, lng: -5.9876 },
  { name: 'Torreblanca', address: 'Torreblanca, Sevilla', lat: 37.3698, lng: -5.9412 },
  { name: 'Pino Montano', address: 'Pino Montano, Sevilla', lat: 37.4189, lng: -5.9634 },
  // Aljarafe (Sevilla)
  { name: 'Dos Hermanas', address: 'Plaza de España, Dos Hermanas', lat: 37.2897, lng: -5.9226 },
  { name: 'Mairena del Aljarafe', address: 'Mairena del Aljarafe, Sevilla', lat: 37.3456, lng: -6.0623 },
  { name: 'Camas', address: 'Camas, Sevilla', lat: 37.3975, lng: -6.0312 },
  { name: 'Tomares', address: 'Tomares, Sevilla', lat: 37.3712, lng: -6.0489 },
  { name: 'San Juan de Aznalfarache', address: 'San Juan de Aznalfarache', lat: 37.3545, lng: -6.0234 },
  { name: 'Gelves', address: 'Gelves, Sevilla', lat: 37.3356, lng: -6.0345 },
  { name: 'Bormujos', address: 'Bormujos, Sevilla', lat: 37.3589, lng: -6.0712 },
  { name: 'Espartinas', address: 'Espartinas, Sevilla', lat: 37.3823, lng: -6.1145 },
  { name: 'Umbrete', address: 'Umbrete, Sevilla', lat: 37.4012, lng: -6.1534 },
  { name: 'Sanlúcar la Mayor', address: 'Sanlúcar la Mayor, Sevilla', lat: 37.3934, lng: -6.2045 },
  // Sevilla provincia otros
  { name: 'Écija', address: 'Plaza de España, Écija', lat: 37.5412, lng: -5.0823 },
  { name: 'Utrera', address: 'Utrera, Sevilla', lat: 37.1834, lng: -5.7756 },
  { name: 'Lebrija', address: 'Lebrija, Sevilla', lat: 36.9234, lng: -6.0812 },
  { name: 'Morón de la Frontera', address: 'Morón de la Frontera, Sevilla', lat: 37.1234, lng: -5.4523 },
  { name: 'Marchena', address: 'Marchena, Sevilla', lat: 37.3312, lng: -5.4134 },
  { name: 'Osuna', address: 'Osuna, Sevilla', lat: 37.2345, lng: -5.1045 },
  { name: 'Estepa', address: 'Estepa, Sevilla', lat: 37.2912, lng: -4.8756 },
  { name: 'La Rinconada', address: 'La Rinconada, Sevilla', lat: 37.4723, lng: -5.9812 },
  { name: 'Alcalá de Guadaíra', address: 'Alcalá de Guadaíra, Sevilla', lat: 37.3356, lng: -5.8423 },
  { name: 'Carmona', address: 'Carmona, Sevilla', lat: 37.4712, lng: -5.6456 },
  { name: 'Lora del Río', address: 'Lora del Río, Sevilla', lat: 37.6534, lng: -5.5234 },
  // Resto de Andalucía (menor densidad)
  { name: 'Málaga Centro', address: 'Calle Larios, Málaga', lat: 36.7213, lng: -4.4214 },
  { name: 'Marbella', address: 'Puerto Banús, Marbella', lat: 36.4952, lng: -4.9554 },
  { name: 'Marbella Centro', address: 'Calle Ricardo Soriano, Marbella', lat: 36.5098, lng: -4.8847 },
  { name: 'Torremolinos', address: 'Torremolinos, Málaga', lat: 36.6215, lng: -4.4998 },
  { name: 'Benalmádena', address: 'Benalmádena Costa, Málaga', lat: 36.5998, lng: -4.5498 },
  { name: 'Fuengirola', address: 'Fuengirola, Málaga', lat: 36.5387, lng: -4.6250 },
  { name: 'Estepona', address: 'Estepona, Málaga', lat: 36.4265, lng: -5.1462 },
  { name: 'Nerja', address: 'Nerja, Málaga', lat: 36.7450, lng: -3.8712 },
  { name: 'Ronda', address: 'Ronda, Málaga', lat: 36.7460, lng: -5.1612 },
  { name: 'Granada Centro', address: 'Plaza Nueva, Granada', lat: 37.1773, lng: -3.5986 },
  { name: 'Albaicín Granada', address: 'Albaicín, Granada', lat: 37.1823, lng: -3.5912 },
  { name: 'Cádiz Capital', address: 'Calle Ancha, Cádiz', lat: 36.5297, lng: -6.2923 },
  { name: 'Jerez de la Frontera', address: 'Av. Alcalde Álvaro Domecq, Jerez', lat: 36.6850, lng: -6.1361 },
  { name: 'El Puerto de Santa María', address: 'El Puerto de Santa María, Cádiz', lat: 36.5934, lng: -6.2312 },
  { name: 'Chiclana de la Frontera', address: 'Chiclana de la Frontera, Cádiz', lat: 36.4189, lng: -6.1456 },
  { name: 'Conil de la Frontera', address: 'Conil de la Frontera, Cádiz', lat: 36.2745, lng: -6.0912 },
  { name: 'Tarifa', address: 'Tarifa, Cádiz', lat: 36.0145, lng: -5.6023 },
  { name: 'Córdoba Capital', address: 'Paseo de la Victoria, Córdoba', lat: 37.8882, lng: -4.7794 },
  { name: 'Huelva Capital', address: 'Gran Vía, Huelva', lat: 37.2570, lng: -6.9498 },
  { name: 'Punta Umbría', address: 'Punta Umbría, Huelva', lat: 37.1712, lng: -6.9534 },
  { name: 'Almería Capital', address: 'Paseo de Almería', lat: 36.8340, lng: -2.4637 },
  { name: 'Roquetas de Mar', address: 'Roquetas de Mar, Almería', lat: 36.7634, lng: -2.6145 },
  { name: 'Jaén Capital', address: 'Pasaje Falcó, Jaén', lat: 37.7796, lng: -3.7849 },
  { name: 'Úbeda', address: 'Úbeda, Jaén', lat: 38.0134, lng: -3.3723 },
];

// ── Catálogo de fiestas ───────────────────────────────────────────────────────
const TIPOS = [
  { type: 'Fiesta Universitaria', themes: ['Universitaria', 'Student Night', 'College Party', 'Erasmus Night', 'Toga Party', 'Neones'] },
  { type: 'Fiesta Electrónica', themes: ['Techno', 'House', 'EDM', 'Deep House', 'Minimal Techno', 'Progressive House', 'Afro House'] },
  { type: 'Reggaetón & Urbano', themes: ['Reggaetón', 'Perreo', 'Trap', 'RnB Night', 'Urbano Latino', 'Dembow'] },
  { type: 'Flamenco & Sevillanas', themes: ['Flamenco', 'Sevillanas', 'Feria de Abril', 'Rociero', 'Copla', 'Zambomba'] },
  { type: 'Fiesta de Verano', themes: ['Pool Party', 'Sunset Beach', 'Caribbean Night', 'Hawaiian Party', 'Boat Party'] },
  { type: 'Fiesta 80s/90s/2000s', themes: ['80s Night', '90s Party', 'Y2K Night', 'Disco', 'Eurodance', 'Bachata & Salsa'] },
  { type: 'Afterwork', themes: ['Afterwork', 'Vermut Party', 'Networking Night', 'After Office'] },
  { type: 'Club Night', themes: ['VIP Night', 'Grand Opening', 'Black Party', 'White Party', 'Neon Party'] },
  { type: 'Festival', themes: ['Open Air', 'Festival', 'Garden Party', 'Rooftop', 'Cultural Night'] },
  { type: 'Evento Privado', themes: ['Despedida de Soltera', 'Cumpleaños Especial', 'Aniversario Club', 'Gala'] },
];

const DRESS_CODES = ['Casual', 'Smart Casual', 'Elegante', 'Formal', 'Temático', 'Sin restricciones'];
const AGE_RESTRICTIONS = [18, 18, 18, 18, 21, 25, 0]; // peso hacia 18
const PRICE_RANGES = [
  [0, 0], [5, 5], [8, 10], [10, 15], [15, 20], [20, 25], [25, 30], [30, 40], [40, 60],
];

const POSTERS = [
  'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg',
  'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg',
  'https://images.pexels.com/photos/2263436/pexels-photo-2263436.jpeg',
  'https://images.pexels.com/photos/3171837/pexels-photo-3171837.jpeg',
  'https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg',
  'https://images.pexels.com/photos/2747449/pexels-photo-2747449.jpeg',
  'https://images.pexels.com/photos/1916820/pexels-photo-1916820.jpeg',
  'https://images.pexels.com/photos/3321793/pexels-photo-3321793.jpeg',
  'https://images.pexels.com/photos/2078071/pexels-photo-2078071.jpeg',
  'https://images.pexels.com/photos/2114365/pexels-photo-2114365.jpeg',
  'https://images.pexels.com/photos/787961/pexels-photo-787961.jpeg',
  'https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg',
];

const CLUB_NAMES = [
  'Sala Macarena', 'Club Mangos', 'Antique Theatro', 'Bilindo', 'Oba Club',
  'Fortuna Club', 'La Real', 'Club Kapital', 'Studio 54 Sevilla', 'Distrito Sur',
  'El Mundo', 'Terraza Triana', 'Club Medina', 'Sky Lounge', 'Azotea del Círculo',
  'La Hacienda', 'Villa Magna', 'El Cortijo', 'Playa Club', 'Rooftop SVQ',
  'Club 27', 'La Sala', 'El Almacén', 'Nave 15', 'Warehouse',
  'Sol y Sombra', 'El Patio', 'Discoteca Rex', 'New Music', 'Factory',
];

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randFloat = (min, max, dec = 4) => parseFloat((Math.random() * (max - min) + min).toFixed(dec));
const jitter = (val, range = 0.02) => val + randFloat(-range, range);

function generateEventDate() {
  // Fechas entre hoy y 4 meses en el futuro, sobre todo viernes y sábados
  const now = new Date();
  const future = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000);
  let d = new Date(now.getTime() + Math.random() * (future - now));
  // Sesgar hacia fin de semana
  const dow = d.getDay();
  if (Math.random() < 0.7) {
    const toFri = (5 - dow + 7) % 7;
    const toSat = (6 - dow + 7) % 7;
    d = new Date(d.getTime() + (Math.random() < 0.5 ? toFri : toSat) * 24 * 60 * 60 * 1000);
  }
  // Hora entre 22:00 y 01:00
  d.setHours(randInt(22, 23), randInt(0, 59), 0, 0);
  return d.toISOString();
}

function generateTitle(tipo, theme) {
  const prefixes = ['', '', '', 'Noche de ', 'Gran ', 'Especial ', ''];
  const suffixes = ['', '', ' Night', ' Party', ' Session', ' Experience', ' Edition'];
  return `${rand(prefixes)}${theme}${rand(suffixes)}`.trim();
}

function generateDescription(tipo, theme, venue, dressCode, ageRestriction) {
  const intros = [
    `¡La noche más esperada del año llega a ${venue}!`,
    `${venue} te invita a vivir una noche inolvidable.`,
    `Prepárate para la mejor ${tipo} de Andalucía en ${venue}.`,
    `Una noche épica de ${theme} en el corazón de ${venue}.`,
    `${venue} abre sus puertas para la fiesta que está en boca de todos.`,
  ];
  const middles = [
    `Los mejores DJs locales e internacionales se darán cita en una noche llena de música, energía y diversión sin límites.`,
    `Ambiente inmejorable, sonido de primera calidad y una pista de baile que no para en toda la noche.`,
    `Disfruta de la mejor selección musical, cócteles de autor y una experiencia única que no querrás perderte.`,
    `Un evento diseñado para los amantes de la música y la noche. Aforo limitado, ¡hazte con tu entrada ya!`,
  ];
  const outros = [
    `Dress code: ${dressCode}${ageRestriction > 0 ? ` · +${ageRestriction}` : ''} · Aforo limitado.`,
    `Entrada anticipada disponible. ¡No te quedes sin la tuya!`,
    `Puertas abiertas a las 23:00h. ${ageRestriction > 0 ? `Acceso +${ageRestriction}.` : 'Para todos los públicos mayores de 18.'}`,
  ];
  return `${rand(intros)} ${rand(middles)} ${rand(outros)}`;
}

// ── Generación de 500 eventos ─────────────────────────────────────────────────
// Distribución: 70% Sevilla (primeras 35 locations), 30% resto Andalucía
const sevillaLocs = locations.slice(0, 35);
const restoLocs = locations.slice(35);

function pickLocation() {
  if (Math.random() < 0.70) return rand(sevillaLocs);
  return rand(restoLocs);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

let created = 0;
let failed = 0;
const TOTAL = 500;
const BATCH = 10; // insertar de 10 en 10

console.log(`\nGenerando ${TOTAL} eventos de prueba en Andalucía...\n`);

for (let i = 0; i < TOTAL; i += BATCH) {
  const venueBatch = [];
  const eventBatch = [];
  const ticketBatch = []; // generamos tipo de ticket por evento

  for (let j = 0; j < BATCH && i + j < TOTAL; j++) {
    const loc = pickLocation();
    const tipoObj = rand(TIPOS);
    const theme = rand(tipoObj.themes);
    const club = rand(CLUB_NAMES);
    const dressCode = rand(DRESS_CODES);
    const ageRestriction = rand(AGE_RESTRICTIONS);
    const priceRange = rand(PRICE_RANGES);
    const price = priceRange[0] === 0 ? 0 : randInt(priceRange[0], priceRange[1]);
    const capacity = randInt(100, 1200);
    const soldPct = Math.random() * 0.6; // 0-60% vendido
    const soldTickets = Math.floor(capacity * soldPct);

    venueBatch.push({
      name: `${club} — ${loc.name}`,
      address: loc.address,
      latitude: jitter(loc.lat),
      longitude: jitter(loc.lng),
      description: `Sala de referencia en ${loc.name}`,
      image_url: rand(POSTERS),
    });

    eventBatch.push({
      theme,
      tipoObj,
      title: generateTitle(tipoObj.type, theme),
      description: generateDescription(tipoObj.type, theme, `${club} ${loc.name}`, dressCode, ageRestriction),
      poster_url: rand(POSTERS),
      event_date: generateEventDate(),
      ticket_price: price,
      available_tickets: capacity - soldTickets,
      sold_tickets: soldTickets,
      dress_code: dressCode,
      age_restriction: ageRestriction,
      event_type: tipoObj.type,
      creator_id: CREATOR_ID,
      allow_resale: Math.random() > 0.2,
    });
  }

  // 1. Insert venues
  const { data: venuesData, error: vErr } = await supabase
    .from('venues')
    .insert(venueBatch)
    .select('id');

  if (vErr || !venuesData) {
    console.error(`❌ Error insertando venues batch ${i}-${i+BATCH}:`, vErr?.message);
    failed += BATCH;
    await sleep(500);
    continue;
  }

  // 2. Insert events con venue_id
  const eventsToInsert = eventBatch.map((e, idx) => ({
    venue_id: venuesData[idx].id,
    title: e.title,
    description: e.description,
    poster_url: e.poster_url,
    event_date: e.event_date,
    ticket_price: e.ticket_price,
    available_tickets: e.available_tickets,
    sold_tickets: e.sold_tickets,
    dress_code: e.dress_code,
    age_restriction: e.age_restriction,
    event_type: e.event_type,
    theme: e.theme,
    creator_id: CREATOR_ID,
    allow_resale: e.allow_resale,
  }));

  const { data: eventsData, error: eErr } = await supabase
    .from('events')
    .insert(eventsToInsert)
    .select('id');

  if (eErr || !eventsData) {
    console.error(`❌ Error insertando events batch ${i}-${i+BATCH}:`, eErr?.message);
    failed += BATCH;
    await sleep(500);
    continue;
  }

  // 3. Insert ticket types
  const ticketTypes = [];
  eventsData.forEach((ev, idx) => {
    const eb = eventBatch[idx];
    const basePrice = eb.ticket_price;

    // Entrada general
    if (basePrice === 0) {
      ticketTypes.push({ event_id: ev.id, name: 'Entrada Gratuita', price: 0, quantity: randInt(100, 500), sold: randInt(0, 80) });
    } else {
      ticketTypes.push({ event_id: ev.id, name: 'Entrada General', price: basePrice, quantity: randInt(100, 600), sold: randInt(0, 150) });
      // 60% chance de añadir Early Bird
      if (Math.random() < 0.6) {
        ticketTypes.push({ event_id: ev.id, name: 'Early Bird', price: Math.max(5, basePrice - randInt(3, 8)), quantity: randInt(30, 100), sold: randInt(20, 100) });
      }
      // 40% chance de VIP
      if (Math.random() < 0.4) {
        ticketTypes.push({ event_id: ev.id, name: 'VIP', price: basePrice + randInt(10, 30), quantity: randInt(20, 60), sold: randInt(0, 30) });
      }
    }
  });

  const { error: ttErr } = await supabase.from('event_ticket_types').insert(ticketTypes);
  if (ttErr) {
    console.warn(`⚠️  Error en ticket_types batch ${i}: ${ttErr.message}`);
  }

  created += eventsData.length;
  const pct = Math.round((created / TOTAL) * 100);
  process.stdout.write(`\r✅ ${created}/${TOTAL} eventos creados (${pct}%)   `);

  await sleep(150);
}

console.log(`\n\n🎉 COMPLETADO: ${created} eventos creados, ${failed} fallidos.`);
console.log(`Distribución: ~70% provincia de Sevilla, ~30% resto de Andalucía.`);
