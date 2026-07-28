const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { env } = require('./config/env');
const { errorHandler } = require('./middlewares/errorHandler');
const { authRoutes } = require('./routes/authRoutes');
const { eventRoutes } = require('./routes/eventRoutes');
const { paymentRoutes } = require('./routes/paymentRoutes');
const { stripeRoutes } = require('./routes/stripeRoutes');
const { stripeWebhookRoutes } = require('./routes/stripeWebhookRoutes');
const { testRoutes } = require('./routes/testRoutes');
const { organizerRoutes } = require('./routes/organizerRoutes');
const { syncStripeOnboardingCompletionFromStripeAccountId } = require('./services/paymentService');

function buildQaHtml(SB_URL, SB_ANON) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Eclipse QA Board</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0f0f1a;--surface:#1a1a2e;--border:rgba(255,255,255,.1);--text:#e2e8f0;--muted:#94a3b8;--accent:#818cf8;--pass:#4ade80;--fail:#f87171;--skip:#fbbf24;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
body{background:var(--bg);color:var(--text);min-height:100vh}
.hero{background:linear-gradient(135deg,#1e1b4b,#0f172a);padding:32px 20px;text-align:center;border-bottom:1px solid var(--border)}
.hero h1{font-size:clamp(1.4rem,4vw,2rem);font-weight:800;color:#fff}
.hero p{color:var(--muted);margin-top:6px;font-size:.9rem}
.badge{display:inline-block;background:var(--accent);color:#fff;border-radius:99px;padding:2px 10px;font-size:.75rem;font-weight:700;margin-top:10px}
#modePicker{display:flex;gap:16px;justify-content:center;padding:32px 20px;flex-wrap:wrap}
.modeCard{background:var(--surface);border:2px solid var(--border);border-radius:16px;padding:28px 32px;cursor:pointer;transition:border-color .2s;text-align:center;min-width:200px}
.modeCard:hover{border-color:var(--accent)}
.modeCard .icon{font-size:2.5rem;margin-bottom:12px}
.modeCard h2{font-size:1.1rem;font-weight:700}
.modeCard p{color:var(--muted);font-size:.85rem;margin-top:6px}
#setupTester,#setupOrg{display:none;max-width:480px;margin:0 auto;padding:0 20px 32px}
.fg{margin-bottom:16px}
label{display:block;margin-bottom:6px;font-size:.85rem;color:var(--muted)}
input[type=text]{width:100%;background:#0d0d1f;border:1px solid var(--border);color:var(--text);border-radius:10px;padding:12px 14px;font-size:1rem;outline:none}
input[type=text]:focus{border-color:var(--accent)}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;background:var(--accent);color:#fff;border:none;border-radius:10px;padding:12px 20px;font-size:.95rem;font-weight:700;cursor:pointer;width:100%;margin-top:8px}
.btn.sec{background:#334155}
#sessionBar{display:none;background:rgba(129,140,248,.12);border-bottom:1px solid rgba(129,140,248,.25);padding:10px 20px;align-items:center;gap:12px;flex-wrap:wrap}
.scode{font-size:1.5rem;font-weight:900;letter-spacing:.1em;color:var(--accent)}
.smuted{color:var(--muted);font-size:.85rem}
.live{margin-left:auto;display:flex;align-items:center;gap:6px;font-size:.8rem;color:var(--pass)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--pass);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
#orgBanner{display:none;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);border-radius:12px;margin:16px 20px;padding:12px 16px;font-size:.85rem;color:#fca5a5}
#filterBar{display:none;padding:12px 20px;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:8px;align-items:center}
.chip{padding:5px 12px;border-radius:99px;border:1px solid var(--border);cursor:pointer;font-size:.8rem;background:transparent;color:var(--muted)}
.chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
.ios-chip{border-color:#a78bfa;color:#a78bfa}.ios-chip.on{background:#a78bfa;color:#fff}
.and-chip{border-color:#4ade80;color:#4ade80}.and-chip.on{background:#4ade80;color:#fff}
#progressBar{display:none;padding:10px 20px;border-bottom:1px solid var(--border)}
.ptrack{background:#334155;border-radius:99px;height:6px;overflow:hidden;margin-bottom:4px}
.pfill{height:100%;background:linear-gradient(90deg,var(--accent),var(--pass));border-radius:99px;transition:width .4s}
.pstats{display:flex;gap:16px;font-size:.78rem}
#modules{display:none;padding:12px 20px 60px}
.mod{margin-bottom:28px}
.modh{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);margin-bottom:10px}
.modt{font-weight:700;font-size:1rem}
.modc{font-size:.8rem;color:var(--muted);margin-left:auto}
.mdot{width:10px;height:10px;border-radius:50%}
.test{display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.test:last-child{border:none}
.ttags{display:flex;gap:5px;flex-shrink:0;margin-top:1px}
.tag{padding:2px 6px;border-radius:4px;font-size:.68rem;font-weight:700;text-transform:uppercase}
.p1{background:rgba(248,113,113,.2);color:#fca5a5}
.p2{background:rgba(251,191,36,.2);color:#fde68a}
.p3{background:rgba(148,163,184,.15);color:#94a3b8}
.ios{background:rgba(167,139,250,.2);color:#c4b5fd}
.android{background:rgba(74,222,128,.2);color:#6ee7b7}
.both{background:rgba(129,140,248,.2);color:#a5b4fc}
.tdesc{flex:1;font-size:.88rem;line-height:1.4}
.tbtns{display:flex;gap:5px;flex-shrink:0}
.tb{width:28px;height:28px;border-radius:7px;border:1px solid var(--border);background:transparent;cursor:pointer;font-size:.9rem;transition:all .15s;flex-shrink:0}
.tb.sp{background:rgba(74,222,128,.25);border-color:var(--pass)}
.tb.sf{background:rgba(248,113,113,.25);border-color:var(--fail)}
.tb.ss{background:rgba(251,191,36,.25);border-color:var(--skip)}
.test.rp{background:rgba(74,222,128,.04)}
.test.rf{background:rgba(248,113,113,.06)}
.test.rs{background:rgba(251,191,36,.04)}
.tid{font-size:.7rem;color:var(--muted);flex-shrink:0;width:36px}
.ores{width:22px;height:22px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:.85rem;flex-shrink:0}
.cpbtn{cursor:pointer;padding:2px 6px;border-radius:6px;border:1px dashed rgba(129,140,248,.4);background:transparent;color:var(--accent);font-size:.8rem}
#refreshBtn{padding:5px 12px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;font-size:.8rem;margin-left:auto}
#empty{display:none;padding:60px 20px;text-align:center;color:var(--muted)}
.stitle{font-size:.7rem;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:8px;margin-top:20px}
</style>
</head>
<body>
<div class="hero">
  <h1>&#9889; Eclipse QA Board</h1>
  <p>Panel de pruebas de calidad en tiempo real</p>
  <span class="badge">370+ tests &bull; 15 m&oacute;dulos</span>
</div>
<div id="modePicker">
  <div class="modeCard" id="btnTester"><div class="icon">&#128270;</div><h2>Soy QA Tester</h2><p>Ejecuto pruebas y registro resultados</p></div>
  <div class="modeCard" id="btnOrg"><div class="icon">&#128065;</div><h2>Soy Organizador</h2><p>Veo los resultados en tiempo real</p></div>
</div>
<div id="setupTester">
  <p class="stitle">Nueva sesi&oacute;n QA</p>
  <div class="fg"><label>Tu nombre</label><input type="text" id="testerName" placeholder="Ej: Ana QA"></div>
  <button class="btn" id="btnStart">&#9654; Iniciar sesi&oacute;n</button>
  <button class="btn sec" id="btnBackT">&#8592; Volver</button>
</div>
<div id="setupOrg">
  <p class="stitle">Ver sesi&oacute;n en vivo</p>
  <div class="fg"><label>C&oacute;digo de sesi&oacute;n</label><input type="text" id="orgCode" placeholder="Ej: AB12CD" maxlength="6" style="text-transform:uppercase;letter-spacing:.15em;font-size:1.3rem"></div>
  <button class="btn" id="btnWatch">&#128065; Ver en vivo</button>
  <button class="btn sec" id="btnBackO">&#8592; Volver</button>
</div>
<div id="sessionBar">
  <div>
    <div class="smuted">C&oacute;digo de sesi&oacute;n &mdash; comp&aacute;rtelo con el organizador</div>
    <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
      <span class="scode" id="sCode">------</span>
      <button class="cpbtn" id="btnCopy">copiar</button>
    </div>
  </div>
  <div class="live"><span class="dot"></span>Sincronizado</div>
</div>
<div id="orgBanner"></div>
<div id="filterBar">
  <button class="chip on" data-f="st" data-v="">Todos</button>
  <button class="chip" data-f="st" data-v="pass" style="border-color:var(--pass);color:var(--pass)">&#10003; OK</button>
  <button class="chip" data-f="st" data-v="fail" style="border-color:var(--fail);color:var(--fail)">&#10007; Fallo</button>
  <button class="chip" data-f="st" data-v="skip" style="border-color:var(--skip);color:var(--skip)">&#8212; Skip</button>
  <button class="chip" data-f="st" data-v="none">Sin probar</button>
  <span style="width:1px;height:20px;background:var(--border)"></span>
  <button class="chip on" data-f="pr" data-v="">Todas</button>
  <button class="chip p1" data-f="pr" data-v="P1">P1</button>
  <button class="chip p2" data-f="pr" data-v="P2">P2</button>
  <button class="chip p3" data-f="pr" data-v="P3">P3</button>
  <span style="width:1px;height:20px;background:var(--border)"></span>
  <button class="chip on" data-f="pl" data-v="">Todas plats</button>
  <button class="chip ios-chip" data-f="pl" data-v="ios">iOS</button>
  <button class="chip and-chip" data-f="pl" data-v="android">Android</button>
  <button id="refreshBtn">&#8635; Actualizar</button>
</div>
<div id="progressBar">
  <div class="ptrack"><div class="pfill" id="pfill" style="width:0%"></div></div>
  <div class="pstats">
    <span style="color:var(--pass)">&#10003; <b id="cp">0</b> OK</span>
    <span style="color:var(--fail)">&#10007; <b id="cf">0</b> Fallos</span>
    <span style="color:var(--skip)">&#8212; <b id="cs">0</b> Skip</span>
    <span style="color:var(--muted)">&#9679; <b id="cn">0</b> Pend.</span>
    <span style="margin-left:auto;color:var(--muted)"><b id="ct">0</b> total</span>
  </div>
</div>
<div id="empty">No hay tests que coincidan con los filtros.</div>
<div id="modules"></div>
<script>
var U="${SB_URL}",K="${SB_ANON}";
var MODS=[{id:"auth",name:"Autenticaci\\u00f3n",color:"#818cf8",tests:[{id:"a01",t:"P1",pl:"both",desc:"Registro con email y contrase\\u00f1a v\\u00e1lidos"},{id:"a02",t:"P1",pl:"both",desc:"Verificaci\\u00f3n de email tras registro"},{id:"a03",t:"P1",pl:"both",desc:"Login correcto con credenciales v\\u00e1lidas"},{id:"a04",t:"P1",pl:"both",desc:"Login con contrase\\u00f1a incorrecta muestra error"},{id:"a05",t:"P1",pl:"both",desc:"Login con email no registrado muestra error"},{id:"a06",t:"P2",pl:"both",desc:"Recuperaci\\u00f3n de contrase\\u00f1a por email"},{id:"a07",t:"P2",pl:"both",desc:"Cambio de contrase\\u00f1a desde email de recuperaci\\u00f3n"},{id:"a08",t:"P2",pl:"both",desc:"Sesi\\u00f3n persiste tras cerrar y reabrir la app"},{id:"a09",t:"P1",pl:"both",desc:"Cierre de sesi\\u00f3n limpia estado de usuario"},{id:"a10",t:"P2",pl:"both",desc:"Registro con email ya existente muestra error"},{id:"a11",t:"P2",pl:"both",desc:"Contrase\\u00f1a corta no permite registro"},{id:"a12",t:"P3",pl:"ios",desc:"Login con Face ID / Touch ID"},{id:"a13",t:"P3",pl:"android",desc:"Login con huella dactilar"},{id:"a14",t:"P2",pl:"both",desc:"Token JWT expira y obliga reautenticaci\\u00f3n"},{id:"a15",t:"P3",pl:"both",desc:"Deep link de verificaci\\u00f3n abre app correctamente"},{id:"a16",t:"P2",pl:"both",desc:"Campo email valida formato correcto"},{id:"a17",t:"P3",pl:"both",desc:"Pantalla de login accesible sin conexi\\u00f3n"},{id:"a18",t:"P2",pl:"both",desc:"Rol organizer asignado tras activar creador"},{id:"a19",t:"P3",pl:"both",desc:"Rol worker asignado al unirse"},{id:"a20",t:"P2",pl:"both",desc:"Usuario normal no accede a rutas de organizer"}]},{id:"events",name:"Eventos",color:"#f472b6",tests:[{id:"e01",t:"P1",pl:"both",desc:"Feed principal carga eventos pr\\u00f3ximos"},{id:"e02",t:"P1",pl:"both",desc:"Evento muestra nombre, fecha, hora y lugar"},{id:"e03",t:"P1",pl:"both",desc:"Tap en evento abre pantalla de detalle"},{id:"e04",t:"P1",pl:"both",desc:"Solo se muestran eventos en radio <= 100 km"},{id:"e05",t:"P2",pl:"both",desc:"Sin ubicaci\\u00f3n se muestran todos los eventos"},{id:"e06",t:"P2",pl:"both",desc:"Mensaje vac\\u00edo cuando no hay eventos en 100 km"},{id:"e07",t:"P1",pl:"both",desc:"Precio de entrada se muestra correctamente"},{id:"e08",t:"P2",pl:"both",desc:"Evento gratuito muestra Gratis"},{id:"e09",t:"P1",pl:"both",desc:"Imagen de portada del evento carga sin error"},{id:"e10",t:"P2",pl:"both",desc:"Bot\\u00f3n compartir genera link correcto"},{id:"e11",t:"P2",pl:"both",desc:"Etiquetas de categor\\u00eda son visibles"},{id:"e12",t:"P3",pl:"both",desc:"Ordenaci\\u00f3n por distancia cuando hay ubicaci\\u00f3n"},{id:"e13",t:"P2",pl:"both",desc:"Eventos pasados no aparecen en el feed"},{id:"e14",t:"P3",pl:"both",desc:"Pull-to-refresh actualiza la lista"},{id:"e15",t:"P2",pl:"both",desc:"B\\u00fasqueda filtra por nombre de evento"},{id:"e16",t:"P2",pl:"both",desc:"Filtro de categor\\u00eda reduce resultados"},{id:"e17",t:"P3",pl:"both",desc:"Filtro de precio m\\u00e1ximo funciona"},{id:"e18",t:"P2",pl:"both",desc:"Direcci\\u00f3n del venue se muestra en detalle"},{id:"e19",t:"P3",pl:"both",desc:"Mapa del venue abre Maps"},{id:"e20",t:"P2",pl:"both",desc:"Aforo restante visible en detalle"},{id:"e21",t:"P3",pl:"both",desc:"Contador regresivo para eventos pr\\u00f3ximos"},{id:"e22",t:"P2",pl:"both",desc:"Bot\\u00f3n comprar disponible si hay aforo"},{id:"e23",t:"P2",pl:"both",desc:"Bot\\u00f3n comprar deshabilitado si aforo 0"},{id:"e24",t:"P3",pl:"both",desc:"Link compartir no modifica DNS @"},{id:"e25",t:"P3",pl:"both",desc:"Deep link de evento abre pantalla de detalle"}]},{id:"tickets",name:"Compra de Tickets",color:"#34d399",tests:[{id:"tk01",t:"P1",pl:"both",desc:"Selecci\\u00f3n de tipo de entrada y cantidad"},{id:"tk02",t:"P1",pl:"both",desc:"Resumen de compra muestra precio total"},{id:"tk03",t:"P1",pl:"both",desc:"Pago con tarjeta Stripe completa la compra"},{id:"tk04",t:"P1",pl:"both",desc:"Ticket aparece en Mis Tickets tras pago"},{id:"tk05",t:"P1",pl:"both",desc:"QR generado y visible en el ticket"},{id:"tk06",t:"P2",pl:"both",desc:"Pago fallido muestra mensaje de error claro"},{id:"tk07",t:"P2",pl:"both",desc:"Tarjeta inv\\u00e1lida es rechazada por Stripe"},{id:"tk08",t:"P2",pl:"both",desc:"Email de confirmaci\\u00f3n recibido tras compra"},{id:"tk09",t:"P2",pl:"both",desc:"Aforo decrece en tiempo real tras compra"},{id:"tk10",t:"P3",pl:"both",desc:"Dos usuarios comprando el \\u00faltimo ticket: uno falla"},{id:"tk11",t:"P2",pl:"both",desc:"Tickets expandibles muestran detalles de tipo"},{id:"tk12",t:"P3",pl:"both",desc:"Campo de edad en ticket se puede editar"},{id:"tk13",t:"P2",pl:"both",desc:"Transferencia de ticket a otro usuario"},{id:"tk14",t:"P2",pl:"both",desc:"Reventa de ticket en panel de reventa"},{id:"tk15",t:"P3",pl:"ios",desc:"Apple Wallet: ticket a\\u00f1adido correctamente"},{id:"tk16",t:"P3",pl:"android",desc:"Google Wallet: ticket a\\u00f1adido correctamente"},{id:"tk17",t:"P2",pl:"both",desc:"Ticket usado no puede reusarse"},{id:"tk18",t:"P2",pl:"both",desc:"Ticket cancelado no aparece en lista activa"},{id:"tk19",t:"P3",pl:"both",desc:"M\\u00faltiples tickets del mismo evento en lista"},{id:"tk20",t:"P2",pl:"both",desc:"Precio con descuento aplicado correctamente"}]},{id:"scanner",name:"Esc\\u00e1ner de Entrada",color:"#fb923c",tests:[{id:"sc01",t:"P1",pl:"both",desc:"Worker abre esc\\u00e1ner y c\\u00e1mara se activa"},{id:"sc02",t:"P1",pl:"both",desc:"QR v\\u00e1lido muestra confirmaci\\u00f3n verde"},{id:"sc03",t:"P1",pl:"both",desc:"QR ya usado muestra error ya escaneado"},{id:"sc04",t:"P1",pl:"both",desc:"QR inv\\u00e1lido muestra error"},{id:"sc05",t:"P2",pl:"both",desc:"Contador de sesi\\u00f3n incrementa con scan v\\u00e1lido"},{id:"sc06",t:"P2",pl:"both",desc:"Acceso en vivo muestra total de entradas usadas"},{id:"sc07",t:"P2",pl:"both",desc:"Entrada manual de c\\u00f3digo QR funciona"},{id:"sc08",t:"P2",pl:"both",desc:"Entrada manual de c\\u00f3digo inv\\u00e1lido muestra error"},{id:"sc09",t:"P2",pl:"both",desc:"Selector de evento muestra solo eventos del organizer"},{id:"sc10",t:"P2",pl:"both",desc:"Cambio de evento resetea contador de sesi\\u00f3n"},{id:"sc11",t:"P3",pl:"both",desc:"Esc\\u00e1ner funciona con baja iluminaci\\u00f3n"},{id:"sc12",t:"P3",pl:"both",desc:"Esc\\u00e1ner maneja QR da\\u00f1ado"},{id:"sc13",t:"P2",pl:"both",desc:"Modal auto-cierra y listo para siguiente scan"},{id:"sc14",t:"P2",pl:"both",desc:"scanned_by_worker_id registrado en ticket"},{id:"sc15",t:"P3",pl:"both",desc:"Sin permisos de c\\u00e1mara muestra gu\\u00eda"},{id:"sc16",t:"P3",pl:"android",desc:"Esc\\u00e1ner funciona en Android 12+"},{id:"sc17",t:"P3",pl:"ios",desc:"Esc\\u00e1ner funciona en iOS 16+"},{id:"sc18",t:"P2",pl:"both",desc:"Worker sin permiso scan no ve el esc\\u00e1ner"},{id:"sc19",t:"P3",pl:"both",desc:"Vibraci\\u00f3n h\\u00e1ptica en scan v\\u00e1lido"},{id:"sc20",t:"P2",pl:"both",desc:"Scan de ticket de otro evento muestra error"}]},{id:"creator",name:"Panel Organizador",color:"#a78bfa",tests:[{id:"cr01",t:"P1",pl:"both",desc:"Organizer ve panel de creator en tab bar"},{id:"cr02",t:"P1",pl:"both",desc:"Lista de eventos propios se muestra correctamente"},{id:"cr03",t:"P1",pl:"both",desc:"Crear nuevo evento guarda y aparece en lista"},{id:"cr04",t:"P1",pl:"both",desc:"Editar evento actualiza datos correctamente"},{id:"cr05",t:"P1",pl:"both",desc:"Borrar evento lo elimina de la lista"},{id:"cr06",t:"P2",pl:"both",desc:"Panel de ventas muestra tickets vendidos y revenue"},{id:"cr07",t:"P2",pl:"both",desc:"Lista de asistentes visualizable"},{id:"cr08",t:"P2",pl:"both",desc:"Estad\\u00edsticas por tipo de entrada"},{id:"cr09",t:"P2",pl:"both",desc:"Notificaci\\u00f3n enviada al publicar evento"},{id:"cr10",t:"P3",pl:"both",desc:"Preview del evento antes de publicar"},{id:"cr11",t:"P2",pl:"both",desc:"Evento con aforo 0 se marca como agotado"},{id:"cr12",t:"P2",pl:"both",desc:"Organizador puede ver QR de evento para workers"},{id:"cr13",t:"P3",pl:"both",desc:"Formulario valida campos obligatorios"},{id:"cr14",t:"P3",pl:"both",desc:"Fecha fin no puede ser anterior a inicio"},{id:"cr15",t:"P2",pl:"both",desc:"Imagen del evento se sube y muestra correctamente"},{id:"cr16",t:"P3",pl:"both",desc:"Direcci\\u00f3n del venue se autocompleta"},{id:"cr17",t:"P2",pl:"both",desc:"Configuraci\\u00f3n de tipos de entrada"},{id:"cr18",t:"P3",pl:"both",desc:"Duplicar evento crea copia editable"},{id:"cr19",t:"P2",pl:"both",desc:"Panel muestra ingresos totales del evento"},{id:"cr20",t:"P3",pl:"both",desc:"Exportar lista de asistentes en CSV"}]},{id:"workers",name:"Gesti\\u00f3n de Workers",color:"#22d3ee",tests:[{id:"w01",t:"P1",pl:"both",desc:"Organizer puede crear worker con nombre y email"},{id:"w02",t:"P1",pl:"both",desc:"Worker recibe email de invitaci\\u00f3n"},{id:"w03",t:"P1",pl:"both",desc:"Worker acepta invitaci\\u00f3n y accede a su panel"},{id:"w04",t:"P2",pl:"both",desc:"Permiso scan habilita esc\\u00e1ner en worker"},{id:"w05",t:"P2",pl:"both",desc:"Permiso sell habilita venta en worker"},{id:"w06",t:"P2",pl:"both",desc:"Permiso stats habilita estad\\u00edsticas en worker"},{id:"w07",t:"P2",pl:"both",desc:"Stats de worker muestran escaneos totales"},{id:"w08",t:"P2",pl:"both",desc:"Stats de worker muestran ventas y revenue"},{id:"w09",t:"P2",pl:"both",desc:"Sin permiso no aparecen las stats"},{id:"w10",t:"P2",pl:"both",desc:"Eliminar worker lo borra y pierde acceso"},{id:"w11",t:"P3",pl:"both",desc:"Worker eliminado no puede usar su c\\u00f3digo"},{id:"w12",t:"P3",pl:"both",desc:"M\\u00faltiples workers en mismo evento sin conflicto"},{id:"w13",t:"P2",pl:"both",desc:"Estado pending/active visible en la lista"},{id:"w14",t:"P3",pl:"both",desc:"Worker puede cambiar su contrase\\u00f1a"},{id:"w15",t:"P2",pl:"both",desc:"Organizer ve lista de todos sus workers"},{id:"w16",t:"P3",pl:"both",desc:"Tags de permisos visibles en tarjeta"},{id:"w17",t:"P3",pl:"both",desc:"Worker accede solo a eventos asignados"},{id:"w18",t:"P2",pl:"both",desc:"scanned_by_worker_id registrado al escanear"},{id:"w19",t:"P3",pl:"both",desc:"sold_by_worker_id registrado al vender"},{id:"w20",t:"P3",pl:"both",desc:"Revenue calcula solo tickets paid"}]},{id:"map",name:"Mapa de Fiestas",color:"#facc15",tests:[{id:"m01",t:"P1",pl:"both",desc:"Tab de mapa carga sin error"},{id:"m02",t:"P1",pl:"both",desc:"Pins de eventos aparecen en el mapa"},{id:"m03",t:"P2",pl:"both",desc:"Pin muestra precio del ticket m\\u00e1s barato"},{id:"m04",t:"P2",pl:"both",desc:"Tap en pin muestra preview del evento"},{id:"m05",t:"P2",pl:"both",desc:"Tap en preview navega a detalle"},{id:"m06",t:"P2",pl:"both",desc:"Mapa se centra en ubicaci\\u00f3n del usuario"},{id:"m07",t:"P3",pl:"both",desc:"Sin ubicaci\\u00f3n el mapa muestra Espa\\u00f1a completa"},{id:"m08",t:"P3",pl:"both",desc:"Zoom-in muestra m\\u00e1s detalles del pin"},{id:"m09",t:"P3",pl:"ios",desc:"MapKit nativo en iOS sin crash"},{id:"m10",t:"P3",pl:"android",desc:"Google Maps en Android sin crash"},{id:"m11",t:"P2",pl:"both",desc:"Solo eventos dentro de 100 km visibles"},{id:"m12",t:"P3",pl:"both",desc:"Clustering de pins cuando hay muchos eventos"},{id:"m13",t:"P3",pl:"both",desc:"Bot\\u00f3n mi ubicaci\\u00f3n recentra el mapa"},{id:"m14",t:"P2",pl:"both",desc:"Mapa funciona sin conexi\\u00f3n con cach\\u00e9"},{id:"m15",t:"P3",pl:"both",desc:"Filtros del feed tambi\\u00e9n aplican en el mapa"}]},{id:"notif",name:"Notificaciones",color:"#f87171",tests:[{id:"n01",t:"P1",pl:"both",desc:"Solicitud de permiso al primer uso"},{id:"n02",t:"P1",pl:"both",desc:"Push recibida cuando organizador publica evento"},{id:"n03",t:"P2",pl:"both",desc:"Push recibida cuando hay cambios en el evento"},{id:"n04",t:"P2",pl:"both",desc:"Push de recordatorio 24h antes del evento"},{id:"n05",t:"P2",pl:"both",desc:"Tap en push navega al evento correcto"},{id:"n06",t:"P2",pl:"both",desc:"Notificaciones no se duplican"},{id:"n07",t:"P3",pl:"both",desc:"Notificaciones de Google Wallet"},{id:"n08",t:"P3",pl:"both",desc:"Notificaciones de Apple Wallet"},{id:"n09",t:"P3",pl:"ios",desc:"Badge de app se actualiza en iOS"},{id:"n10",t:"P3",pl:"android",desc:"Notificaci\\u00f3n en Android 13+ requiere permiso"},{id:"n11",t:"P2",pl:"both",desc:"Push de venta de reventa recibida"},{id:"n12",t:"P2",pl:"both",desc:"Sin permiso no se env\\u00edan pushes"},{id:"n13",t:"P3",pl:"both",desc:"Push de evento pr\\u00f3ximo llega a la hora correcta"},{id:"n14",t:"P3",pl:"both",desc:"Notificaciones de engagement del wallet"},{id:"n15",t:"P2",pl:"both",desc:"Push no se muestra con app en primer plano"}]},{id:"profile",name:"Perfil",color:"#94a3b8",tests:[{id:"p01",t:"P1",pl:"both",desc:"Tab de perfil carga datos del usuario"},{id:"p02",t:"P2",pl:"both",desc:"Editar nombre y apellido guarda cambios"},{id:"p03",t:"P2",pl:"both",desc:"Cambiar foto de perfil"},{id:"p04",t:"P2",pl:"both",desc:"Cambiar contrase\\u00f1a desde perfil"},{id:"p05",t:"P2",pl:"both",desc:"Idioma de la app cambia al instante"},{id:"p06",t:"P3",pl:"both",desc:"Fecha de nacimiento guarda correctamente"},{id:"p07",t:"P2",pl:"both",desc:"Mis tickets lista todas las entradas"},{id:"p08",t:"P3",pl:"both",desc:"Historial de eventos asistidos visible"},{id:"p09",t:"P2",pl:"both",desc:"Eliminar cuenta requiere confirmaci\\u00f3n"},{id:"p10",t:"P2",pl:"both",desc:"Tras eliminar cuenta sesi\\u00f3n cerrada"},{id:"p11",t:"P3",pl:"both",desc:"Activar modo organizador muestra panel creator"},{id:"p12",t:"P3",pl:"both",desc:"Verificaci\\u00f3n de organizador sube documentos"},{id:"p13",t:"P3",pl:"both",desc:"Avatar por defecto cuando no hay foto"},{id:"p14",t:"P3",pl:"both",desc:"Informaci\\u00f3n de privacidad accesible"},{id:"p15",t:"P3",pl:"both",desc:"Soporte accesible desde perfil"}]},{id:"resale",name:"Reventa",color:"#fb7185",tests:[{id:"r01",t:"P2",pl:"both",desc:"Ticket elegible aparece en panel de reventa"},{id:"r02",t:"P2",pl:"both",desc:"Usuario puede poner precio de reventa"},{id:"r03",t:"P2",pl:"both",desc:"Ticket publicado aparece en mercado"},{id:"r04",t:"P2",pl:"both",desc:"Comprar ticket de reventa funciona"},{id:"r05",t:"P2",pl:"both",desc:"Ticket se transfiere al comprador tras pago"},{id:"r06",t:"P2",pl:"both",desc:"Vendedor recibe notificaci\\u00f3n de venta"},{id:"r07",t:"P3",pl:"both",desc:"Precio no puede exceder m\\u00e1ximo del organizador"},{id:"r08",t:"P3",pl:"both",desc:"Retirar ticket de reventa vuelve al due\\u00f1o"},{id:"r09",t:"P3",pl:"both",desc:"Ticket expirado no se puede comprar"},{id:"r10",t:"P3",pl:"both",desc:"Comisi\\u00f3n de plataforma calculada correctamente"},{id:"r11",t:"P3",pl:"both",desc:"Mercado de reventa visible en tab"},{id:"r12",t:"P2",pl:"both",desc:"Un ticket no puede revenderse dos veces"},{id:"r13",t:"P3",pl:"both",desc:"Historial de reventas visible en perfil"},{id:"r14",t:"P3",pl:"both",desc:"Reventa deshabilitada si organizador no la permite"},{id:"r15",t:"P3",pl:"both",desc:"QR se regenera tras transferencia"}]},{id:"wallet",name:"Digital Wallet",color:"#38bdf8",tests:[{id:"wal01",t:"P2",pl:"ios",desc:"Bot\\u00f3n Add to Apple Wallet visible"},{id:"wal02",t:"P2",pl:"ios",desc:"Pass .pkpass se a\\u00f1ade a Apple Wallet"},{id:"wal03",t:"P2",pl:"ios",desc:"Pass muestra nombre del evento y fecha"},{id:"wal04",t:"P2",pl:"ios",desc:"QR del pass v\\u00e1lido para el esc\\u00e1ner"},{id:"wal05",t:"P3",pl:"ios",desc:"Pass se actualiza si el evento cambia"},{id:"wal06",t:"P2",pl:"android",desc:"Bot\\u00f3n Add to Google Wallet visible"},{id:"wal07",t:"P2",pl:"android",desc:"JWT de Google Wallet generado correctamente"},{id:"wal08",t:"P2",pl:"android",desc:"Pass se a\\u00f1ade a Google Wallet"},{id:"wal09",t:"P2",pl:"android",desc:"Pass muestra nombre del evento y fecha"},{id:"wal10",t:"P3",pl:"android",desc:"Pass Google Wallet actualizable"},{id:"wal11",t:"P3",pl:"both",desc:"Sin conexi\\u00f3n pass ya descargado accesible"},{id:"wal12",t:"P3",pl:"ios",desc:"Apple Wallet no crash en iOS antiguo"},{id:"wal13",t:"P3",pl:"android",desc:"Google Wallet no crash en Android antiguo"},{id:"wal14",t:"P3",pl:"both",desc:"Notificaci\\u00f3n de wallet antes del evento"},{id:"wal15",t:"P3",pl:"both",desc:"M\\u00faltiples passes sin duplicados"}]},{id:"stripe",name:"Pagos Stripe",color:"#818cf8",tests:[{id:"st01",t:"P1",pl:"both",desc:"Payment Intent creado correctamente"},{id:"st02",t:"P1",pl:"both",desc:"Pago con tarjeta de prueba 4242 aprobado"},{id:"st03",t:"P1",pl:"both",desc:"Pago con tarjeta de prueba rechazado"},{id:"st04",t:"P2",pl:"both",desc:"Webhook actualiza estado del ticket"},{id:"st05",t:"P2",pl:"both",desc:"Reembolso refleja en ticket"},{id:"st06",t:"P2",pl:"both",desc:"Stripe Connect: pago dividido"},{id:"st07",t:"P3",pl:"both",desc:"Comisi\\u00f3n de plataforma deducida correctamente"},{id:"st08",t:"P3",pl:"both",desc:"3D Secure challenge completado"},{id:"st09",t:"P3",pl:"ios",desc:"Pago con Apple Pay"},{id:"st10",t:"P3",pl:"android",desc:"Pago con Google Pay"},{id:"st11",t:"P2",pl:"both",desc:"Sin conexi\\u00f3n pago no se procesa"},{id:"st12",t:"P2",pl:"both",desc:"Doble tap no crea dos intents"},{id:"st13",t:"P3",pl:"both",desc:"Moneda EUR correctamente enviada"},{id:"st14",t:"P3",pl:"both",desc:"Metadata del ticket incluida"},{id:"st15",t:"P2",pl:"both",desc:"Error de Stripe muestra mensaje legible"}]},{id:"offline",name:"Offline",color:"#6ee7b7",tests:[{id:"of01",t:"P2",pl:"both",desc:"Eventos en cach\\u00e9 visibles sin conexi\\u00f3n"},{id:"of02",t:"P2",pl:"both",desc:"Tickets descargados visibles offline"},{id:"of03",t:"P2",pl:"both",desc:"Intentar comprar offline muestra aviso"},{id:"of04",t:"P2",pl:"both",desc:"Al volver online los datos se sincronizan"},{id:"of05",t:"P3",pl:"both",desc:"Esc\\u00e1ner puede funcionar con cach\\u00e9 local"},{id:"of06",t:"P3",pl:"both",desc:"App no crashea al perder conexi\\u00f3n"},{id:"of07",t:"P3",pl:"both",desc:"Banner de sin conexi\\u00f3n visible"},{id:"of08",t:"P2",pl:"both",desc:"Cach\\u00e9 expira y se refresca al volver online"},{id:"of09",t:"P3",pl:"both",desc:"Wallet pass accesible offline"},{id:"of10",t:"P3",pl:"both",desc:"Pushes bufferizadas llegan al reconectar"}]},{id:"perf",name:"Rendimiento",color:"#fbbf24",tests:[{id:"pf01",t:"P1",pl:"both",desc:"App arranca en menos de 3s"},{id:"pf02",t:"P1",pl:"both",desc:"Feed carga en menos de 2s"},{id:"pf03",t:"P1",pl:"both",desc:"Esc\\u00e1ner procesa QR en menos de 1s"},{id:"pf04",t:"P2",pl:"both",desc:"No hay memory leak tras 30 min"},{id:"pf05",t:"P2",pl:"both",desc:"FlatList no lag con 50+ items"},{id:"pf06",t:"P2",pl:"both",desc:"Im\\u00e1genes con lazy load y cach\\u00e9"},{id:"pf07",t:"P3",pl:"both",desc:"Animaciones a 60fps"},{id:"pf08",t:"P2",pl:"both",desc:"Filtro 100km evita crash por carga masiva"},{id:"pf09",t:"P3",pl:"android",desc:"No ANR en Android"},{id:"pf10",t:"P3",pl:"ios",desc:"No crash en Crashlytics iOS"},{id:"pf11",t:"P2",pl:"both",desc:"Deep links resueltos en menos de 1s"},{id:"pf12",t:"P3",pl:"both",desc:"Supabase RLS sin latencia perceptible"},{id:"pf13",t:"P2",pl:"both",desc:"Esc\\u00e1ner no drena bater\\u00eda en 1h"},{id:"pf14",t:"P3",pl:"both",desc:"Logs de error Supabase menores al 1%"},{id:"pf15",t:"P2",pl:"both",desc:"Edge functions responden en menos de 500ms"}]},{id:"a11y",name:"Accesibilidad",color:"#c084fc",tests:[{id:"ac01",t:"P2",pl:"both",desc:"Textos escalables con fuente del sistema"},{id:"ac02",t:"P2",pl:"ios",desc:"VoiceOver navega pantalla de ticket"},{id:"ac03",t:"P2",pl:"android",desc:"TalkBack navega pantalla de ticket"},{id:"ac04",t:"P2",pl:"both",desc:"Contraste de texto mayor al 4.5:1"},{id:"ac05",t:"P3",pl:"both",desc:"Modo claro/oscuro respetado"},{id:"ac06",t:"P3",pl:"both",desc:"Teclado no tapa inputs"},{id:"ac07",t:"P3",pl:"both",desc:"Safe area correcta en iPhone con notch"},{id:"ac08",t:"P3",pl:"android",desc:"Safe area correcta en Android"},{id:"ac09",t:"P3",pl:"both",desc:"Loader no bloquea interacci\\u00f3n indefinidamente"},{id:"ac10",t:"P2",pl:"both",desc:"Botones con \\u00e1rea t\\u00e1ctil m\\u00ednima 44pt"},{id:"ac11",t:"P3",pl:"both",desc:"Mensajes de error legibles y expl\\u00edcitos"},{id:"ac12",t:"P3",pl:"both",desc:"Animaciones respetan prefers-reduced-motion"},{id:"ac13",t:"P2",pl:"both",desc:"Inputs con placeholders y labels"},{id:"ac14",t:"P3",pl:"both",desc:"Teclado cierra al tocar fuera del input"},{id:"ac15",t:"P2",pl:"both",desc:"Scroll funciona sin bloqueos"}]}];
var mode="",code="",res={},orgRes={},timer=null,fSt="",fPr="",fPl="";
function g(id){return document.getElementById(id)}
function sbGet(t,f,cb){fetch(U+"/rest/v1/"+t+"?"+f+"&limit=1",{headers:{"apikey":K,"Authorization":"Bearer "+K,"Cache-Control":"no-cache"}}).then(function(r){return r.json()}).then(function(d){cb(Array.isArray(d)?d[0]:null)}).catch(function(){cb(null)})}
function sbPost(t,b,cb){fetch(U+"/rest/v1/"+t,{method:"POST",headers:{"apikey":K,"Authorization":"Bearer "+K,"Content-Type":"application/json","Prefer":"return=minimal"},body:JSON.stringify(b)}).then(function(){if(cb)cb()}).catch(function(){if(cb)cb()})}
function sbPatch(t,f,b){fetch(U+"/rest/v1/"+t+"?"+f,{method:"PATCH",headers:{"apikey":K,"Authorization":"Bearer "+K,"Content-Type":"application/json","Prefer":"return=minimal"},body:JSON.stringify(b)}).catch(function(){})}
function randCode(){var c="ABCDEFGHJKLMNPQRSTUVWXYZ23456789",r="";for(var i=0;i<6;i++)r+=c[Math.floor(Math.random()*c.length)];return r}
function pickMode(m){mode=m;g("modePicker").style.display="none";g("setupTester").style.display=m==="tester"?"block":"none";g("setupOrg").style.display=m==="org"?"block":"none"}
function resetMode(){if(timer){clearInterval(timer);timer=null}mode="";g("modePicker").style.display="flex";["setupTester","setupOrg","sessionBar","filterBar","progressBar","modules","orgBanner","empty"].forEach(function(id){g(id).style.display="none"})}
function startSession(){var name=g("testerName").value.trim()||"QA";code=randCode();res={};sbPost("qa_sessions",{code:code,tester:name,results:{},notes:{}},function(){});g("setupTester").style.display="none";g("sCode").textContent=code;g("sessionBar").style.display="flex";g("filterBar").style.display="flex";g("progressBar").style.display="block";g("modules").style.display="block";render()}
function copyCode(){navigator.clipboard.writeText(code).then(function(){var b=g("btnCopy");b.textContent="copiado!";setTimeout(function(){b.textContent="copiar"},1500)})}
function watchOrg(){var c=g("orgCode").value.trim().toUpperCase();if(c.length!==6){alert("Introduce los 6 caracteres");return}sbGet("qa_sessions","code=eq."+c,function(s){if(!s){alert("Sesión no encontrada");return}code=c;orgRes=s.results||{};g("setupOrg").style.display="none";g("filterBar").style.display="flex";g("progressBar").style.display="block";g("modules").style.display="block";var b=g("orgBanner");b.style.display="block";b.innerHTML="&#128065; Viendo sesi\\u00f3n de <b>"+(s.tester||"QA")+"</b> &mdash; c\\u00f3digo <b>"+c+"</b> &mdash; <span id='lastSync'>actualizando...</span>";render();timer=setInterval(poll,3000)})}
function poll(){sbGet("qa_sessions","code=eq."+code,function(s){if(!s)return;orgRes=s.results||{};var el=g("lastSync");if(el)el.textContent="actualizado "+new Date().toLocaleTimeString();render()})}
function mark(id,st){if(mode==="org")return;if(res[id]===st)delete res[id];else res[id]=st;sbPatch("qa_sessions","code=eq."+code,{results:res});render()}
function setF(type,val){if(type==="st")fSt=val;if(type==="pr")fPr=val;if(type==="pl")fPl=val;document.querySelectorAll("[data-f='"+type+"']").forEach(function(b){b.classList.toggle("on",b.dataset.v===val)});render()}
function render(){var r=mode==="org"?orgRes:res,container=g("modules");container.innerHTML="";var tp=0,tf=0,ts=0,tn=0,ta=0,any=false;MODS.forEach(function(mod){var tests=mod.tests.filter(function(t){var rv=r[t.id]||"none";if(fSt&&fSt!=="none"&&rv!==fSt)return false;if(fSt==="none"&&rv!=="none")return false;if(fPr&&t.t!==fPr)return false;if(fPl&&t.pl!=="both"&&t.pl!==fPl)return false;return true});tests.forEach(function(t){var rv=r[t.id]||"none";if(rv==="pass")tp++;else if(rv==="fail")tf++;else if(rv==="skip")ts++;else tn++;ta++});if(!tests.length)return;any=true;var pc=tests.filter(function(t){return r[t.id]==="pass"}).length,fc=tests.filter(function(t){return r[t.id]==="fail"}).length;var sec=document.createElement("div");sec.className="mod";var pl=t.pl==="both"?"iOS+And":t.pl;sec.innerHTML='<div class="modh"><div class="mdot" style="background:'+mod.color+'"></div><span class="modt">'+mod.name+'</span><span class="modc">'+(pc?'<span style="color:var(--pass)">'+pc+' OK</span> ':'')+(fc?'<span style="color:var(--fail)">'+fc+' fallos</span> ':'')+tests.length+' tests</span></div>';tests.forEach(function(t){var rv=r[t.id]||"none",platL=t.pl==="both"?"iOS+And":t.pl;var row=document.createElement("div");row.className="test r"+(rv==="pass"?"p":rv==="fail"?"f":rv==="skip"?"s":"");if(mode==="org"){var ic=rv==="pass"?"&#10003;":rv==="fail"?"&#10007;":rv==="skip"?"&#8212;":"&middot;",bg=rv==="pass"?"rgba(74,222,128,.2)":rv==="fail"?"rgba(248,113,113,.2)":rv==="skip"?"rgba(251,191,36,.2)":"rgba(51,65,85,.4)";row.innerHTML='<span class="tid">'+t.id+'</span><div class="ttags"><span class="tag '+t.t.toLowerCase()+'">'+t.t+'</span><span class="tag '+t.pl+'">'+platL+'</span></div><span class="tdesc">'+t.desc+'</span><div class="ores" style="background:'+bg+'">'+ic+'</div>'}else{row.innerHTML='<span class="tid">'+t.id+'</span><div class="ttags"><span class="tag '+t.t.toLowerCase()+'">'+t.t+'</span><span class="tag '+t.pl+'">'+platL+'</span></div><span class="tdesc">'+t.desc+'</span><div class="tbtns"><button class="tb'+(rv==="pass"?" sp":"")+ '" data-id="'+t.id+'" data-st="pass">&#10003;</button><button class="tb'+(rv==="fail"?" sf":"")+ '" data-id="'+t.id+'" data-st="fail">&#10007;</button><button class="tb'+(rv==="skip"?" ss":"")+ '" data-id="'+t.id+'" data-st="skip">&#8212;</button></div>'}sec.appendChild(row)});container.appendChild(sec)});g("cp").textContent=tp;g("cf").textContent=tf;g("cs").textContent=ts;g("cn").textContent=tn;g("ct").textContent=ta;g("pfill").style.width=(ta>0?((tp+tf+ts)/ta*100):0).toFixed(1)+"%";g("empty").style.display=any?"none":"block"}
document.addEventListener("DOMContentLoaded",function(){g("btnTester").addEventListener("click",function(){pickMode("tester")});g("btnOrg").addEventListener("click",function(){pickMode("org")});g("btnStart").addEventListener("click",startSession);g("btnBackT").addEventListener("click",resetMode);g("btnWatch").addEventListener("click",watchOrg);g("btnBackO").addEventListener("click",resetMode);g("btnCopy").addEventListener("click",copyCode);g("refreshBtn").addEventListener("click",function(){if(mode==="org")poll()});document.querySelectorAll("[data-f]").forEach(function(b){b.addEventListener("click",function(){setF(this.dataset.f,this.dataset.v)})});g("modules").addEventListener("click",function(e){var tb=e.target.closest(".tb");if(tb)mark(tb.dataset.id,tb.dataset.st)})});
</script>
</body>
</html>`;
}

function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin) return cb(null, true);
        if (env.nodeEnv !== 'production') return cb(null, true);

        const fromEnv = String(process.env.CORS_ORIGINS || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const allowed = new Set([env.publicAppUrl, ...fromEnv].filter(Boolean));
        return allowed.has(origin) ? cb(null, true) : cb(null, false);
      },
      credentials: true,
    })
  );
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

  app.get('/', (req, res) => res.send('Eclipse API viva 🚀'));
  app.get('/health', (req, res) => {
    res.setHeader('X-Eclipse-Proxy', 'health-v2');
    return res.json({ ok: true, service: 'backend', version: 'health-v2' });
  });
  app.get('/.well-known/apple-app-site-association', (req, res) => {
    const teamId = String(process.env.APPLE_TEAM_ID || '').trim();
    const bundleId = String(process.env.IOS_BUNDLE_ID || 'com.achraf.eclipse').trim();
    if (!teamId) {
      return res.status(500).json({ ok: false, error: 'Missing APPLE_TEAM_ID' });
    }
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send(
      JSON.stringify(
        {
          applinks: {
            apps: [],
            details: [
              {
                appIDs: [`${teamId}.${bundleId}`],
                components: [{ '/': '/evento/*' }, { '/': '/event/*' }, { '/': '/verified*' }],
              },
            ],
          },
        },
        null,
        2
      )
    );
  });
  app.get('/.well-known/assetlinks.json', (req, res) => {
    const packageName = String(process.env.ANDROID_PACKAGE_NAME || 'com.achraf.eclipse').trim();
    const raw = String(process.env.ANDROID_SHA256_CERT_FINGERPRINTS || '').trim();
    const fingerprints = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    res.setHeader('Content-Type', 'application/json');
    if (!fingerprints.length) return res.status(200).send(JSON.stringify([], null, 2));
    return res.status(200).send(
      JSON.stringify(
        [
          {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
              namespace: 'android_app',
              package_name: packageName,
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ],
        null,
        2
      )
    );
  });
  app.get('/event/:id', (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).send('Missing id');
    const deepLink = `eclipse://event/${encodeURIComponent(id)}`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Abrir evento</title>
    <style>
      body { margin:0; font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif; background:#0f0f1a; color:#fff; }
      .wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
      .card { max-width:520px; width:100%; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:18px; padding:22px; }
      h1 { margin:0 0 10px; font-size:22px; }
      p { margin:0 0 16px; color:rgba(255,255,255,0.78); line-height:1.45; }
      a.btn { display:inline-block; background:#7c3aed; color:#fff; text-decoration:none; padding:12px 16px; border-radius:14px; font-weight:800; }
      .muted { margin-top:10px; font-size:12px; color:rgba(255,255,255,0.55); }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>Abrir evento</h1>
        <p>Si tienes la app instalada, se abrirá automáticamente.</p>
        <a class="btn" href="${deepLink}">Abrir en la app</a>
        <div class="muted">Si no se abre automáticamente, pulsa el botón.</div>
      </div>
    </div>
    <script>
      setTimeout(function(){ window.location.href = ${JSON.stringify(deepLink)}; }, 350);
    </script>
  </body>
</html>`);
  });
  app.get('/evento/:token', async (req, res) => {
    try {
      const token = String(req.params.token || '').trim();
      if (!token) return res.status(400).send('Missing token');
      const supabaseUrl = String(env.supabaseUrl || '').replace(/\/$/, '');
      const target = `${supabaseUrl}/functions/v1/event-share/evento/${encodeURIComponent(token)}`;
      if (typeof fetch !== 'function') return res.status(500).send('Server fetch not available');
      const upstream = await fetch(target, {
        method: 'GET',
        headers: {
          accept: 'text/html',
          apikey: env.supabaseAnonKey,
          Authorization: `Bearer ${env.supabaseAnonKey}`,
        },
      });
      const html = await upstream.text().catch(() => '');
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/html; charset=utf-8');
      res.setHeader('X-Eclipse-Proxy', 'evento-v2');
      res.setHeader('X-Eclipse-Upstream-Status', String(upstream.status));
      return res.status(upstream.status).send(html);
    } catch {
      return res.status(500).send('Failed to resolve share link');
    }
  });
  app.get('/stripe/complete', async (req, res) => {
    const account = String(req.query.account || '').trim();
    const rawNext = String(req.query.next || '').trim();
    const isValid = /^acct_[A-Za-z0-9]+$/.test(account);

    if (isValid) {
      try {
        await syncStripeOnboardingCompletionFromStripeAccountId(account);
      } catch {}
    }

    const next =
      rawNext.startsWith('eclipse://') || rawNext.startsWith('partyapp://') || rawNext.startsWith('exp://')
        ? rawNext
        : 'eclipse://(creator)/verification?stripe=return';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Eclipse · Stripe completado</title>
    <style>
      body { margin:0; font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif; background:#0f0f1a; color:#fff; }
      .wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
      .card { max-width:520px; width:100%; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:18px; padding:22px; }
      h1 { margin:0 0 10px; font-size:22px; }
      p { margin:0 0 16px; color:rgba(255,255,255,0.78); line-height:1.45; }
      a.btn { display:inline-block; background:#7c3aed; color:#fff; text-decoration:none; padding:12px 16px; border-radius:14px; font-weight:800; }
      .muted { margin-top:10px; font-size:12px; color:rgba(255,255,255,0.55); }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>Stripe completado</h1>
        <p>La configuración de Stripe se ha completado. Ya puedes volver a la app.</p>
        <a class="btn" href="${next}">Volver a Eclipse</a>
        <div class="muted">Si no se abre automáticamente, pulsa el botón.</div>
      </div>
    </div>
    <script>
      setTimeout(function(){ window.location.href = ${JSON.stringify(next)}; }, 900);
    </script>
  </body>
</html>`);
  });
  app.get('/verified', (req, res) => {
    const rawNext = typeof req.query.next === 'string' ? req.query.next : '';
    const next =
      rawNext.startsWith('eclipse://') || rawNext.startsWith('partyapp://') || rawNext.startsWith('exp://')
        ? rawNext
        : 'eclipse://auth/callback';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Eclipse · Verificación completada</title>
    <style>
      body { margin:0; font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif; background:#0f0f1a; color:#fff; }
      .wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
      .card { max-width:520px; width:100%; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:18px; padding:22px; }
      h1 { margin:0 0 10px; font-size:22px; }
      p { margin:0 0 16px; color:rgba(255,255,255,0.78); line-height:1.45; }
      a.btn { display:inline-block; background:#7c3aed; color:#fff; text-decoration:none; padding:12px 16px; border-radius:14px; font-weight:800; }
      .muted { margin-top:10px; font-size:12px; color:rgba(255,255,255,0.55); }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>Registro verificado</h1>
        <p>Tu cuenta se ha verificado correctamente. Ya puedes volver a la app.</p>
        <a class="btn" href="${next}">Abrir Eclipse</a>
        <div class="muted">Si no se abre automáticamente, pulsa el botón.</div>
      </div>
    </div>
    <script>
      setTimeout(function(){ window.location.href = ${JSON.stringify(next)}; }, 900);
    </script>
  </body>
</html>`);
  });
  app.get('/qa', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const SB_URL  = 'https://zurbdrfmwjqbrscairub.supabase.co';
    const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1cmJkcmZtd2pxYnJzY2FpcnViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyODgyNTcsImV4cCI6MjA4Mjg2NDI1N30.e81tNdU21I67m9UleGKf5t4n6vy8dGdLuJIJtSPFDIQ';
    return res.status(200).send(buildQaHtml(SB_URL, SB_ANON));
  });

  app.use('/test', testRoutes);

  app.use('/api/stripe', stripeWebhookRoutes);
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/stripe', stripeRoutes);
  app.use('/api/test', testRoutes);
  app.use('/organizer', organizerRoutes);

  app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }));
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
