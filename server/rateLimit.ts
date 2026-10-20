import type {DB} from './db.ts';
import {hash} from './security.ts';
// Shared by every server instance; stores hashes rather than IP addresses.
export class DatabaseRateLimiter{
 constructor(privateDb:DB){this.db=privateDb;}db:DB;
 async allow(key:string,limit=100,window=60000,now=Date.now()){
  const bucket=hash(key),start=Math.floor(now/window)*window;
  const result=await this.db.query(`INSERT INTO rondiqo.rate_limits(bucket,window_start,count,expires_at)
   VALUES($1,$2,1,$3) ON CONFLICT(bucket,window_start) DO UPDATE SET count=rondiqo.rate_limits.count+1
   RETURNING count`,[bucket,new Date(start).toISOString(),new Date(start+window*2).toISOString()]);
  return Number(result.rows[0].count)<=limit;
 }
}
