import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import type {ScryptOptions} from 'node:crypto';
import { ensure } from '../src/domain/model.ts';
const scrypt=(password:string,salt:string,len:number,options:ScryptOptions={})=>new Promise<Buffer>((resolve,reject)=>scryptCallback(password,salt,len,options,(error,key)=>error?reject(error):resolve(key)));
export const secret = () => randomBytes(32).toString('base64url');
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export async function passwordHash(password: string) {
  ensure(typeof password === 'string' && password.length >= 12 && password.length <= 128, 'PASSWORD', 'La contraseÃ±a debe tener entre 12 y 128 caracteres.');
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64, {N:32768,r:8,p:1,maxmem:64*1024*1024}) as Buffer;
  return `s2:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const parts=stored.split(':'),modern=parts[0]==='s2';
  const [salt,key]=modern?parts.slice(1):parts;
  if(!/^[a-f0-9]{32}$/.test(salt||'')||!/^[a-f0-9]{128}$/.test(key||''))return false;
  const derived = modern?await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024}) as Buffer:await scrypt(password,salt,64) as Buffer;
  const expected = Buffer.from(key, 'hex');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
export class RateLimiter {
  buckets = new Map<string, { count: number; until: number }>();
  allow(key: string, limit = 100, window = 60000, now = Date.now()) {
    if (this.buckets.size >= 10000) for (const [k, b] of this.buckets) if (b.until <= now) this.buckets.delete(k);
    let b = this.buckets.get(key);
    if(!b&&this.buckets.size>=10000)return false;
    if (!b || b.until <= now) { b = { count: 0, until: now + window }; this.buckets.set(key, b); }
    return ++b.count <= limit;
  }
}
