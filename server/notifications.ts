import {randomUUID} from 'node:crypto';
import type {DB} from './db.ts';
import type {Row} from '../src/domain/model.ts';

export async function notifyUsers(db:DB,users:string[],title:string,message:string){
 for(const user of new Set(users))await db.query('INSERT INTO rondiqo.notifications(id,user_id,title,message) VALUES($1,$2,$3,$4)',[randomUUID(),user,title,message]);
}
export async function notifyTeam(db:DB,registration:Row,title:string,message:string){
 await notifyUsers(db,Array.isArray(registration.roster)?registration.roster:[registration.user_id],title,message);
}
