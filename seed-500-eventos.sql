-- Eclipse: 500 fiestas de prueba en Andalucía (70% Sevilla)
-- Ejecutar en Supabase SQL Editor

DO $seed$
DECLARE
  creator uuid := '1d97c0d6-8b4d-4109-87a7-ab59d3f46153';

  locs text[] := ARRAY[
    -- Sevilla capital (1-14)
    'Plaza Nueva, Sevilla|37.3891|-5.9845',
    'Calle Betis, Triana, Sevilla|37.3833|-6.0034',
    'Av. Republica Argentina, Sevilla|37.3761|-5.9987',
    'Alameda de Hercules, Sevilla|37.3963|-5.9935',
    'Calle Arfe, El Arenal, Sevilla|37.3842|-5.9934',
    'Barrio Santa Cruz, Sevilla|37.3862|-5.9892',
    'Av. Luis de Morales, Nervion, Sevilla|37.3806|-5.9650',
    'Calle Resolana, Macarena, Sevilla|37.4015|-5.9875',
    'Av. de Italia, Heliopolis, Sevilla|37.3612|-5.9971',
    'Bellavista, Sevilla|37.3445|-5.9818',
    'Av. San Pablo, Sevilla|37.4102|-5.9721',
    'Pino Montano, Sevilla|37.4189|-5.9634',
    'Torreblanca, Sevilla|37.3698|-5.9412',
    'Isla de la Cartuja, Sevilla|37.4056|-6.0023',
    -- Aljarafe / Sevilla provincia (15-26)
    'Plaza de Espana, Dos Hermanas|37.2897|-5.9226',
    'Mairena del Aljarafe, Sevilla|37.3456|-6.0623',
    'Camas, Sevilla|37.3975|-6.0312',
    'Tomares, Sevilla|37.3712|-6.0489',
    'San Juan de Aznalfarache|37.3545|-6.0234',
    'Bormujos, Sevilla|37.3589|-6.0712',
    'Espartinas, Sevilla|37.3823|-6.1145',
    'Umbrete, Sevilla|37.4012|-6.1534',
    'Sanlucar la Mayor, Sevilla|37.3934|-6.2045',
    'Gelves, Sevilla|37.3356|-6.0345',
    'Alcala de Guadaira, Sevilla|37.3356|-5.8423',
    'La Rinconada, Sevilla|37.4723|-5.9812',
    -- Sevilla este/norte (27-35)
    'Carmona, Sevilla|37.4712|-5.6456',
    'Plaza de Espana, Ecija|37.5412|-5.0823',
    'Utrera, Sevilla|37.1834|-5.7756',
    'Moron de la Frontera, Sevilla|37.1234|-5.4523',
    'Osuna, Sevilla|37.2345|-5.1045',
    'Marchena, Sevilla|37.3312|-5.4134',
    'Lebrija, Sevilla|36.9234|-6.0812',
    'Lora del Rio, Sevilla|37.6534|-5.5234',
    'Estepa, Sevilla|37.2912|-4.8756',
    -- Resto Andalucia (36-56)
    'Calle Larios, Malaga|36.7213|-4.4214',
    'Puerto Banus, Marbella|36.4952|-4.9554',
    'Torremolinos, Malaga|36.6215|-4.4998',
    'Benalmadena Costa, Malaga|36.5998|-4.5498',
    'Fuengirola, Malaga|36.5387|-4.6250',
    'Estepona, Malaga|36.4265|-5.1462',
    'Nerja, Malaga|36.7450|-3.8712',
    'Plaza Nueva, Granada|37.1773|-3.5986',
    'Albaicin, Granada|37.1823|-3.5912',
    'Calle Ancha, Cadiz|36.5297|-6.2923',
    'Av. Alvaro Domecq, Jerez|36.6850|-6.1361',
    'El Puerto de Santa Maria, Cadiz|36.5934|-6.2312',
    'Chiclana de la Frontera, Cadiz|36.4189|-6.1456',
    'Conil de la Frontera, Cadiz|36.2745|-6.0912',
    'Tarifa, Cadiz|36.0145|-5.6023',
    'Paseo de la Victoria, Cordoba|37.8882|-4.7794',
    'Gran Via, Huelva|37.2570|-6.9498',
    'Punta Umbria, Huelva|37.1712|-6.9534',
    'Paseo de Almeria|36.8340|-2.4637',
    'Roquetas de Mar, Almeria|36.7634|-2.6145',
    'Pasaje Falco, Jaen|37.7796|-3.7849'
  ];

  themes text[] := ARRAY[
    'Techno Night','House Session','Deep House','EDM Night','Progressive House',
    'Minimal Techno','Afro House','Reggaetón','Perreo Intenso','Trap Night',
    'RnB Night','Urbano Latino','Dembow Session','Noche de Flamenco','Sevillanas',
    'Feria de Abril','Rociero Night','Noche de Copla','Pool Party','Sunset Beach',
    'Caribbean Night','Hawaiian Party','Ibiza Vibes','80s Night','90s Party',
    'Eurodance','Bachata & Salsa','Disco Night','Afterwork','Vermut Party',
    'VIP Night','Black Party','White Party','Neon Party','Grand Opening',
    'Open Air','Rooftop Party','Universitaria','Erasmus Night','Toga Party',
    'Latino Night','Boat Party','Garden Party','Festival de Verano','Chill House',
    'Nu Disco','Funk Night','Acid Techno','Drum & Bass','Salsa Cubana'
  ];

  clubs text[] := ARRAY[
    'Sala Macarena','Club Mangos','Antique Theatro','Bilindo','Oba Club',
    'Fortuna Club','La Real','Studio 54 Sevilla','Distrito Sur','El Mundo',
    'Terraza Triana','Club Medina','Sky Lounge','La Hacienda','Villa Magna',
    'El Cortijo','Playa Club','Rooftop SVQ','Club 27','La Sala',
    'El Almacén','Nave 15','Warehouse','Sol y Sombra','El Patio',
    'Discoteca Rex','New Music','Factory','Club Kapital','Arena Club'
  ];

  etypes text[] := ARRAY[
    'Club Night','Fiesta Electrónica','Reggaetón & Urbano','Flamenco & Sevillanas',
    'Fiesta Universitaria','Afterwork','Festival','Pool Party','80s/90s Night','Fiesta Privada'
  ];

  dresses text[] := ARRAY['Casual','Smart Casual','Elegante','Formal','Temático','Sin restricciones'];

  prices int[] := ARRAY[0,0,5,8,10,12,15,15,18,20,20,25,30,35,40];

  caps int[] := ARRAY[100,150,200,250,300,400,500,600,800,1000,1200];

  ages int[] := ARRAY[18,18,18,18,18,21,25,0];

  posters text[] := ARRAY[
    'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg',
    'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg',
    'https://images.pexels.com/photos/2263436/pexels-photo-2263436.jpeg',
    'https://images.pexels.com/photos/3171837/pexels-photo-3171837.jpeg',
    'https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg',
    'https://images.pexels.com/photos/2747449/pexels-photo-2747449.jpeg',
    'https://images.pexels.com/photos/1916820/pexels-photo-1916820.jpeg',
    'https://images.pexels.com/photos/3321793/pexels-photo-3321793.jpeg',
    'https://images.pexels.com/photos/787961/pexels-photo-787961.jpeg',
    'https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg'
  ];

  v_id uuid;
  e_id uuid;
  loc_str text;
  loc_addr text;
  loc_idx int;
  price int;
  cap int;
  sold int;
  age int;
  event_date timestamptz;
  theme text;
  club text;
  etype text;
  dress text;
  poster text;
  title text;
  ev_desc text;
  lat numeric;
  lng numeric;
BEGIN
  FOR i IN 1..500 LOOP
    -- 70% Sevilla (índices 1-35), 30% resto (36-56)
    IF (i % 10) < 7 THEN
      loc_idx := (i * 3 + 7) % 35 + 1;
    ELSE
      loc_idx := 35 + (i * 7 + 3) % 21 + 1;
    END IF;

    loc_str  := locs[loc_idx];
    loc_addr := split_part(loc_str, '|', 1);
    theme  := themes[(i * 7 + 3) % array_length(themes,1) + 1];
    club   := clubs[(i * 11 + 5) % array_length(clubs,1) + 1];
    etype  := etypes[(i * 3 + 1) % array_length(etypes,1) + 1];
    dress  := dresses[(i * 5 + 2) % array_length(dresses,1) + 1];
    price  := prices[(i * 4 + 1) % array_length(prices,1) + 1];
    cap    := caps[(i * 6 + 3) % array_length(caps,1) + 1];
    sold   := (i * 13 + 7) % (cap / 2);
    age    := ages[(i * 9 + 4) % array_length(ages,1) + 1];
    poster := posters[(i * 3 + 2) % array_length(posters,1) + 1];
    lat    := split_part(loc_str, '|', 2)::numeric + ((i % 17) - 8) * 0.001;
    lng    := split_part(loc_str, '|', 3)::numeric + ((i % 13) - 6) * 0.001;

    -- Fecha: entre 1 y 120 días en el futuro, hora nocturna
    event_date := NOW() + ((i % 120) + 1) * INTERVAL '1 day'
                  + ((22 + (i % 2)) * 60 + (i * 7 % 60)) * INTERVAL '1 minute';

    title := CASE (i % 6)
      WHEN 0 THEN theme
      WHEN 1 THEN 'Noche de ' || theme
      WHEN 2 THEN 'Gran ' || theme
      WHEN 3 THEN theme || ' Night'
      WHEN 4 THEN theme || ' Party'
      ELSE    'Especial ' || theme
    END;

    ev_desc := 'La mejor ' || etype || ' en ' || club || '. Ambiente inmejorable, sonido de primera y una noche que no olvidarás. Dress code: ' || dress || CASE WHEN age > 0 THEN ' · +' || age ELSE '' END || '. Aforo limitado.';

    -- Venue
    INSERT INTO venues (name, address, latitude, longitude, description, image_url)
    VALUES (club || ' - ' || split_part(loc_addr, ',', 2), loc_addr, lat, lng, 'Sala en ' || split_part(loc_addr, ',', 2), poster)
    RETURNING id INTO v_id;

    -- Evento
    INSERT INTO events (venue_id, title, description, poster_url, event_date, ticket_price,
                        available_tickets, sold_tickets, dress_code, age_restriction,
                        event_type, theme, creator_id, allow_resale)
    VALUES (v_id, title, ev_desc, poster, event_date, price,
            cap - sold, sold, dress, age,
            etype, theme, creator, (i % 5 != 0))
    RETURNING id INTO e_id;

    -- Ticket types
    IF price = 0 THEN
      INSERT INTO event_ticket_types (event_id, name, price, quantity, sold)
      VALUES (e_id, 'Entrada Gratuita', 0, 50 + (i*7%300), i*3%80);
    ELSE
      INSERT INTO event_ticket_types (event_id, name, price, quantity, sold)
      VALUES (e_id, 'Entrada General', price, 100 + (i*9%400), i*7%150);

      IF (i % 10) < 6 THEN
        INSERT INTO event_ticket_types (event_id, name, price, quantity, sold)
        VALUES (e_id, 'Early Bird', GREATEST(5, price - 3 - (i%5)), 30 + (i%70), 20 + (i*3%80));
      END IF;

      IF (i % 10) < 4 THEN
        INSERT INTO event_ticket_types (event_id, name, price, quantity, sold)
        VALUES (e_id, 'VIP', price + 10 + (i%20), 20 + (i%40), i%30);
      END IF;
    END IF;

  END LOOP;

  RAISE NOTICE 'Completado: 500 eventos creados.';
END $seed$;