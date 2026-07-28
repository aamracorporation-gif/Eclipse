// deno-lint-ignore-file

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "https://zurbdrfmwjqbrscairub.supabase.co";
// SUPABASE_ANON_KEY env var returns the new sb_publishable_* format which REST API doesn't accept.
// The anon JWT key is public by design — safe to embed here.
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1cmJkcmZtd2pxYnJzY2FpcnViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyODgyNTcsImV4cCI6MjA4Mjg2NDI1N30.e81tNdU21I67m9UleGKf5t4n6vy8dGdLuJIJtSPFDIQ";

// ──────────────────────────────────────────────────────────────────────────────
// Test data — mirrors the QA artifact (370+ tests, 15 modules)
// ──────────────────────────────────────────────────────────────────────────────
const MODULES_JSON = JSON.stringify([
  { id:"auth", name:"Autenticación", color:"#818cf8", tests:[
    {id:"a01",t:"P1",pl:"both",desc:"Registro con email y contraseña válidos"},
    {id:"a02",t:"P1",pl:"both",desc:"Verificación de email tras registro"},
    {id:"a03",t:"P1",pl:"both",desc:"Login correcto con credenciales válidas"},
    {id:"a04",t:"P1",pl:"both",desc:"Login con contraseña incorrecta muestra error"},
    {id:"a05",t:"P1",pl:"both",desc:"Login con email no registrado muestra error"},
    {id:"a06",t:"P2",pl:"both",desc:"Recuperación de contraseña por email"},
    {id:"a07",t:"P2",pl:"both",desc:"Cambio de contraseña desde email de recuperación"},
    {id:"a08",t:"P2",pl:"both",desc:"Sesión persiste tras cerrar y reabrir la app"},
    {id:"a09",t:"P1",pl:"both",desc:"Cierre de sesión limpia estado de usuario"},
    {id:"a10",t:"P2",pl:"both",desc:"Registro con email ya existente muestra error"},
    {id:"a11",t:"P2",pl:"both",desc:"Contraseña corta (<6 chars) no permite registro"},
    {id:"a12",t:"P3",pl:"ios",  desc:"Login con Face ID / Touch ID (biometría iOS)"},
    {id:"a13",t:"P3",pl:"android",desc:"Login con huella dactilar (biometría Android)"},
    {id:"a14",t:"P2",pl:"both",desc:"Token JWT expira y obliga reautenticación"},
    {id:"a15",t:"P3",pl:"both",desc:"Deep link de verificación abre app correctamente"},
    {id:"a16",t:"P2",pl:"both",desc:"Campo email valida formato correcto"},
    {id:"a17",t:"P3",pl:"both",desc:"Pantalla de login es accesible sin conexión (UI)"},
    {id:"a18",t:"P2",pl:"both",desc:"Rol 'organizer' asignado tras activar creador"},
    {id:"a19",t:"P3",pl:"both",desc:"Rol de worker se asigna al unirse como trabajador"},
    {id:"a20",t:"P2",pl:"both",desc:"Usuario normal no accede a rutas de organizer"},
  ]},
  { id:"events", name:"Eventos", color:"#f472b6", tests:[
    {id:"e01",t:"P1",pl:"both",desc:"Feed principal carga eventos próximos"},
    {id:"e02",t:"P1",pl:"both",desc:"Evento muestra nombre, fecha, hora y lugar"},
    {id:"e03",t:"P1",pl:"both",desc:"Tap en evento abre pantalla de detalle"},
    {id:"e04",t:"P1",pl:"both",desc:"Solo se muestran eventos en radio ≤100 km"},
    {id:"e05",t:"P2",pl:"both",desc:"Sin ubicación se muestran todos los eventos"},
    {id:"e06",t:"P2",pl:"both",desc:"Mensaje vacío cuando no hay eventos en 100 km"},
    {id:"e07",t:"P1",pl:"both",desc:"Precio de entrada se muestra correctamente"},
    {id:"e08",t:"P2",pl:"both",desc:"Evento gratuito muestra 'Gratis'"},
    {id:"e09",t:"P1",pl:"both",desc:"Imagen de portada del evento carga sin error"},
    {id:"e10",t:"P2",pl:"both",desc:"Botón compartir genera link correcto"},
    {id:"e11",t:"P2",pl:"both",desc:"Etiquetas de categoría son visibles"},
    {id:"e12",t:"P3",pl:"both",desc:"Ordenación por distancia cuando hay ubicación"},
    {id:"e13",t:"P2",pl:"both",desc:"Eventos pasados no aparecen en el feed"},
    {id:"e14",t:"P3",pl:"both",desc:"Pull-to-refresh actualiza la lista"},
    {id:"e15",t:"P2",pl:"both",desc:"Búsqueda filtra por nombre de evento"},
    {id:"e16",t:"P2",pl:"both",desc:"Filtro de categoría reduce resultados"},
    {id:"e17",t:"P3",pl:"both",desc:"Filtro de precio máximo funciona"},
    {id:"e18",t:"P2",pl:"both",desc:"Dirección del venue se muestra en detalle"},
    {id:"e19",t:"P3",pl:"both",desc:"Mapa del venue abre Maps/Google Maps"},
    {id:"e20",t:"P2",pl:"both",desc:"Aforo restante visible en detalle"},
    {id:"e21",t:"P3",pl:"both",desc:"Contador regresivo para eventos que empiezan pronto"},
    {id:"e22",t:"P2",pl:"both",desc:"Botón comprar disponible si hay aforo"},
    {id:"e23",t:"P2",pl:"both",desc:"Botón comprar deshabilitado si aforo 0"},
    {id:"e24",t:"P3",pl:"both",desc:"Link de compartir evento no modifica DNS @"},
    {id:"e25",t:"P3",pl:"both",desc:"Deep link de evento abre pantalla de detalle"},
  ]},
  { id:"tickets", name:"Compra de Tickets", color:"#34d399", tests:[
    {id:"tk01",t:"P1",pl:"both",desc:"Selección de tipo de entrada y cantidad"},
    {id:"tk02",t:"P1",pl:"both",desc:"Resumen de compra muestra precio total"},
    {id:"tk03",t:"P1",pl:"both",desc:"Pago con tarjeta Stripe completa la compra"},
    {id:"tk04",t:"P1",pl:"both",desc:"Ticket aparece en 'Mis Tickets' tras pago"},
    {id:"tk05",t:"P1",pl:"both",desc:"QR generado y visible en el ticket"},
    {id:"tk06",t:"P2",pl:"both",desc:"Pago fallido muestra mensaje de error claro"},
    {id:"tk07",t:"P2",pl:"both",desc:"Tarjeta inválida es rechazada por Stripe"},
    {id:"tk08",t:"P2",pl:"both",desc:"Email de confirmación recibido tras compra"},
    {id:"tk09",t:"P2",pl:"both",desc:"Aforo decrece en tiempo real tras compra"},
    {id:"tk10",t:"P3",pl:"both",desc:"Dos usuarios comprando el último ticket: uno falla"},
    {id:"tk11",t:"P2",pl:"both",desc:"Tickets expandibles muestran detalles de tipo"},
    {id:"tk12",t:"P3",pl:"both",desc:"Campo de edad en ticket se puede editar"},
    {id:"tk13",t:"P2",pl:"both",desc:"Transferencia de ticket a otro usuario"},
    {id:"tk14",t:"P2",pl:"both",desc:"Reventa de ticket en panel de reventa"},
    {id:"tk15",t:"P3",pl:"ios",  desc:"Apple Wallet: ticket añadido correctamente"},
    {id:"tk16",t:"P3",pl:"android",desc:"Google Wallet: ticket añadido correctamente"},
    {id:"tk17",t:"P2",pl:"both",desc:"Ticket usado no puede reusarse (QR inválido)"},
    {id:"tk18",t:"P2",pl:"both",desc:"Ticket cancelado no aparece en la lista activa"},
    {id:"tk19",t:"P3",pl:"both",desc:"Múltiples tickets del mismo evento en lista"},
    {id:"tk20",t:"P2",pl:"both",desc:"Precio con descuento aplicado correctamente"},
  ]},
  { id:"scanner", name:"Escáner de Entrada", color:"#fb923c", tests:[
    {id:"sc01",t:"P1",pl:"both",desc:"Worker abre escáner y cámara se activa"},
    {id:"sc02",t:"P1",pl:"both",desc:"QR válido muestra confirmación verde"},
    {id:"sc03",t:"P1",pl:"both",desc:"QR ya usado muestra error 'ya escaneado'"},
    {id:"sc04",t:"P1",pl:"both",desc:"QR inválido/alterado muestra error"},
    {id:"sc05",t:"P2",pl:"both",desc:"Contador de sesión incrementa con cada scan válido"},
    {id:"sc06",t:"P2",pl:"both",desc:"Acceso en vivo muestra total de entradas usadas"},
    {id:"sc07",t:"P2",pl:"both",desc:"Entrada manual de código QR funciona"},
    {id:"sc08",t:"P2",pl:"both",desc:"Entrada manual de código inválido muestra error"},
    {id:"sc09",t:"P2",pl:"both",desc:"Selector de evento muestra solo eventos del organizer"},
    {id:"sc10",t:"P2",pl:"both",desc:"Cambio de evento resetea contador de sesión"},
    {id:"sc11",t:"P3",pl:"both",desc:"Escáner funciona con baja iluminación"},
    {id:"sc12",t:"P3",pl:"both",desc:"Escáner maneja QR dañado / poco legible"},
    {id:"sc13",t:"P2",pl:"both",desc:"Modal de resultado auto-cierra y listo para siguiente"},
    {id:"sc14",t:"P2",pl:"both",desc:"scanned_by_worker_id registrado en ticket"},
    {id:"sc15",t:"P3",pl:"both",desc:"Sin permisos de cámara muestra guía al usuario"},
    {id:"sc16",t:"P3",pl:"android",desc:"Escáner funciona en Android 12+ sin crash"},
    {id:"sc17",t:"P3",pl:"ios",  desc:"Escáner funciona en iOS 16+ sin crash"},
    {id:"sc18",t:"P2",pl:"both",desc:"Worker sin permiso 'scan' no ve el escáner"},
    {id:"sc19",t:"P3",pl:"both",desc:"Vibración háptica en scan válido"},
    {id:"sc20",t:"P2",pl:"both",desc:"Scan de ticket de otro evento muestra error claro"},
  ]},
  { id:"creator", name:"Panel Organizador", color:"#a78bfa", tests:[
    {id:"cr01",t:"P1",pl:"both",desc:"Organizer ve panel de creator en tab bar"},
    {id:"cr02",t:"P1",pl:"both",desc:"Lista de eventos propios se muestra correctamente"},
    {id:"cr03",t:"P1",pl:"both",desc:"Crear nuevo evento guarda y aparece en lista"},
    {id:"cr04",t:"P1",pl:"both",desc:"Editar evento actualiza datos correctamente"},
    {id:"cr05",t:"P1",pl:"both",desc:"Borrar evento lo elimina de la lista"},
    {id:"cr06",t:"P2",pl:"both",desc:"Panel de ventas muestra tickets vendidos y revenue"},
    {id:"cr07",t:"P2",pl:"both",desc:"Lista de asistentes descargable / visualizable"},
    {id:"cr08",t:"P2",pl:"both",desc:"Estadísticas por tipo de entrada"},
    {id:"cr09",t:"P2",pl:"both",desc:"Notificación enviada al publicar evento"},
    {id:"cr10",t:"P3",pl:"both",desc:"Preview del evento antes de publicar"},
    {id:"cr11",t:"P2",pl:"both",desc:"Evento con aforo 0 se marca como agotado"},
    {id:"cr12",t:"P2",pl:"both",desc:"Organizador puede ver QR de evento para workers"},
    {id:"cr13",t:"P3",pl:"both",desc:"Formulario de creación valida campos obligatorios"},
    {id:"cr14",t:"P3",pl:"both",desc:"Fecha de fin no puede ser anterior a la de inicio"},
    {id:"cr15",t:"P2",pl:"both",desc:"Imagen del evento se sube y muestra correctamente"},
    {id:"cr16",t:"P3",pl:"both",desc:"Dirección del venue se autocompleta"},
    {id:"cr17",t:"P2",pl:"both",desc:"Configuración de tipos de entrada (precios, aforo)"},
    {id:"cr18",t:"P3",pl:"both",desc:"Duplicar evento crea copia editable"},
    {id:"cr19",t:"P2",pl:"both",desc:"Panel muestra ingresos totales del evento"},
    {id:"cr20",t:"P3",pl:"both",desc:"Exportar lista de asistentes en CSV"},
  ]},
  { id:"workers", name:"Gestión de Workers", color:"#22d3ee", tests:[
    {id:"w01",t:"P1",pl:"both",desc:"Organizer puede crear worker con nombre y email"},
    {id:"w02",t:"P1",pl:"both",desc:"Worker recibe email de invitación"},
    {id:"w03",t:"P1",pl:"both",desc:"Worker acepta invitación y accede a su panel"},
    {id:"w04",t:"P2",pl:"both",desc:"Permiso 'scan' habilita escáner en worker"},
    {id:"w05",t:"P2",pl:"both",desc:"Permiso 'sell' habilita venta en worker"},
    {id:"w06",t:"P2",pl:"both",desc:"Permiso 'stats' habilita estadísticas en worker"},
    {id:"w07",t:"P2",pl:"both",desc:"Stats de worker muestran escaneos totales"},
    {id:"w08",t:"P2",pl:"both",desc:"Stats de worker muestran ventas y revenue"},
    {id:"w09",t:"P2",pl:"both",desc:"Sin permiso no aparecen las stats del worker"},
    {id:"w10",t:"P2",pl:"both",desc:"Eliminar worker lo borra y pierde acceso"},
    {id:"w11",t:"P3",pl:"both",desc:"Worker eliminado no puede usar su código"},
    {id:"w12",t:"P3",pl:"both",desc:"Múltiples workers en mismo evento sin conflicto"},
    {id:"w13",t:"P2",pl:"both",desc:"Estado 'pending'/'active' visible en la lista"},
    {id:"w14",t:"P3",pl:"both",desc:"Worker puede cambiar su contraseña"},
    {id:"w15",t:"P2",pl:"both",desc:"Organizer ve lista de todos sus workers"},
    {id:"w16",t:"P3",pl:"both",desc:"Tags de permisos (🔍 Scan / 💰 Venta / 📊 Stats) visibles"},
    {id:"w17",t:"P3",pl:"both",desc:"Worker accede solo a eventos asignados"},
    {id:"w18",t:"P2",pl:"both",desc:"scanned_by_worker_id registrado en BD al escanear"},
    {id:"w19",t:"P3",pl:"both",desc:"sold_by_worker_id registrado en BD al vender"},
    {id:"w20",t:"P3",pl:"both",desc:"Revenue del worker calcula solo tickets 'paid'"},
  ]},
  { id:"map", name:"Mapa de Fiestas", color:"#facc15", tests:[
    {id:"m01",t:"P1",pl:"both",desc:"Tab de mapa carga sin error"},
    {id:"m02",t:"P1",pl:"both",desc:"Pins de eventos aparecen en el mapa"},
    {id:"m03",t:"P2",pl:"both",desc:"Pin muestra precio del ticket más barato"},
    {id:"m04",t:"P2",pl:"both",desc:"Tap en pin muestra preview del evento"},
    {id:"m05",t:"P2",pl:"both",desc:"Tap en preview navega a detalle del evento"},
    {id:"m06",t:"P2",pl:"both",desc:"Mapa se centra en ubicación del usuario"},
    {id:"m07",t:"P3",pl:"both",desc:"Sin ubicación el mapa muestra España completa"},
    {id:"m08",t:"P3",pl:"both",desc:"Zoom-in muestra más detalles del pin"},
    {id:"m09",t:"P3",pl:"ios",  desc:"MapKit nativo en iOS sin crash"},
    {id:"m10",t:"P3",pl:"android",desc:"Google Maps en Android sin crash"},
    {id:"m11",t:"P2",pl:"both",desc:"Solo eventos dentro de 100 km visibles en el mapa"},
    {id:"m12",t:"P3",pl:"both",desc:"Clustering de pins cuando hay muchos eventos juntos"},
    {id:"m13",t:"P3",pl:"both",desc:"Botón 'mi ubicación' recentra el mapa"},
    {id:"m14",t:"P2",pl:"both",desc:"Mapa funciona sin conexión con caché"},
    {id:"m15",t:"P3",pl:"both",desc:"Filtros del feed también aplican en el mapa"},
  ]},
  { id:"notifications", name:"Notificaciones", color:"#f87171", tests:[
    {id:"n01",t:"P1",pl:"both",desc:"Solicitud de permiso de notificaciones al primer uso"},
    {id:"n02",t:"P1",pl:"both",desc:"Push recibida cuando organizador publica evento"},
    {id:"n03",t:"P2",pl:"both",desc:"Push recibida cuando hay cambios en el evento"},
    {id:"n04",t:"P2",pl:"both",desc:"Push de recordatorio 24h antes del evento"},
    {id:"n05",t:"P2",pl:"both",desc:"Tap en push navega al evento correcto"},
    {id:"n06",t:"P2",pl:"both",desc:"Notificaciones no se duplican por triggers falsos"},
    {id:"n07",t:"P3",pl:"both",desc:"Notificaciones de Google Wallet al añadir ticket"},
    {id:"n08",t:"P3",pl:"both",desc:"Notificaciones de Apple Wallet al añadir ticket"},
    {id:"n09",t:"P3",pl:"ios",  desc:"Badge de app se actualiza con push en iOS"},
    {id:"n10",t:"P3",pl:"android",desc:"Notificación en Android 13+ requiere permiso explícito"},
    {id:"n11",t:"P2",pl:"both",desc:"Push de venta de reventa recibida por vendedor"},
    {id:"n12",t:"P2",pl:"both",desc:"Sin permiso no se envían pushes silenciosas"},
    {id:"n13",t:"P3",pl:"both",desc:"Push de 'evento próximo' llega a la hora correcta"},
    {id:"n14",t:"P3",pl:"both",desc:"Notificaciones de engagement del wallet llegan"},
    {id:"n15",t:"P2",pl:"both",desc:"Push no se muestra cuando app está en primer plano"},
  ]},
  { id:"profile", name:"Perfil de Usuario", color:"#94a3b8", tests:[
    {id:"p01",t:"P1",pl:"both",desc:"Tab de perfil carga datos del usuario"},
    {id:"p02",t:"P2",pl:"both",desc:"Editar nombre y apellido guarda cambios"},
    {id:"p03",t:"P2",pl:"both",desc:"Cambiar foto de perfil (galería / cámara)"},
    {id:"p04",t:"P2",pl:"both",desc:"Cambiar contraseña desde perfil"},
    {id:"p05",t:"P2",pl:"both",desc:"Idioma de la app cambia al instante"},
    {id:"p06",t:"P3",pl:"both",desc:"Fecha de nacimiento guarda y muestra correctamente"},
    {id:"p07",t:"P2",pl:"both",desc:"Mis tickets lista todas las entradas del usuario"},
    {id:"p08",t:"P3",pl:"both",desc:"Historial de eventos asistidos visible"},
    {id:"p09",t:"P2",pl:"both",desc:"Eliminar cuenta requiere confirmación"},
    {id:"p10",t:"P2",pl:"both",desc:"Tras eliminar cuenta, sesión cerrada y datos borrados"},
    {id:"p11",t:"P3",pl:"both",desc:"Activar modo organizador muestra panel creator"},
    {id:"p12",t:"P3",pl:"both",desc:"Verificación de organizador sube documentos"},
    {id:"p13",t:"P3",pl:"both",desc:"Avatar por defecto cuando no hay foto"},
    {id:"p14",t:"P3",pl:"both",desc:"Información de privacidad y términos accesibles"},
    {id:"p15",t:"P3",pl:"both",desc:"Soporte / contacto accesible desde perfil"},
  ]},
  { id:"resale", name:"Reventa de Tickets", color:"#fb7185", tests:[
    {id:"r01",t:"P2",pl:"both",desc:"Ticket elegible aparece en panel de reventa"},
    {id:"r02",t:"P2",pl:"both",desc:"Usuario puede poner precio de reventa"},
    {id:"r03",t:"P2",pl:"both",desc:"Ticket publicado aparece en mercado de reventa"},
    {id:"r04",t:"P2",pl:"both",desc:"Comprar ticket de reventa funciona con Stripe"},
    {id:"r05",t:"P2",pl:"both",desc:"Ticket se transfiere al comprador tras pago"},
    {id:"r06",t:"P2",pl:"both",desc:"Vendedor recibe notificación de venta exitosa"},
    {id:"r07",t:"P3",pl:"both",desc:"Precio de reventa no puede exceder máximo del organizador"},
    {id:"r08",t:"P3",pl:"both",desc:"Retirar ticket de reventa lo vuelve al dueño"},
    {id:"r09",t:"P3",pl:"both",desc:"Ticket de reventa expirado no se puede comprar"},
    {id:"r10",t:"P3",pl:"both",desc:"Comisión de plataforma calculada correctamente"},
    {id:"r11",t:"P3",pl:"both",desc:"Mercado de reventa visible en tab de reventa"},
    {id:"r12",t:"P2",pl:"both",desc:"Un ticket no puede revenderse dos veces"},
    {id:"r13",t:"P3",pl:"both",desc:"Historial de reventas visible en perfil"},
    {id:"r14",t:"P3",pl:"both",desc:"Reventa deshabilitada si el organizador no la permite"},
    {id:"r15",t:"P3",pl:"both",desc:"QR de ticket se regenera tras transferencia"},
  ]},
  { id:"wallet", name:"Digital Wallet (iOS / Android)", color:"#38bdf8", tests:[
    {id:"wal01",t:"P2",pl:"ios",  desc:"Botón 'Add to Apple Wallet' visible en ticket"},
    {id:"wal02",t:"P2",pl:"ios",  desc:"Pass .pkpass se añade a Apple Wallet sin error"},
    {id:"wal03",t:"P2",pl:"ios",  desc:"Pass muestra nombre del evento y fecha"},
    {id:"wal04",t:"P2",pl:"ios",  desc:"QR del pass es válido para el escáner"},
    {id:"wal05",t:"P3",pl:"ios",  desc:"Pass se actualiza si el evento cambia hora/lugar"},
    {id:"wal06",t:"P2",pl:"android",desc:"Botón 'Add to Google Wallet' visible en ticket"},
    {id:"wal07",t:"P2",pl:"android",desc:"JWT de Google Wallet generado correctamente"},
    {id:"wal08",t:"P2",pl:"android",desc:"Pass se añade a Google Wallet sin error"},
    {id:"wal09",t:"P2",pl:"android",desc:"Pass muestra nombre del evento y fecha"},
    {id:"wal10",t:"P3",pl:"android",desc:"Pass Google Wallet actualizable tras cambio de evento"},
    {id:"wal11",t:"P3",pl:"both",desc:"Sin conexión, pass ya descargado sigue accesible"},
    {id:"wal12",t:"P3",pl:"ios",  desc:"Apple Wallet no crash en iOS < 16"},
    {id:"wal13",t:"P3",pl:"android",desc:"Google Wallet no crash en Android < 10"},
    {id:"wal14",t:"P3",pl:"both",desc:"Notificación de wallet llega antes del evento"},
    {id:"wal15",t:"P3",pl:"both",desc:"Múltiples passes en wallet sin duplicados"},
  ]},
  { id:"stripe", name:"Pagos Stripe", color:"#818cf8", tests:[
    {id:"st01",t:"P1",pl:"both",desc:"Payment Intent creado correctamente en edge function"},
    {id:"st02",t:"P1",pl:"both",desc:"Pago con tarjeta de prueba 4242... aprobado"},
    {id:"st03",t:"P1",pl:"both",desc:"Pago con tarjeta de prueba 4000...0002 rechazado"},
    {id:"st04",t:"P2",pl:"both",desc:"Webhook de Stripe actualiza estado del ticket"},
    {id:"st05",t:"P2",pl:"both",desc:"Reembolso desde Stripe Portal refleja en ticket"},
    {id:"st06",t:"P2",pl:"both",desc:"Stripe Connect para organizadores: pago dividido"},
    {id:"st07",t:"P3",pl:"both",desc:"Comisión de plataforma deducida correctamente"},
    {id:"st08",t:"P3",pl:"both",desc:"3D Secure challenge completado correctamente"},
    {id:"st09",t:"P3",pl:"both",desc:"Pago con Apple Pay en iOS (si habilitado)"},
    {id:"st10",t:"P3",pl:"android",desc:"Pago con Google Pay en Android (si habilitado)"},
    {id:"st11",t:"P2",pl:"both",desc:"Sin conexión, pago no se procesa (no cuelga)"},
    {id:"st12",t:"P2",pl:"both",desc:"Doble tap en 'Pagar' no crea dos intents"},
    {id:"st13",t:"P3",pl:"both",desc:"Moneda EUR correctamente enviada a Stripe"},
    {id:"st14",t:"P3",pl:"both",desc:"Metadata del ticket incluida en payment intent"},
    {id:"st15",t:"P2",pl:"both",desc:"Error de Stripe muestra mensaje legible al usuario"},
  ]},
  { id:"offline", name:"Comportamiento Offline", color:"#6ee7b7", tests:[
    {id:"of01",t:"P2",pl:"both",desc:"Eventos en caché visibles sin conexión"},
    {id:"of02",t:"P2",pl:"both",desc:"Tickets descargados visibles offline"},
    {id:"of03",t:"P2",pl:"both",desc:"Intentar comprar offline muestra aviso claro"},
    {id:"of04",t:"P2",pl:"both",desc:"Al volver online los datos se sincronizan"},
    {id:"of05",t:"P3",pl:"both",desc:"Escáner puede funcionar con caché local de QR"},
    {id:"of06",t:"P3",pl:"both",desc:"App no crashea al perder conexión durante carga"},
    {id:"of07",t:"P3",pl:"both",desc:"Banner de 'sin conexión' visible cuando offline"},
    {id:"of08",t:"P2",pl:"both",desc:"Caché de eventos expira y se refresca al volver online"},
    {id:"of09",t:"P3",pl:"both",desc:"Wallet pass accesible offline sin app abierta"},
    {id:"of10",t:"P3",pl:"both",desc:"Push notifications bufferizadas y llegan al reconectar"},
  ]},
  { id:"perf", name:"Rendimiento y Estabilidad", color:"#fbbf24", tests:[
    {id:"pf01",t:"P1",pl:"both",desc:"App arranca en < 3s en dispositivo de gama media"},
    {id:"pf02",t:"P1",pl:"both",desc:"Feed carga en < 2s con conexión normal"},
    {id:"pf03",t:"P1",pl:"both",desc:"Escáner procesa QR en < 1s"},
    {id:"pf04",t:"P2",pl:"both",desc:"No hay memory leak tras 30 min de uso continuo"},
    {id:"pf05",t:"P2",pl:"both",desc:"FlatList de eventos no lag con 50+ items"},
    {id:"pf06",t:"P2",pl:"both",desc:"Imágenes cargadas con lazy load y caché"},
    {id:"pf07",t:"P3",pl:"both",desc:"Animaciones a 60fps en navegación entre tabs"},
    {id:"pf08",t:"P2",pl:"both",desc:"Filtro 100km evita cargar todos los eventos (no crash)"},
    {id:"pf09",t:"P3",pl:"android",desc:"No ANR (App Not Responding) en Android"},
    {id:"pf10",t:"P3",pl:"ios",  desc:"No crash reportado en Crashlytics / Sentry (iOS)"},
    {id:"pf11",t:"P2",pl:"both",desc:"Deep links resueltos en < 1s"},
    {id:"pf12",t:"P3",pl:"both",desc:"Supabase RLS no añade latencia perceptible"},
    {id:"pf13",t:"P2",pl:"both",desc:"Escáner no drena batería en 1h de uso"},
    {id:"pf14",t:"P3",pl:"both",desc:"Logs de error en Supabase < 1% de peticiones"},
    {id:"pf15",t:"P2",pl:"both",desc:"Edge functions responden en < 500ms en p95"},
  ]},
  { id:"a11y", name:"Accesibilidad y UI", color:"#c084fc", tests:[
    {id:"ac01",t:"P2",pl:"both",desc:"Textos escalables con tamaño de fuente del sistema"},
    {id:"ac02",t:"P2",pl:"ios",  desc:"VoiceOver navega pantalla de ticket sin errores"},
    {id:"ac03",t:"P2",pl:"android",desc:"TalkBack navega pantalla de ticket sin errores"},
    {id:"ac04",t:"P2",pl:"both",desc:"Contraste de texto > 4.5:1 en modo oscuro"},
    {id:"ac05",t:"P3",pl:"both",desc:"Modo claro / oscuro respetado según sistema"},
    {id:"ac06",t:"P3",pl:"both",desc:"Teclado no tapa inputs en formularios"},
    {id:"ac07",t:"P3",pl:"both",desc:"Safe area correcta en iPhone con notch/isla dinámica"},
    {id:"ac08",t:"P3",pl:"android",desc:"Safe area correcta en Android con punch-hole"},
    {id:"ac09",t:"P3",pl:"both",desc:"Loader (DiscoLoader) no bloquea interacción indefinidamente"},
    {id:"ac10",t:"P2",pl:"both",desc:"Todos los botones tienen área táctil ≥ 44x44 pt"},
    {id:"ac11",t:"P3",pl:"both",desc:"Mensajes de error son legibles y explícitos"},
    {id:"ac12",t:"P3",pl:"both",desc:"Animaciones respetan prefers-reduced-motion"},
    {id:"ac13",t:"P2",pl:"both",desc:"Inputs de formulario tienen placeholders y labels"},
    {id:"ac14",t:"P3",pl:"both",desc:"Teclado cierra al tocar fuera del input"},
    {id:"ac15",t:"P2",pl:"both",desc:"Scroll funciona sin áreas muertas o bloqueos"},
  ]},
]);

// ──────────────────────────────────────────────────────────────────────────────
// Serve the full HTML page
// ──────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // ── REST proxy: forward Supabase REST calls from the page ─────────────────
  if (url.pathname.endsWith("/qa-board/rest")) {
    const target   = url.searchParams.get("target") ?? "";
    const method   = req.method;
    const body     = method !== "GET" && method !== "HEAD" ? await req.text() : undefined;

    const res = await fetch(`${SUPABASE_URL}/rest/v1/${target}`, {
      method,
      headers: {
        "apikey":        SUPABASE_ANON,
        "Authorization": `Bearer ${SUPABASE_ANON}`,
        "Content-Type":  "application/json",
        "Prefer":        req.headers.get("Prefer") ?? "",
      },
      body,
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: {
        "Content-Type":                "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // ── Main HTML page ─────────────────────────────────────────────────────────
  const html = buildHtml();
  const headers = new Headers();
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(html, { headers });
});

// ──────────────────────────────────────────────────────────────────────────────
// HTML builder — no backticks inside to avoid escaping issues
// ──────────────────────────────────────────────────────────────────────────────
function buildHtml(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Eclipse QA Board</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0f0f1a;--surface:#1a1a2e;--border:rgba(255,255,255,.1);
  --text:#e2e8f0;--muted:#94a3b8;--accent:#818cf8;
  --pass:#4ade80;--fail:#f87171;--skip:#fbbf24;--none:#334155;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
}
body{background:var(--bg);color:var(--text);min-height:100vh}
.hero{background:linear-gradient(135deg,#1e1b4b,#0f172a);padding:32px 20px;text-align:center;border-bottom:1px solid var(--border)}
.hero h1{font-size:clamp(1.4rem,4vw,2rem);font-weight:800;letter-spacing:-.02em;color:#fff}
.hero p{color:var(--muted);margin-top:6px;font-size:.9rem}
.hero .badge{display:inline-block;background:var(--accent);color:#fff;border-radius:99px;padding:2px 10px;font-size:.75rem;font-weight:700;margin-top:10px}

/* Mode picker */
#modePicker{display:flex;gap:16px;justify-content:center;padding:32px 20px;flex-wrap:wrap}
.modeCard{background:var(--surface);border:2px solid var(--border);border-radius:16px;padding:28px 32px;cursor:pointer;transition:all .2s;text-align:center;min-width:200px}
.modeCard:hover,.modeCard.sel{border-color:var(--accent);background:rgba(129,140,248,.08)}
.modeCard .icon{font-size:2.5rem;margin-bottom:12px}
.modeCard h2{font-size:1.1rem;font-weight:700}
.modeCard p{color:var(--muted);font-size:.85rem;margin-top:6px}

/* Forms */
#setupTester,#setupOrg{display:none;max-width:480px;margin:0 auto;padding:0 20px 32px}
.formGroup{margin-bottom:16px}
label{display:block;margin-bottom:6px;font-size:.85rem;color:var(--muted)}
input[type=text]{width:100%;background:#0d0d1f;border:1px solid var(--border);color:var(--text);border-radius:10px;padding:12px 14px;font-size:1rem;outline:none}
input[type=text]:focus{border-color:var(--accent)}
.btn{display:inline-flex;align-items:center;gap:8px;background:var(--accent);color:#fff;border:none;border-radius:10px;padding:12px 20px;font-size:.95rem;font-weight:700;cursor:pointer;width:100%;justify-content:center;margin-top:8px}
.btn:hover{opacity:.85}
.btn.sec{background:var(--none);color:var(--text)}

/* Session info bar */
#sessionBar{display:none;background:rgba(129,140,248,.12);border-bottom:1px solid rgba(129,140,248,.25);padding:10px 20px;display:none;align-items:center;gap:12px;flex-wrap:wrap}
#sessionBar .code{font-size:1.5rem;font-weight:900;letter-spacing:.1em;color:var(--accent)}
#sessionBar .info{color:var(--muted);font-size:.85rem}
#sessionBar .live{margin-left:auto;display:flex;align-items:center;gap:6px;font-size:.8rem;color:var(--pass)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--pass);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}

/* Organizer live banner */
#orgBanner{display:none;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);border-radius:12px;margin:16px 20px;padding:12px 16px;font-size:.85rem;color:#fca5a5}

/* Filters */
#filterBar{display:none;padding:12px 20px;border-bottom:1px solid var(--border);display:none;flex-wrap:wrap;gap:8px;align-items:center}
.chip{padding:5px 12px;border-radius:99px;border:1px solid var(--border);cursor:pointer;font-size:.8rem;background:transparent;color:var(--muted);transition:all .15s}
.chip.active{background:var(--accent);border-color:var(--accent);color:#fff}
.plat-ios{border-color:#a78bfa;color:#a78bfa}
.plat-android{border-color:#4ade80;color:#4ade80}
.plat-ios.active{background:#a78bfa;color:#fff}
.plat-android.active{background:#4ade80;color:#fff}

/* Progress bar */
#progressBar{display:none;padding:10px 20px;border-bottom:1px solid var(--border)}
.pbar-track{background:var(--none);border-radius:99px;height:6px;overflow:hidden;margin-bottom:4px}
.pbar-fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--pass));border-radius:99px;transition:width .4s}
.pstats{display:flex;gap:16px;font-size:.78rem}
.pstats span{display:flex;align-items:center;gap:5px}

/* Modules */
#modules{display:none;padding:12px 20px 40px}
.module{margin-bottom:28px}
.modHeader{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);margin-bottom:10px;cursor:pointer}
.modTitle{font-weight:700;font-size:1rem}
.modCount{font-size:.8rem;color:var(--muted);margin-left:auto}
.modDot{width:10px;height:10px;border-radius:50%}

/* Test row */
.test{display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.test:last-child{border:none}
.test-tags{display:flex;gap:5px;flex-shrink:0;margin-top:1px}
.tag{padding:2px 6px;border-radius:4px;font-size:.68rem;font-weight:700;text-transform:uppercase}
.p1{background:rgba(248,113,113,.2);color:#fca5a5}
.p2{background:rgba(251,191,36,.2);color:#fde68a}
.p3{background:rgba(148,163,184,.15);color:#94a3b8}
.ios{background:rgba(167,139,250,.2);color:#c4b5fd}
.android{background:rgba(74,222,128,.2);color:#6ee7b7}
.both{background:rgba(129,140,248,.2);color:#a5b4fc}
.test-desc{flex:1;font-size:.88rem;line-height:1.4}
.test-btns{display:flex;gap:5px;flex-shrink:0}
.tb{width:28px;height:28px;border-radius:7px;border:1px solid var(--border);background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.9rem;transition:all .15s;flex-shrink:0}
.tb:hover{border-color:currentColor;transform:scale(1.1)}
.tb.sel-pass{background:rgba(74,222,128,.25);border-color:var(--pass)}
.tb.sel-fail{background:rgba(248,113,113,.25);border-color:var(--fail)}
.tb.sel-skip{background:rgba(251,191,36,.25);border-color:var(--skip)}
.test.res-pass{background:rgba(74,222,128,.04)}
.test.res-fail{background:rgba(248,113,113,.06)}
.test.res-skip{background:rgba(251,191,36,.04)}
.test-id{font-size:.7rem;color:var(--muted);flex-shrink:0;width:36px}

/* Read-only org view */
.org-result{width:22px;height:22px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:.8rem;flex-shrink:0}

/* Copy code */
.copyCode{cursor:pointer;user-select:none;padding:2px 6px;border-radius:6px;border:1px dashed rgba(129,140,248,.4);background:transparent;color:var(--accent);font-size:.8rem}
.copyCode:hover{background:rgba(129,140,248,.1)}

/* Utils */
.hidden{display:none!important}
.section-title{font-size:.7rem;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:8px;margin-top:20px}

/* Refresh indicator */
#refreshBtn{padding:5px 12px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;font-size:.8rem}
#refreshBtn:hover{border-color:var(--accent);color:var(--accent)}

/* Empty */
#emptyModules{display:none;padding:60px 20px;text-align:center;color:var(--muted)}
</style>
</head>
<body>

<div class="hero">
  <h1>&#9889; Eclipse QA Board</h1>
  <p>Panel de pruebas de calidad en tiempo real</p>
  <span class="badge">370+ tests &bull; 15 m&oacute;dulos</span>
</div>

<!-- Mode picker -->
<div id="modePicker">
  <div class="modeCard" onclick="pickMode('tester')">
    <div class="icon">&#128270;</div>
    <h2>Soy QA Tester</h2>
    <p>Ejecuto pruebas y registro resultados</p>
  </div>
  <div class="modeCard" onclick="pickMode('org')">
    <div class="icon">&#128065;</div>
    <h2>Soy Organizador</h2>
    <p>Veo los resultados en tiempo real</p>
  </div>
</div>

<!-- Tester setup -->
<div id="setupTester">
  <p class="section-title">Nueva sesi&oacute;n QA</p>
  <div class="formGroup">
    <label>Tu nombre</label>
    <input type="text" id="testerName" placeholder="Ej: Ana QA" />
  </div>
  <button class="btn" onclick="startTesterSession()">&#9654; Iniciar sesi&oacute;n</button>
  <button class="btn sec" style="margin-top:8px" onclick="resetMode()">&#8592; Volver</button>
</div>

<!-- Org setup -->
<div id="setupOrg">
  <p class="section-title">Ver sesi&oacute;n en vivo</p>
  <div class="formGroup">
    <label>C&oacute;digo de sesi&oacute;n (6 letras)</label>
    <input type="text" id="orgCode" placeholder="Ej: AB12CD" maxlength="6" style="text-transform:uppercase;letter-spacing:.15em;font-size:1.3rem" />
  </div>
  <button class="btn" onclick="startOrgView()">&#128065; Ver en vivo</button>
  <button class="btn sec" style="margin-top:8px" onclick="resetMode()">&#8592; Volver</button>
</div>

<!-- Session bar (tester) -->
<div id="sessionBar" style="display:none">
  <div>
    <div class="info">C&oacute;digo de sesi&oacute;n</div>
    <div style="display:flex;align-items:center;gap:8px">
      <span class="code" id="sessionCode">------</span>
      <button class="copyCode" onclick="copyCode()">copiar</button>
    </div>
    <div class="info">Comparte este c&oacute;digo con el organizador</div>
  </div>
  <div class="live"><span class="dot"></span> Sincronizado</div>
</div>

<!-- Org banner -->
<div id="orgBanner"></div>

<!-- Filter bar -->
<div id="filterBar" style="display:none">
  <button class="chip active" onclick="setF('status','')">Todos</button>
  <button class="chip" onclick="setF('status','pass')" style="border-color:var(--pass);color:var(--pass)">&#10003; OK</button>
  <button class="chip" onclick="setF('status','fail')" style="border-color:var(--fail);color:var(--fail)">&#10007; Fallo</button>
  <button class="chip" onclick="setF('status','skip')" style="border-color:var(--skip);color:var(--skip)">&#8212; Skip</button>
  <button class="chip" onclick="setF('status','none')">Sin probar</button>
  <span style="width:1px;height:20px;background:var(--border)"></span>
  <button class="chip" onclick="setF('prio','')">Todas</button>
  <button class="chip p1" onclick="setF('prio','P1')">P1</button>
  <button class="chip p2" onclick="setF('prio','P2')">P2</button>
  <button class="chip p3" onclick="setF('prio','P3')">P3</button>
  <span style="width:1px;height:20px;background:var(--border)"></span>
  <button class="chip" onclick="setF('plat','')">Todas plats</button>
  <button class="chip plat-ios" onclick="setF('plat','ios')">iOS</button>
  <button class="chip plat-android" onclick="setF('plat','android')">Android</button>
  <button id="refreshBtn" style="margin-left:auto" onclick="syncNow()">&#8635; Actualizar</button>
</div>

<!-- Progress bar -->
<div id="progressBar" style="display:none">
  <div class="pbar-track"><div class="pbar-fill" id="pbarFill" style="width:0%"></div></div>
  <div class="pstats">
    <span style="color:var(--pass)">&#10003; <b id="cntPass">0</b> OK</span>
    <span style="color:var(--fail)">&#10007; <b id="cntFail">0</b> Fallos</span>
    <span style="color:var(--skip)">&#8212; <b id="cntSkip">0</b> Skip</span>
    <span style="color:var(--muted)">&#9679; <b id="cntNone">0</b> Pendientes</span>
    <span style="color:var(--muted);margin-left:auto"><b id="cntTotal">0</b> total</span>
  </div>
</div>

<div id="emptyModules">No hay tests que coincidan con los filtros.</div>
<div id="modules"></div>

<script>
// ── Data ──────────────────────────────────────────────────────────────────────
const MODULES = ${MODULES_JSON};
const SUPABASE_URL  = "${SUPABASE_URL}";
const SUPABASE_ANON = "${SUPABASE_ANON}";
const EDGE_URL = SUPABASE_URL + "/functions/v1/qa-board";

// ── State ─────────────────────────────────────────────────────────────────────
let mode         = "";   // "tester" | "org"
let sessionCode  = "";
let testerName   = "";
let results      = {};   // { testId: "pass"|"fail"|"skip" }
let orgResults   = {};   // organizer read-only copy
let pollTimer    = null;
let fStatus = "", fPrio = "", fPlat = "";

// ── Mode picker ───────────────────────────────────────────────────────────────
function pickMode(m) {
  mode = m;
  document.getElementById("modePicker").style.display  = "none";
  document.getElementById("setupTester").style.display = m === "tester" ? "block" : "none";
  document.getElementById("setupOrg").style.display    = m === "org"    ? "block" : "none";
}

function resetMode() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  mode = "";
  document.getElementById("modePicker").style.display  = "flex";
  document.getElementById("setupTester").style.display = "none";
  document.getElementById("setupOrg").style.display    = "none";
  document.getElementById("sessionBar").style.display  = "none";
  document.getElementById("filterBar").style.display   = "none";
  document.getElementById("progressBar").style.display = "none";
  document.getElementById("modules").style.display     = "none";
  document.getElementById("orgBanner").style.display   = "none";
  document.getElementById("emptyModules").style.display= "none";
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function randCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

async function sbGet(table, filter) {
  const url = SUPABASE_URL + "/rest/v1/" + table + "?" + filter + "&limit=1";
  const r = await fetch(url, {
    headers: { "apikey": SUPABASE_ANON, "Authorization": "Bearer " + SUPABASE_ANON }
  });
  const d = await r.json();
  return Array.isArray(d) ? d[0] : null;
}

async function sbPost(table, body) {
  const url = SUPABASE_URL + "/rest/v1/" + table;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_ANON, "Authorization": "Bearer " + SUPABASE_ANON,
      "Content-Type": "application/json", "Prefer": "return=representation"
    },
    body: JSON.stringify(body)
  });
  const d = await r.json();
  return Array.isArray(d) ? d[0] : d;
}

async function sbPatch(table, filter, body) {
  const url = SUPABASE_URL + "/rest/v1/" + table + "?" + filter;
  await fetch(url, {
    method: "PATCH",
    headers: {
      "apikey": SUPABASE_ANON, "Authorization": "Bearer " + SUPABASE_ANON,
      "Content-Type": "application/json", "Prefer": "return=minimal"
    },
    body: JSON.stringify(body)
  });
}

// ── Tester session ────────────────────────────────────────────────────────────
async function startTesterSession() {
  testerName = document.getElementById("testerName").value.trim() || "QA";
  sessionCode = randCode();
  results = {};

  // Create session in Supabase
  await sbPost("qa_sessions", {
    code: sessionCode,
    tester: testerName,
    results: {},
    notes: {}
  });

  document.getElementById("setupTester").style.display = "none";
  document.getElementById("sessionCode").textContent = sessionCode;
  document.getElementById("sessionBar").style.display = "flex";
  document.getElementById("filterBar").style.display  = "flex";
  document.getElementById("progressBar").style.display = "block";
  document.getElementById("modules").style.display = "block";

  renderModules();
}

function copyCode() {
  navigator.clipboard.writeText(sessionCode).then(function() {
    const btn = document.querySelector(".copyCode");
    const orig = btn.textContent;
    btn.textContent = "copiado!";
    setTimeout(function() { btn.textContent = orig; }, 1500);
  });
}

// ── Org view ──────────────────────────────────────────────────────────────────
async function startOrgView() {
  const code = document.getElementById("orgCode").value.trim().toUpperCase();
  if (code.length !== 6) { alert("Introduce los 6 caracteres del código"); return; }

  const session = await sbGet("qa_sessions", "code=eq." + code);
  if (!session) { alert("Sesión no encontrada. Verifica el código."); return; }

  sessionCode = code;
  orgResults  = session.results || {};
  testerName  = session.tester || "QA";

  document.getElementById("setupOrg").style.display    = "none";
  document.getElementById("filterBar").style.display   = "flex";
  document.getElementById("progressBar").style.display = "block";
  document.getElementById("modules").style.display     = "block";

  const banner = document.getElementById("orgBanner");
  banner.style.display = "block";
  banner.innerHTML = "&#128065; Viendo sesión de <b>" + testerName + "</b> &mdash; código <b>" + code + "</b> &mdash; <span id='orgLastSync'>...</span>";

  renderModules();
  pollTimer = setInterval(pollOrg, 3000);
}

async function pollOrg() {
  const session = await sbGet("qa_sessions", "code=eq." + sessionCode);
  if (!session) return;
  orgResults = session.results || {};
  const el = document.getElementById("orgLastSync");
  if (el) el.textContent = "actualizado " + new Date().toLocaleTimeString();
  renderModules();
}

async function syncNow() {
  if (mode === "org") { await pollOrg(); return; }
}

// ── Mark test (tester only) ───────────────────────────────────────────────────
async function mark(testId, status) {
  if (mode === "org") return;
  const current = results[testId];
  if (current === status) {
    delete results[testId];
  } else {
    results[testId] = status;
  }
  // Persist to Supabase
  await sbPatch("qa_sessions", "code=eq." + sessionCode, { results: results });
  renderModules();
}

// ── Filters ───────────────────────────────────────────────────────────────────
function setF(type, val) {
  if (type === "status") fStatus = val;
  if (type === "prio")   fPrio   = val;
  if (type === "plat")   fPlat   = val;

  // Update chips
  document.querySelectorAll("[onclick^='setF']").forEach(function(el) {
    el.classList.remove("active");
  });
  document.querySelectorAll("[onclick=\"setF('status','')\"]").forEach(function(el) {
    if (!fStatus) el.classList.add("active");
  });
  if (fStatus) {
    const el = document.querySelector("[onclick=\"setF('status','" + fStatus + "')\"]");
    if (el) el.classList.add("active");
  }
  document.querySelectorAll("[onclick=\"setF('prio','')\"]").forEach(function(el) {
    if (!fPrio) el.classList.add("active");
  });
  if (fPrio) {
    const el = document.querySelector("[onclick=\"setF('prio','" + fPrio + "')\"]");
    if (el) el.classList.add("active");
  }
  if (fPlat) {
    const el = document.querySelector("[onclick=\"setF('plat','" + fPlat + "')\"]");
    if (el) el.classList.add("active");
  }

  renderModules();
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderModules() {
  const res = mode === "org" ? orgResults : results;
  const container = document.getElementById("modules");
  container.innerHTML = "";

  let totalPass = 0, totalFail = 0, totalSkip = 0, totalNone = 0, totalAll = 0;

  let anyVisible = false;

  MODULES.forEach(function(mod) {
    const tests = mod.tests.filter(function(t) {
      const tRes = res[t.id] || "none";
      if (fStatus && fStatus !== "none" && tRes !== fStatus) return false;
      if (fStatus === "none" && tRes !== "none" && tRes !== undefined) return false;
      if (fPrio && t.t !== fPrio) return false;
      if (fPlat && t.pl !== "both" && t.pl !== fPlat) return false;
      return true;
    });

    tests.forEach(function(t) {
      const tRes = res[t.id] || "none";
      if (tRes === "pass") totalPass++;
      else if (tRes === "fail") totalFail++;
      else if (tRes === "skip") totalSkip++;
      else totalNone++;
      totalAll++;
    });

    if (tests.length === 0) return;
    anyVisible = true;

    const section = document.createElement("div");
    section.className = "module";

    const passC = tests.filter(function(t) { return res[t.id] === "pass"; }).length;
    const failC = tests.filter(function(t) { return res[t.id] === "fail"; }).length;

    const hdr = document.createElement("div");
    hdr.className = "modHeader";
    hdr.innerHTML =
      '<div class="modDot" style="background:' + mod.color + '"></div>' +
      '<span class="modTitle">' + mod.name + '</span>' +
      '<span class="modCount">' +
        (passC > 0 ? '<span style="color:var(--pass)">' + passC + ' OK</span> ' : '') +
        (failC > 0 ? '<span style="color:var(--fail)">' + failC + ' fallos</span> ' : '') +
        tests.length + ' tests' +
      '</span>';

    section.appendChild(hdr);

    tests.forEach(function(t) {
      const tRes = res[t.id] || "none";
      const row  = document.createElement("div");
      row.className = "test res-" + tRes;

      if (mode === "org") {
        const icon = tRes === "pass" ? "&#10003;" : tRes === "fail" ? "&#10007;" : tRes === "skip" ? "&#8212;" : "&middot;";
        const bg   = tRes === "pass" ? "rgba(74,222,128,.2)" : tRes === "fail" ? "rgba(248,113,113,.2)" : tRes === "skip" ? "rgba(251,191,36,.2)" : "rgba(51,65,85,.4)";
        row.innerHTML =
          '<span class="test-id">' + t.id + '</span>' +
          '<div class="test-tags">' +
            '<span class="tag ' + t.t.toLowerCase() + '">' + t.t + '</span>' +
            '<span class="tag ' + t.pl + '">' + (t.pl === "both" ? "iOS+And" : t.pl) + '</span>' +
          '</div>' +
          '<span class="test-desc">' + t.desc + '</span>' +
          '<div class="org-result" style="background:' + bg + '">' + icon + '</div>';
      } else {
        row.innerHTML =
          '<span class="test-id">' + t.id + '</span>' +
          '<div class="test-tags">' +
            '<span class="tag ' + t.t.toLowerCase() + '">' + t.t + '</span>' +
            '<span class="tag ' + t.pl + '">' + (t.pl === "both" ? "iOS+And" : t.pl) + '</span>' +
          '</div>' +
          '<span class="test-desc">' + t.desc + '</span>' +
          '<div class="test-btns">' +
            '<button class="tb ' + (tRes === "pass" ? "sel-pass" : "") + '" onclick="mark(\'' + t.id + '\',\'pass\')" title="OK">&#10003;</button>' +
            '<button class="tb ' + (tRes === "fail" ? "sel-fail" : "") + '" onclick="mark(\'' + t.id + '\',\'fail\')" title="Fallo">&#10007;</button>' +
            '<button class="tb ' + (tRes === "skip" ? "sel-skip" : "") + '" onclick="mark(\'' + t.id + '\',\'skip\')" title="Skip">&#8212;</button>' +
          '</div>';
      }

      section.appendChild(row);
    });

    container.appendChild(section);
  });

  // Progress
  document.getElementById("cntPass").textContent  = totalPass;
  document.getElementById("cntFail").textContent  = totalFail;
  document.getElementById("cntSkip").textContent  = totalSkip;
  document.getElementById("cntNone").textContent  = totalNone;
  document.getElementById("cntTotal").textContent = totalAll;
  const pct = totalAll > 0 ? ((totalPass + totalFail + totalSkip) / totalAll * 100) : 0;
  document.getElementById("pbarFill").style.width = pct.toFixed(1) + "%";

  // Empty state
  document.getElementById("emptyModules").style.display = anyVisible ? "none" : "block";
}
</script>
</body>
</html>`;
}
