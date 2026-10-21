import {notifyTeam,notifyUsers} from './notifications.ts';
import {scheduleOptions,planSchedule} from '../src/domain/schedule.ts';
import type {BusySlot} from '../src/domain/schedule.ts';
import { randomUUID } from 'node:crypto';
import { ensure, text, integer, choice, isoDate, TERMS_VERSION, DomainError } from '../src/domain/model.ts';
import type { Actor, Row, Sport, Format } from '../src/domain/model.ts';
import { fixtures, validateScore, winner, standings, calendar } from '../src/domain/competition.ts';
import { one } from './db.ts';
import type { DB, Database } from './db.ts';
import type {PaymentMode} from './config.ts';
import { hash, secret } from './security.ts';
export const id = () => randomUUID();
const asISO = (d: any) => new Date(d).toISOString();
async function audit(db: DB, actor: string | null, action: string, resource: string, detail: Row = {}) {
  await db.query('INSERT INTO rondiqo.audit(id,actor_id,action,resource_id,detail) VALUES($1,$2,$3,$4,$5)', [id(), actor, action, resource, JSON.stringify(detail)]);
}
async function notify(db: DB, user: string, title: string, message: string) {
  await db.query('INSERT INTO rondiqo.notifications(id,user_id,title,message) VALUES($1,$2,$3,$4)', [id(), user, title, message]);
}
async function getCompetition(db: DB, compId: string) {
  const c = await one(db, 'SELECT c.*,o.name AS organizer,o.verified,o.owner_id,o.stripe_account FROM rondiqo.competitions c JOIN rondiqo.organizations o ON o.id=c.org_id WHERE c.id=$1', [compId]);
  ensure(c, 'NOT_FOUND', 'Competición no encontrada.', 404); return c;
}
async function orgPermission(db: DB, actor: Actor, orgId: string, roles = ['owner','manager']) {
  if (actor.role === 'admin') return true;
  const m = await one(db, 'SELECT role FROM rondiqo.org_members WHERE org_id=$1 AND user_id=$2', [orgId, actor.id]);
  return !!m && roles.includes(m.role);
}
async function requireOrg(db: DB, actor: Actor, orgId: string, roles = ['owner','manager']) {
  ensure(await orgPermission(db, actor, orgId, roles), 'FORBIDDEN', 'No tienes permiso para esta organización.', 403);
}
async function getRegistration(db: DB, regId: string) {
  const r = await one(db, 'SELECT * FROM rondiqo.registrations WHERE id=$1', [regId]);
  ensure(r, 'NOT_FOUND', 'Inscripción no encontrada.', 404); return r;
}
async function slots(db: DB, compId: string) {
  return Number((await one(db, "SELECT count(*) AS n FROM rondiqo.registrations WHERE competition_id=$1 AND status IN ('confirmed','pending','refund_pending')", [compId]))?.n ?? 0);
}
async function expireLocal(db: DB) {
  // Any late Stripe payment is reconciled to a refund, never a second claim on the same place.
  await db.query("UPDATE rondiqo.registrations SET status='expired' WHERE status='pending' AND expires_at < now()");
}
async function scheduleConflict(db: DB, starts: string, duration: number, court: string, roster: string[], exclude?: string) {
  const end = new Date(Date.parse(starts) + duration * 60000).toISOString();
  return one(db, `SELECT m.id FROM rondiqo.matches m JOIN rondiqo.competitions c ON c.id=m.competition_id
    WHERE ($1::uuid IS NULL OR m.id<>$1) AND c.status IN ('running','completed') AND m.status<>'bye'
    AND m.starts_at<$3::timestamptz AND m.starts_at+m.duration_minutes*interval '1 minute'>$2::timestamptz
    AND (lower(trim(m.court))=lower(trim($4)) OR EXISTS(
      SELECT 1 FROM rondiqo.registrations r WHERE r.competition_id=m.competition_id
      AND (r.id=m.home OR r.id=m.away OR (m.home IS NULL OR m.away IS NULL) AND r.status='confirmed')
      AND r.roster ?| ARRAY(SELECT jsonb_array_elements_text($5::jsonb))))`,
    [exclude ?? null, starts, end, court, JSON.stringify(roster)]);
}
export class Service {
  db: Database;
  paymentMode: PaymentMode;
  constructor(db: Database, paymentMode: PaymentMode = 'simulated') { this.db = db; this.paymentMode = paymentMode; }
  async execute(actor: Actor, action: string, input: Row, key?: string) {
    return this.db.transaction(async db => {
      const actual = await one(db, 'SELECT * FROM rondiqo.profiles WHERE id=$1', [actor.id]);
      ensure(actual && !actual.suspended, 'FORBIDDEN', 'Cuenta no disponible.', 403);
      actor = actual as Actor;
      await expireLocal(db);
      const requestHash = hash(JSON.stringify({ action, input }));
      if (key) {
        text(key, 'Clave de operación', 8, 120);
        const previous = await one(db, 'SELECT * FROM rondiqo.idempotency WHERE actor_id=$1 AND key=$2', [actor.id, key]);
        if (previous) { ensure(previous.request_hash === requestHash, 'IDEMPOTENCY', 'Esta clave ya se utilizó para otra operación.', 409); return previous.response; }
      }
      const result = await this.command(db, actor, action, input);
      if (key) await db.query('INSERT INTO rondiqo.idempotency(actor_id,key,request_hash,response) VALUES($1,$2,$3,$4)', [actor.id, key, requestHash, JSON.stringify(result)]);
      return result;
    });
  }
  async command(db: DB, actor: Actor, action: string, p: Row): Promise<Row> {
    if (action === 'profile.update') {
      const name = text(p.name, 'Nombre', 2, 60), city = text(p.city, 'Ciudad', 2, 60);
      const level = choice(p.level, ['beginner','intermediate','advanced'], 'Nivel');
      await db.query('UPDATE rondiqo.profiles SET name=$1,city=$2,level=$3,marketing_opt_in=$4 WHERE id=$5', [name, city, level, p.marketing_opt_in === true, actor.id]);
      await audit(db, actor.id, action, actor.id); return { ok: true };
    }
    if (action === 'team.create') {
      const teamId = id(), invite = secret();
      const sport = choice<Sport>(p.sport, ['padel','football7','basket3x3','tennis'], 'Deporte');
      await db.query('INSERT INTO rondiqo.teams(id,name,sport,captain_id,invite_hash) VALUES($1,$2,$3,$4,$5)', [teamId, text(p.name, 'Equipo', 2, 60), sport, actor.id, hash(invite)]);
      await db.query('INSERT INTO rondiqo.team_members(team_id,user_id) VALUES($1,$2)', [teamId, actor.id]);
      await audit(db, actor.id, action, teamId); return { id: teamId, invite };
    }
    if (action === 'team.invite') {
      const t = await one(db, 'SELECT * FROM rondiqo.teams WHERE id=$1', [p.team_id]);
      ensure(t?.captain_id === actor.id, 'FORBIDDEN', 'Solo el capitán puede renovar la invitación.', 403);
      const invite = secret();
      await db.query('UPDATE rondiqo.teams SET invite_hash=$1 WHERE id=$2', [hash(invite), p.team_id]);
      return { invite };
    }
    if (action === 'team.join') {
      const t = await one(db, 'SELECT * FROM rondiqo.teams WHERE invite_hash=$1', [hash(text(p.invite, 'Invitación', 40, 50))]);
      ensure(t, 'INVITE', 'Invitación no válida.', 404);
      if(await one(db,'SELECT user_id FROM rondiqo.team_members WHERE team_id=$1 AND user_id=$2',[t.id,actor.id]))return {id:t.id};
      const active = await one(db, "SELECT r.id FROM rondiqo.registrations r JOIN rondiqo.competitions c ON c.id=r.competition_id WHERE r.team_id=$1 AND r.status IN ('pending','confirmed','waitlisted','refund_pending') AND c.status NOT IN ('completed','cancelled')", [t.id]);
      ensure(!active, 'ROSTER_LOCKED', 'La plantilla está cerrada mientras el equipo tiene inscripciones activas.', 409);
      const count = Number((await one(db, 'SELECT count(*) n FROM rondiqo.team_members WHERE team_id=$1', [t.id]))?.n);
      ensure(count < (t.sport==='padel'?2:20), 'ROSTER', t.sport==='padel'?'La pareja ya tiene dos jugadores.':'La plantilla está completa.', 409);
      await db.query('INSERT INTO rondiqo.team_members(team_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [t.id, actor.id]);
      await audit(db, actor.id, action, t.id); return { id: t.id };
    }
    if (action === 'team.leave') {
      const t = await one(db, 'SELECT * FROM rondiqo.teams WHERE id=$1', [p.team_id]);
      ensure(t && t.captain_id !== actor.id, 'CAPTAIN', 'El capitán conserva la responsabilidad del equipo.');
      const active = await one(db, "SELECT r.id FROM rondiqo.registrations r JOIN rondiqo.competitions c ON c.id=r.competition_id WHERE r.team_id=$1 AND r.status IN ('pending','confirmed','waitlisted','refund_pending') AND c.status NOT IN ('completed','cancelled')", [t.id]);
      ensure(!active, 'ROSTER_LOCKED', 'La plantilla tiene inscripciones activas.', 409);
      await db.query('DELETE FROM rondiqo.team_members WHERE team_id=$1 AND user_id=$2', [p.team_id, actor.id]); return { ok: true };
    }
    if (['team.update','team.remove','team.captain'].includes(action)) {
      const team=await one(db,'SELECT * FROM rondiqo.teams WHERE id=$1 FOR UPDATE',[p.team_id]);
      ensure(team?.captain_id===actor.id,'FORBIDDEN','Solo el capitán puede gestionar este equipo.',403);
      const active=await one(db,"SELECT r.id FROM rondiqo.registrations r JOIN rondiqo.competitions c ON c.id=r.competition_id WHERE r.team_id=$1 AND r.status IN ('pending','confirmed','waitlisted','refund_pending') AND c.status NOT IN ('completed','cancelled')",[team.id]);
      ensure(!active,'ROSTER_LOCKED','Cancela o finaliza las inscripciones activas antes de cambiar el equipo.',409);
      if(action==='team.update')await db.query('UPDATE rondiqo.teams SET name=$1 WHERE id=$2',[text(p.name,'Nombre del equipo',2,60),team.id]);
      else {
        ensure(p.user_id!==actor.id,'CAPTAIN','Elige a otro jugador del equipo.');
        ensure(await one(db,'SELECT m.user_id FROM rondiqo.team_members m JOIN rondiqo.profiles p ON p.id=m.user_id WHERE m.team_id=$1 AND m.user_id=$2 AND NOT p.suspended',[team.id,p.user_id]),'MEMBER','Elige a un jugador activo de este equipo.',404);
        if(action==='team.remove')await db.query('DELETE FROM rondiqo.team_members WHERE team_id=$1 AND user_id=$2',[team.id,p.user_id]);
        else await db.query('UPDATE rondiqo.teams SET captain_id=$1 WHERE id=$2',[p.user_id,team.id]);
        // An old invitation cannot re-add a removed player or outlive a change of captain.
        await db.query('UPDATE rondiqo.teams SET invite_hash=$1 WHERE id=$2',[hash(secret()),team.id]);
      }
      await audit(db,actor.id,action,team.id,{user_id:p.user_id||null});return {ok:true};
    }
    if (action === 'organization.create') {
      const orgId = id();
      await db.query('INSERT INTO rondiqo.organizations(id,name,owner_id,city) VALUES($1,$2,$3,$4)', [orgId, text(p.name,'Organización',2,80), actor.id, text(p.city || 'Sevilla','Ciudad',2,60)]);
      await db.query("INSERT INTO rondiqo.org_members(org_id,user_id,role) VALUES($1,$2,'owner')", [orgId, actor.id]);
      await audit(db, actor.id, action, orgId); return { id: orgId, verified: false };
    }
    if (action === 'organization.member') {
      await requireOrg(db, actor, p.org_id, ['owner']);
      const target = await one(db, 'SELECT * FROM rondiqo.profiles WHERE lower(email)=lower($1)', [text(p.email,'Email',3,254)]);
      ensure(target && !target.suspended, 'USER', 'La persona debe tener una cuenta activa.', 404);
      const o = await one(db, 'SELECT owner_id FROM rondiqo.organizations WHERE id=$1', [p.org_id]);
      ensure(target.id !== o?.owner_id, 'OWNER', 'No se puede modificar al propietario.');
      if (p.role === 'remove') await db.query('DELETE FROM rondiqo.org_members WHERE org_id=$1 AND user_id=$2', [p.org_id,target.id]);
      else {
        const role = choice(p.role, ['manager','referee','checkin'], 'Permiso');
        await db.query('INSERT INTO rondiqo.org_members(org_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(org_id,user_id) DO UPDATE SET role=excluded.role', [p.org_id,target.id,role]);
      }
      await audit(db,actor.id,action,p.org_id,{ target:target.id,role:p.role }); return { ok:true };
    }
    if (action === 'admin.verify') {
      ensure(actor.role === 'admin','FORBIDDEN','Solo administración puede verificar organizadores.',403);
      const updated = await db.query('UPDATE rondiqo.organizations SET verified=$1 WHERE id=$2 RETURNING id',[p.verified === true,p.org_id]);
      ensure(updated.rows.length, 'NOT_FOUND','Organizador no encontrado.',404);
      await audit(db,actor.id,action,p.org_id,{verified:p.verified===true}); return { ok:true };
    }
    if (action === 'admin.suspend') {
      ensure(actor.role === 'admin' && p.user_id !== actor.id, 'FORBIDDEN','Acción no permitida.',403);
      ensure(p.suspended===true||!await one(db,"SELECT user_id FROM rondiqo.deletion_requests WHERE user_id=$1 AND status='pending'",[p.user_id]),'DELETION_PENDING','La cuenta ha solicitado su eliminación y no puede reactivarse.',409);
      await db.query('UPDATE rondiqo.profiles SET suspended=$1 WHERE id=$2',[p.suspended===true,p.user_id]);
      await db.query('DELETE FROM rondiqo.sessions WHERE user_id=$1',[p.user_id]);
      await audit(db,actor.id,action,p.user_id,{suspended:p.suspended===true}); return { ok:true };
    }
    if (action === 'competition.create' || action === 'competition.update' || action === 'challenge.create') {
      let orgId = p.org_id;
      const existing=action==='competition.update'?await one(db,'SELECT * FROM rondiqo.competitions WHERE id=$1 FOR UPDATE',[p.competition_id]):null;
      if(action==='competition.update'){
        ensure(existing,'NOT_FOUND','Competición no encontrada.',404);
        await requireOrg(db,actor,existing.org_id);
        ensure(existing.status==='draft','STATE','Solo se pueden editar los datos de un borrador.',409);
        ensure(existing.version===p.version,'CONFLICT','El borrador ha cambiado. Vuelve a abrirlo antes de guardar.',409);
        ensure(p.org_id===existing.org_id,'ORGANIZATION','No se puede cambiar la organización del borrador.',409);
        orgId=existing.org_id;
      }
      if (action === 'challenge.create') {
        orgId = (await one(db,'SELECT id FROM rondiqo.organizations WHERE owner_id=$1 ORDER BY created_at LIMIT 1',[actor.id]))?.id;
        if (!orgId) orgId = (await this.command(db,actor,'organization.create',{name:`Desafíos de ${actor.name}`,city:p.city || 'Sevilla'})).id;
      }
      await requireOrg(db,actor,orgId);
      const sport = choice<Sport>(p.sport,['padel','football7','basket3x3','tennis'],'Deporte');
      const format = action === 'challenge.create' ? 'challenge' : choice<Format>(p.format,['knockout','league','challenge'],'Formato');
      const entry = choice(p.entry_mode,['team','individual'],'Inscripción');
      ensure((sport !== 'padel' && sport !== 'football7' && sport !== 'basket3x3') || entry === 'team','ROSTER','Este deporte requiere una pareja o equipo.');
      const starts = isoDate(p.starts_at), closes = isoDate(p.registration_closes_at);
      ensure(Date.parse(closes) > Date.now() && Date.parse(closes) <= Date.parse(starts),'DATE','El cierre debe ser futuro y anterior o igual al inicio.');
      const capacity = format === 'challenge' ? 2 : integer(p.capacity,'Plazas',2,128);
      ensure(format !== 'league' || capacity <= 32,'CAPACITY','Las ligas admiten hasta 32 participantes.');
      const price = action === 'challenge.create' ? 0 : integer(p.price_cents,'Precio en céntimos',0,100000);
      ensure(price === 0 || price >= 50,'PRICE','Las inscripciones de pago empiezan en 0,50 €.');
      const minRoster = entry === 'individual' ? 1 : sport === 'padel' ? 2 : sport === 'football7' ? 7 : sport === 'basket3x3' ? 3 : 2;
      const compId = existing?.id || id();
      const values=[compId,orgId,text(p.title,'Título',4,100),sport,format,entry,text(p.city || 'Sevilla','Ciudad',2,60),text(p.venue,'Sede',2,120),starts,closes,capacity,minRoster,price,
          choice(p.level,['beginner','intermediate','advanced','open'],'Nivel'),text(p.description || 'Competición amateur para mayores de 18 años.','Descripción',10,2000),text(p.rules,'Normas y cancelación',20,3000)];
      if(existing)await db.query(`UPDATE rondiqo.competitions SET org_id=$2,title=$3,sport=$4,format=$5,entry_mode=$6,city=$7,venue=$8,starts_at=$9,registration_closes_at=$10,capacity=$11,min_roster=$12,price_cents=$13,level=$14,description=$15,rules=$16,version=version+1 WHERE id=$1`,values);
      else await db.query(`INSERT INTO rondiqo.competitions(id,org_id,title,sport,format,entry_mode,city,venue,starts_at,registration_closes_at,capacity,min_roster,price_cents,level,description,rules)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        values);
      await audit(db,actor.id,action,compId); return { id:compId };
    }
    if (action === 'competition.publish') {
      const c = await getCompetition(db,p.competition_id); await requireOrg(db,actor,c.org_id);
      ensure(c.status === 'draft','STATE','Solo se publican borradores.',409);
      ensure(c.verified || (c.format === 'challenge' && c.price_cents === 0),'UNVERIFIED','Un administrador debe verificar al organizador antes de publicar.',409);
      ensure(Date.parse(c.registration_closes_at) > Date.now(),'DATE','El plazo de inscripción ya ha cerrado.');
      if (c.price_cents && this.paymentMode !== 'simulated') ensure(c.stripe_account,'PAYMENTS','Falta conectar la cuenta de cobros del organizador.',409);
      await db.query("UPDATE rondiqo.competitions SET status='open',version=version+1 WHERE id=$1",[c.id]);
      await audit(db,actor.id,action,c.id); return { ok:true };
    }
    if (action === 'registration.create') return this.register(db,actor,p);
    if (action === 'registration.claim') {
      const r = await getRegistration(db,p.registration_id), c = await getCompetition(db,r.competition_id);
      ensure(r.user_id === actor.id && r.status === 'waitlisted','FORBIDDEN','No puedes reclamar esta plaza.',403);
      ensure(c.status === 'open' && Date.parse(c.registration_closes_at)>Date.now(),'CLOSED','Inscripción cerrada.',409);
      ensure(await slots(db,c.id)<c.capacity,'FULL','Todavía no hay plazas.',409);
      await db.query("UPDATE rondiqo.registrations SET status=$1,expires_at=now()+interval '35 minutes' WHERE id=$2",[r.amount_cents ? 'pending':'confirmed',r.id]);
      await audit(db,actor.id,action,r.id); return { id:r.id,status:r.amount_cents ? 'pending':'confirmed' };
    }
    if (action === 'payment.simulate') {
      ensure(this.paymentMode === 'simulated','DISABLED','Los pagos simulados están desactivados.',403);
      const r = await getRegistration(db,p.registration_id), c = await getCompetition(db,r.competition_id);
      ensure(r.user_id === actor.id,'FORBIDDEN','Esta inscripción no es tuya.',403);
      ensure(r.provider === 'simulated','PAYMENT','Proveedor incorrecto.');
      if (r.status === 'confirmed') return {ok:true,simulated:true};
      ensure(r.status === 'pending' && c.status === 'open','STATE','La reserva ya no admite pago.',409);
      await db.query("UPDATE rondiqo.registrations SET status='confirmed' WHERE id=$1",[r.id]);
      await audit(db,actor.id,action,r.id,{amount:r.amount_cents,simulated:true});
      await notifyTeam(db,r,'Inscripción confirmada (simulación)',`Tu plaza en ${c.title} está confirmada. No se ha cobrado dinero.`);
      return {ok:true,simulated:true};
    }
    if (action === 'registration.cancel') {
      const r = await getRegistration(db,p.registration_id), c = await getCompetition(db,r.competition_id);
      ensure(r.user_id === actor.id || await orgPermission(db,actor,c.org_id),'FORBIDDEN','No puedes cancelar esta inscripción.',403);
      ensure(c.status === 'open' || c.status === 'draft','STARTED','La competición ya ha comenzado. Contacta con organización.',409);
      if (['cancelled','refunded','refund_pending','expired'].includes(r.status)) return {ok:true};
      await this.cancelRegistration(db,r,text(p.reason || 'Cancelación solicitada','Motivo',3,300));
      await audit(db,actor.id,action,r.id);
      await notifyTeam(db,r,'Inscripción cancelada',`${c.title}: consulta el estado de la inscripción y, si procede, del reembolso.`);
      const waiters = (await db.query("SELECT user_id FROM rondiqo.registrations WHERE competition_id=$1 AND status='waitlisted'",[c.id])).rows;
      for(const w of waiters) await notify(db,w.user_id,'Plaza liberada',`Revisa ${c.title} y reclama tu plaza. La confirmación depende de la disponibilidad.`);
      return {ok:true};
    }
    if (action === 'competition.cancel') {
      const c = await getCompetition(db,p.competition_id); await requireOrg(db,actor,c.org_id);
      ensure(c.status !== 'completed','STATE','Una competición completada no puede cancelarse.',409);
      if(c.status === 'cancelled') return {ok:true};
      const reason=text(p.reason,'Motivo',5,300);
      const regs=(await db.query("SELECT * FROM rondiqo.registrations WHERE competition_id=$1 AND status IN ('confirmed','pending','waitlisted')",[c.id])).rows;
      for(const r of regs){await this.cancelRegistration(db,r,reason);await notifyTeam(db,r,'Competición cancelada',`${c.title}: ${reason}`);}
      await db.query("UPDATE rondiqo.competitions SET status='cancelled',version=version+1 WHERE id=$1",[c.id]);
      await audit(db,actor.id,action,c.id,{reason});return {ok:true};
    }
    if (action === 'competition.preview' || action === 'competition.start') {
      const c = await getCompetition(db,p.competition_id); await requireOrg(db,actor,c.org_id);
      ensure(c.status === 'open','STATE','La competición no está abierta.',409);
      const pending=await one(db,"SELECT id FROM rondiqo.registrations WHERE competition_id=$1 AND status IN ('pending','refund_pending') LIMIT 1",[c.id]);
      ensure(!pending,'PENDING','Resuelve las reservas y reembolsos pendientes antes de generar el cuadro.',409);
      const regs=(await db.query("SELECT id,roster,display_name FROM rondiqo.registrations WHERE competition_id=$1 AND status='confirmed' ORDER BY created_at,id",[c.id])).rows;
      const pairs=fixtures(regs.map(r=>r.id),c.format),options=scheduleOptions(c,p.schedule||{});
      ensure(Date.parse(options.starts_at)>Date.now(),'DATE','El primer partido debe empezar en el futuro. Cambia su fecha y hora.');
      const busy=(await db.query(`SELECT m.starts_at,m.duration_minutes,m.court,
        coalesce((SELECT jsonb_agg(player) FROM rondiqo.registrations r CROSS JOIN LATERAL jsonb_array_elements_text(r.roster) AS player
          WHERE r.competition_id=m.competition_id AND (r.id=m.home OR r.id=m.away OR (m.home IS NULL OR m.away IS NULL) AND r.status='confirmed')),'[]'::jsonb) players
        FROM rondiqo.matches m JOIN rondiqo.competitions c ON c.id=m.competition_id
        WHERE c.status IN ('running','completed') AND m.status<>'bye' AND m.starts_at IS NOT NULL
        AND m.starts_at > $1::timestamptz-interval '1 day' AND m.starts_at < $1::timestamptz+interval '400 days'
        ORDER BY m.starts_at LIMIT 50001`,[options.starts_at])).rows;
      ensure(busy.length<=50000,'SCHEDULE','Hay demasiados partidos en este período. Contacta con administración para preparar el calendario.');
      const list=planSchedule(pairs,regs,c,options,busy as BusySlot[]);
      const previewToken=hash(JSON.stringify({version:c.version,registrations:regs,options,list}));
      if(action==='competition.preview')return {options,preview_token:previewToken,matches:list.map(m=>({...m,home_name:regs.find(r=>r.id===m.home)?.display_name||'Por decidir',away_name:m.status==='bye'?'Pase directo':regs.find(r=>r.id===m.away)?.display_name||'Por decidir'}))};
      if(p.preview_token)ensure(p.preview_token===previewToken,'SCHEDULE_CHANGED','Las inscripciones o la disponibilidad han cambiado. Revisa el calendario de nuevo.',409);
      for(const match of list)await db.query(`INSERT INTO rondiqo.matches(id,competition_id,round,position,home,away,status,winner,starts_at,court,duration_minutes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[id(),c.id,match.round,match.position,match.home,match.away,match.status,match.winner,match.starts_at,match.court,match.duration_minutes]);
      const firstMatch=list.filter(match=>match.starts_at).map(match=>match.starts_at!).sort()[0];
      await db.query("UPDATE rondiqo.competitions SET status='running',starts_at=$2,registration_closes_at=least(registration_closes_at,now()),version=version+1 WHERE id=$1",[c.id,firstMatch]);
      if(c.format==='knockout')for(const match of (await db.query("SELECT * FROM rondiqo.matches WHERE competition_id=$1 AND status='bye'",[c.id])).rows)await this.advance(db,c,match);
      for(const registration of (await db.query("SELECT user_id,roster FROM rondiqo.registrations WHERE competition_id=$1 AND status='confirmed'",[c.id])).rows)
        await notifyTeam(db,registration,'Calendario disponible',`${c.title}: consulta tus horarios y rivales.`);
      await audit(db,actor.id,action,c.id,{schedule:options});return {ok:true,matches:list.length};
    }
    if (action.startsWith('match.')) return this.matchCommand(db,actor,action,p);
    if (action === 'checkin') {
      const c = await getCompetition(db,p.competition_id); await requireOrg(db,actor,c.org_id,['owner','manager','checkin']);
      ensure(['open','running'].includes(c.status),'STATE','No se admite acceso a esta competición.',409);
      const token=text(p.token,'QR',40,100).replace(/^rondiqo:/,'');
      const r=await one(db,'SELECT * FROM rondiqo.registrations WHERE competition_id=$1 AND qr_token=$2',[c.id,token]);
      ensure(r && r.status==='confirmed','QR_INVALID','QR no válido para esta competición.',404);
      ensure(!r.checked_in_at,'QR_USED','Este QR ya se ha utilizado.',409);
      await db.query('UPDATE rondiqo.registrations SET checked_in_at=now() WHERE id=$1',[r.id]);
      await audit(db,actor.id,action,r.id);return {ok:true,name:r.display_name};
    }
    if(action==='notification.read-all'){await db.query('UPDATE rondiqo.notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL',[actor.id]);return {ok:true};}
    if(action==='notification.read') {
      await db.query('UPDATE rondiqo.notifications SET read_at=now() WHERE id=$1 AND user_id=$2',[p.id,actor.id]);return {ok:true};
    }
    throw new DomainError('ACTION','Acción desconocida.',404);
  }
  async register(db:DB, actor:Actor,p:Row) {
    const c=await getCompetition(db,p.competition_id);
    ensure(c.status==='open' && Date.parse(c.registration_closes_at)>Date.now(),'CLOSED','Las inscripciones están cerradas.',409);
    ensure(p.accept_rules===true && p.terms_version===TERMS_VERSION,'CONSENT','Debes aceptar las normas y la política de cancelación.');
    let roster=[actor.id], teamId=null, displayName=actor.name;
    if(c.entry_mode==='team') {
      const t=await one(db,'SELECT * FROM rondiqo.teams WHERE id=$1',[p.team_id]);
      ensure(t && t.captain_id===actor.id,'CAPTAIN','Solo el capitán puede inscribir a su equipo.',403);
      ensure(t.sport===c.sport,'SPORT','El deporte del equipo no coincide.');
      roster=(await db.query('SELECT tm.user_id FROM rondiqo.team_members tm JOIN rondiqo.profiles p ON p.id=tm.user_id WHERE team_id=$1 AND NOT p.suspended AND p.adult_attested',[t.id])).rows.map(r=>r.user_id);
      ensure(roster.length>=c.min_roster,'ROSTER',`Se necesitan al menos ${c.min_roster} jugadores adultos registrados.`);
      if(c.sport==='padel') ensure(roster.length===2,'ROSTER','Una pareja de pádel debe tener exactamente dos jugadores.');
      teamId=t.id;displayName=t.name;
    }
    const duplicate=await one(db,"SELECT id FROM rondiqo.registrations WHERE competition_id=$1 AND status IN ('pending','confirmed','waitlisted','refund_pending') AND roster ?| $2::text[]",[c.id,roster]);
    ensure(!duplicate,'DUPLICATE','Algún jugador ya está inscrito en esta competición.',409);
    const full=await slots(db,c.id)>=c.capacity;
    const regId=id(),provider=c.price_cents===0?'free':this.paymentMode,status=full?'waitlisted':c.price_cents?'pending':'confirmed';
    await db.query(`INSERT INTO rondiqo.registrations(id,competition_id,user_id,team_id,display_name,roster,status,amount_cents,provider,qr_token,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+interval '35 minutes')`,
      [regId,c.id,actor.id,teamId,displayName,JSON.stringify(roster),status,c.price_cents,provider,secret()]);
    await audit(db,actor.id,'registration.create',regId,{terms:TERMS_VERSION,competition_version:c.version,amount_cents:c.price_cents,status});
    await notifyTeam(db,{user_id:actor.id,roster},status==='waitlisted'?'En lista de espera':'Inscripción recibida',`${c.title}: ${status==='pending'?'completa el pago para confirmar tu plaza':status==='confirmed'?'plaza confirmada':'te avisaremos cuando se libere una plaza'}.`);
    return {id:regId,status,amount_cents:c.price_cents,provider};
  }
  async cancelRegistration(db:DB,r:Row,reason:string) {
    const paid=r.status==='confirmed' && r.amount_cents>0;
    if(paid) {
      const remote=['stripe_test','stripe_live'].includes(r.provider);
      await db.query("UPDATE rondiqo.registrations SET status=$1,qr_token=$2 WHERE id=$3",[remote?'refund_pending':'refunded',secret(),r.id]);
      await db.query('INSERT INTO rondiqo.refunds(id,registration_id,status,reason) VALUES($1,$2,$3,$4) ON CONFLICT(registration_id) DO NOTHING',[id(),r.id,remote?'pending':'completed',reason]);
    } else await db.query("UPDATE rondiqo.registrations SET status='cancelled',qr_token=$1 WHERE id=$2",[secret(),r.id]);
  }
  async matchCommand(db:DB,actor:Actor,action:string,p:Row) {
    const m=await one(db,'SELECT * FROM rondiqo.matches WHERE id=$1',[p.match_id]);
    ensure(m,'NOT_FOUND','Partido no encontrado.',404);
    const c=await getCompetition(db,m.competition_id);
    ensure(c.status==='running','STATE','La competición no está en juego.',409);
    ensure(integer(p.version,'Versión',1,100000)===m.version,'STALE','El partido ha cambiado. Actualiza antes de continuar.',409);
    const staff=await orgPermission(db,actor,c.org_id,['owner','manager','referee']);
    if(action==='match.schedule') {
      await requireOrg(db,actor,c.org_id);
      ensure(['scheduled','proposed','disputed'].includes(m.status),'STATE','El partido ya está cerrado.',409);
      const starts=isoDate(p.starts_at),duration=integer(p.duration_minutes,'Duración',15,240),court=text(p.court,'Pista',2,120);
      ensure(Date.parse(starts)>=Date.now(),'DATE','El horario debe ser futuro.');
      const end=new Date(Date.parse(starts)+duration*60000).toISOString();
      const participants=(await db.query("SELECT roster FROM rondiqo.registrations WHERE id=$1 OR id=$2 OR (competition_id=$3 AND ($1::uuid IS NULL OR $2::uuid IS NULL) AND status='confirmed')",[m.home,m.away,c.id])).rows;
      const conflict=await scheduleConflict(db,starts,duration,court,[...new Set<string>(participants.flatMap(r=>r.roster))],m.id);
      ensure(!conflict,'CONFLICT','Ese horario solapa otra pista o participante.',409);
      if(c.format==='knockout'){
        const dependency=await one(db,`SELECT id FROM rondiqo.matches WHERE competition_id=$1 AND
          ((round=$2-1 AND position IN ($3*2,$3*2+1) AND starts_at+duration_minutes*interval '1 minute'>$4::timestamptz)
          OR (round=$2+1 AND position=floor($3::numeric/2) AND starts_at<$5::timestamptz))`,[c.id,m.round,m.position,starts,end]);
        ensure(!dependency,'DEPENDENCY','El horario debe respetar las rondas anteriores y posteriores.',409);
      }
      await db.query('UPDATE rondiqo.matches SET starts_at=$1,court=$2,duration_minutes=$3,version=version+1 WHERE id=$4',[starts,court,duration,m.id]);
      const regs=(await db.query('SELECT user_id,roster FROM rondiqo.registrations WHERE id=$1 OR id=$2',[m.home,m.away])).rows;
      for(const r of regs) await notifyTeam(db,r,'Cambio de horario',`${c.title}: revisa el nuevo horario del partido.`);
      await audit(db,actor.id,action,m.id,{starts,court,duration});return {ok:true};
    }
    ensure(m.home && m.away,'PARTICIPANTS','Todavía faltan rivales.',409);
    const home=await getRegistration(db,m.home),away=await getRegistration(db,m.away);
    const homeActor=home.user_id===actor.id,awayActor=away.user_id===actor.id;
    if(action==='match.propose') {
      ensure(staff || homeActor || awayActor,'FORBIDDEN','Solo los capitanes o el personal autorizado pueden proponer resultados.',403);
      ensure(m.status==='scheduled','STATE','El marcador ya tiene una propuesta; confirma o abre una incidencia.',409);
      const score=validateScore(c.sport,c.format,p.score);
      await db.query("UPDATE rondiqo.matches SET status='proposed',score=$1,proposed_by=$2,version=version+1 WHERE id=$3",[JSON.stringify(score),actor.id,m.id]);
      await notify(db,homeActor?away.user_id:home.user_id,'Resultado pendiente',`${c.title}: confirma el resultado o señala una incidencia.`);
    } else if(action==='match.dispute') {
      ensure(homeActor || awayActor || staff,'FORBIDDEN','No puedes abrir una incidencia en este partido.',403);
      ensure(m.status==='proposed','STATE','No hay resultado pendiente.',409);
      const reason=text(p.reason,'Incidencia',5,500);
      await db.query("UPDATE rondiqo.matches SET status='disputed',version=version+1 WHERE id=$1",[m.id]);
      await notify(db,c.owner_id,'Resultado en revisión',`${c.title}: ${reason}`);
      await audit(db,actor.id,action,m.id,{reason});return {ok:true};
    } else if(action==='match.confirm' || action==='match.resolve') {
      const opposite=(homeActor && m.proposed_by===away.user_id) || (awayActor && m.proposed_by===home.user_id);
      if(action==='match.resolve') ensure(staff && m.status==='disputed','FORBIDDEN','La organización debe resolver las incidencias.',403);
      else ensure(m.status==='proposed' && (staff || opposite),'FORBIDDEN','Debe confirmar el rival o una persona autorizada de organización.',403);
      const score=action==='match.resolve'?validateScore(c.sport,c.format,p.score):m.score;
      if(action==='match.resolve') text(p.reason,'Motivo de resolución',5,500);
      const win=winner(score,m.home,m.away);
      await db.query("UPDATE rondiqo.matches SET status='confirmed',score=$1,winner=$2,version=version+1 WHERE id=$3",[JSON.stringify(score),win,m.id]);
      if(c.format==='knockout') await this.advance(db,c,{...m,winner:win});
      const remaining=await one(db,"SELECT id FROM rondiqo.matches WHERE competition_id=$1 AND status NOT IN ('confirmed','bye') LIMIT 1",[c.id]);
      if(!remaining) await db.query("UPDATE rondiqo.competitions SET status='completed',version=version+1 WHERE id=$1",[c.id]);
      await notifyUsers(db,[...home.roster,...away.roster],'Resultado confirmado',c.title);
    } else throw new DomainError('ACTION','Acción de partido desconocida.',404);
    await audit(db,actor.id,action,m.id,{score:p.score || m.score,reason:p.reason || null});return {ok:true};
  }
  async advance(db:DB,c:Row,m:Row) {
    const column=m.position%2===0?'home':'away';
    await db.query(`UPDATE rondiqo.matches SET ${column}=$1,version=version+1 WHERE competition_id=$2 AND round=$3 AND position=$4`,[m.winner,c.id,m.round+1,Math.floor(m.position/2)]);
  }
  async snapshot(actor:Actor|null) {
    return this.db.transaction(async db=>{
      await expireLocal(db);
      const uid=actor?.id ?? null,admin=actor?.role==='admin';
      const competitions=(await db.query(`SELECT c.*,o.name organizer,o.verified,
        (SELECT count(*)::int FROM rondiqo.registrations r WHERE r.competition_id=c.id AND r.status IN ('confirmed','pending','refund_pending')) occupied,
        (SELECT count(*)::int FROM rondiqo.registrations r WHERE r.competition_id=c.id AND r.status='confirmed') confirmed_count
        FROM rondiqo.competitions c JOIN rondiqo.organizations o ON c.org_id=o.id
        WHERE c.status<>'draft' OR $2 OR EXISTS(SELECT 1 FROM rondiqo.org_members om WHERE om.org_id=c.org_id AND om.user_id=$1)
        ORDER BY c.starts_at,c.created_at,c.id`,[uid,admin])).rows;
      const mine=uid?(await db.query(`SELECT r.*,c.title,c.sport FROM rondiqo.registrations r JOIN rondiqo.competitions c ON c.id=r.competition_id WHERE r.roster ? $1 ORDER BY r.created_at DESC`,[uid])).rows:[];
      const teams=uid?(await db.query(`SELECT t.id,t.name,t.sport,t.captain_id,
        EXISTS(SELECT 1 FROM rondiqo.registrations r JOIN rondiqo.competitions c ON c.id=r.competition_id WHERE r.team_id=t.id AND r.status IN ('pending','confirmed','waitlisted','refund_pending') AND c.status NOT IN ('completed','cancelled')) roster_locked,
        (SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name)) FROM rondiqo.team_members m JOIN rondiqo.profiles p ON p.id=m.user_id WHERE m.team_id=t.id) members
        FROM rondiqo.teams t WHERE EXISTS(SELECT 1 FROM rondiqo.team_members m WHERE m.team_id=t.id AND m.user_id=$1)`,[uid])).rows:[];
      const organizations=uid?(await db.query(`SELECT o.id,o.name,o.city,o.verified,om.role FROM rondiqo.organizations o LEFT JOIN rondiqo.org_members om ON om.org_id=o.id AND om.user_id=$1 WHERE $2 OR om.user_id=$1`,[uid,admin])).rows:[];
      const notifications=uid?(await db.query('SELECT * FROM rondiqo.notifications WHERE user_id=$1 ORDER BY (read_at IS NULL) DESC,created_at DESC LIMIT 50',[uid])).rows:[];
      const notificationUnread=uid?Number((await one(db,'SELECT count(*) n FROM rondiqo.notifications WHERE user_id=$1 AND read_at IS NULL',[uid]))?.n||0):0;
      const orgMembers=uid?(await db.query(`SELECT m.org_id,m.user_id,m.role,p.name,p.email FROM rondiqo.org_members m JOIN rondiqo.profiles p ON p.id=m.user_id
        WHERE $2 OR EXISTS(SELECT 1 FROM rondiqo.org_members own WHERE own.org_id=m.org_id AND own.user_id=$1 AND own.role='owner')`,[uid,admin])).rows:[];
      const agendaFields=`m.id,m.competition_id,m.round,m.position,m.status,m.starts_at,m.court,m.duration_minutes,
        c.org_id,c.title,c.sport,h.display_name home_name,a.display_name away_name`;
      const agendaJoin=`FROM rondiqo.matches m JOIN rondiqo.competitions c ON c.id=m.competition_id
        LEFT JOIN rondiqo.registrations h ON h.id=m.home LEFT JOIN rondiqo.registrations a ON a.id=m.away`;
      const agenda=uid?(await db.query(`SELECT ${agendaFields} ${agendaJoin}
        WHERE c.status IN ('running','completed') AND m.starts_at IS NOT NULL AND m.status<>'bye'
        AND EXISTS(SELECT 1 FROM rondiqo.registrations r WHERE (r.id=m.home OR r.id=m.away) AND r.status='confirmed' AND r.roster ? $1)
        ORDER BY m.starts_at,m.id`,[uid])).rows:[];
      // Each workspace is scoped on the server; navigation never grants a role.
      const organizer=uid&&organizations.length?{
        agenda:(await db.query(`SELECT ${agendaFields} ${agendaJoin}
          WHERE m.starts_at IS NOT NULL AND m.status<>'bye'
          AND ($2 OR EXISTS(SELECT 1 FROM rondiqo.org_members om WHERE om.org_id=c.org_id AND om.user_id=$1))
          ORDER BY m.starts_at,m.id`,[uid,admin])).rows,
        registrations:(await db.query(`SELECT r.id,r.competition_id,r.display_name,r.status,r.checked_in_at,r.created_at,
          c.org_id,c.title,c.sport,
          CASE WHEN $2 OR om.role IN ('owner','manager') THEN r.amount_cents END amount_cents,
          CASE WHEN $2 OR om.role IN ('owner','manager') THEN r.provider END provider
          FROM rondiqo.registrations r JOIN rondiqo.competitions c ON c.id=r.competition_id
          LEFT JOIN rondiqo.org_members om ON om.org_id=c.org_id AND om.user_id=$1
          WHERE $2 OR om.role IN ('owner','manager','referee','checkin')
          ORDER BY r.created_at DESC,r.id`,[uid,admin])).rows.map(({amount_cents,provider,...r})=>amount_cents===null?r:{...r,amount_cents,provider}),
        metrics:(await db.query(`SELECT o.id org_id,
          count(r.id) FILTER(WHERE r.status='confirmed')::int confirmed,
          count(r.id) FILTER(WHERE r.status='confirmed' AND r.checked_in_at IS NOT NULL)::int checked_in,
          coalesce(sum(r.amount_cents) FILTER(WHERE r.status='confirmed'),0)::int amount_cents
          FROM rondiqo.organizations o
          LEFT JOIN rondiqo.competitions c ON c.org_id=o.id
          LEFT JOIN rondiqo.registrations r ON r.competition_id=c.id
          WHERE $2 OR EXISTS(SELECT 1 FROM rondiqo.org_members om WHERE om.org_id=o.id AND om.user_id=$1 AND om.role IN ('owner','manager'))
          GROUP BY o.id`,[uid,admin])).rows
      }:null;
      const adminData=admin?{
        deletions:(await db.query('SELECT d.*,p.email,p.name FROM rondiqo.deletion_requests d JOIN rondiqo.profiles p ON p.id=d.user_id ORDER BY d.created_at')).rows,
        users:(await db.query('SELECT id,name,email,role,suspended FROM rondiqo.profiles ORDER BY created_at DESC LIMIT 100')).rows,
        audit:(await db.query('SELECT * FROM rondiqo.audit ORDER BY created_at DESC LIMIT 100')).rows,
        refunds:(await db.query('SELECT f.*,r.amount_cents,r.provider FROM rondiqo.refunds f JOIN rondiqo.registrations r ON r.id=f.registration_id')).rows
      }:null;
      return {user:actor,competitions,registrations:mine,teams,organizations,orgMembers,notifications,notificationUnread,agenda,organizer,admin:adminData,paymentMode:this.paymentMode,termsVersion:TERMS_VERSION};
    });
  }
  async detail(compId:string,actor:Actor|null) {
    return this.db.transaction(async db=>{
      const c=await getCompetition(db,compId);
      const manager=actor?await orgPermission(db,actor,c.org_id,['owner','manager','referee','checkin']):false;
      const canManage=actor?await orgPermission(db,actor,c.org_id,['owner','manager']):false;
      const canCheckin=actor?await orgPermission(db,actor,c.org_id,['owner','manager','checkin']):false;
      const canScore=actor?await orgPermission(db,actor,c.org_id,['owner','manager','referee']):false;
      ensure(c.status!=='draft'||manager,'NOT_FOUND','Competición no encontrada.',404);
      const regs=(await db.query('SELECT * FROM rondiqo.registrations WHERE competition_id=$1 ORDER BY created_at,id',[c.id])).rows;
      const matches=(await db.query('SELECT * FROM rondiqo.matches WHERE competition_id=$1 ORDER BY round,position',[c.id])).rows;
      const ranking=standings(regs,matches);
      const entrants=regs.filter(r=>r.status==='confirmed').map(r=>({id:r.id,display_name:r.display_name,status:r.status,checked_in:!!r.checked_in_at}));
      const playerIds=[...new Set<string>(regs.flatMap(r=>r.roster))];
      const profiles=canManage&&playerIds.length?(await db.query('SELECT id,name,email FROM rondiqo.profiles WHERE id=ANY($1::uuid[])',[playerIds])).rows:[];
      const roster:Row[]=manager?regs.map(({qr_token,...r})=>canManage?{...r,contact:profiles.find(p=>p.id===r.user_id),members:r.roster.map((member:string)=>({id:member,name:profiles.find(p=>p.id===member)?.name||'Jugador'}))}:({id:r.id,display_name:r.display_name,status:r.status,checked_in_at:r.checked_in_at})):[];
      // Never expose payment IDs, bearer QR tokens, personal email or roster publicly.
      const {stripe_account,owner_id,...publicCompetition}=c;
      return {competition:publicCompetition,matches:matches.map<Row>(({proposed_by,...m})=>{
        const home=regs.find(r=>r.id===m.home),away=regs.find(r=>r.id===m.away);
        const captain=!!actor&&(home?.user_id===actor.id||away?.user_id===actor.id);
        const opposite=!!actor&&((home?.user_id===actor.id&&away?.user_id===proposed_by)||(away?.user_id===actor.id&&home?.user_id===proposed_by));
        const running=c.status==='running',playing=!!m.home&&!!m.away;
        return {...m,proposed_by:actor&&manager?proposed_by:actor&&proposed_by===actor.id?actor.id:null,
          actions:{schedule:running&&canManage&&['scheduled','proposed','disputed'].includes(m.status),propose:running&&playing&&m.status==='scheduled'&&(canScore||captain),confirm:running&&playing&&m.status==='proposed'&&(canScore||opposite),dispute:running&&playing&&m.status==='proposed'&&(canScore||captain),resolve:running&&playing&&m.status==='disputed'&&canScore}};
      }),entrants,standings:ranking,roster,manager,canManage,canCheckin};
    });
  }
  async exportCalendar(compId:string,actor:Actor|null) {
    const d=await this.detail(compId,actor);
    return calendar(d.competition.title,d.matches,Object.fromEntries(d.entrants.map(r=>[r.id,r.display_name])));
  }
}
