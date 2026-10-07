import {notificationInboxLink,isSafeNotificationDestination,parseNotificationClock,notificationClock} from '@/lib/notificationNavigation';
import {normalizeNotificationRow} from '@/lib/notificationSchema';
const id='10000000-0000-4000-8000-000000000001';
describe('notification v2 contracts',()=>{
 test('only matching project and UUID reaches the detail lookup',()=>{
  expect(notificationInboxLink({notification_schema:2,notification_id:id,project_ref:'staging'},'staging')).toBe(`/notifications?notification_id=${id}`);
  expect(notificationInboxLink({notification_schema:2,notification_id:id,project_ref:'production'},'staging')).toBe('/notifications');
 });
 test.each([null,{},'anything',{url:'https://evil.invalid'},{type:'organizer_new_sale',event_id:'bad'},{notification_schema:2,notification_id:'../admin',project_ref:'staging'}])('untrusted push routes only to inbox %p',data=>expect(notificationInboxLink(data,'staging')).toBe('/notifications'));
 test.each(['/notifications','/(tabs)/tickets','/(worker)/','/(creator)/','/(creator)/admin-profile',`/(tabs)/event/${id}`])('known authorized destination %s',url=>expect(isSafeNotificationDestination(url)).toBe(true));
 test.each([null,5,'https://evil.invalid','/(creator)/arbitrary','/(tabs)/event/../admin',`/(tabs)/event/${id}?user_id=other`])('unknown destination rejected %p',url=>expect(isSafeNotificationDestination(url)).toBe(false));
 test('clock permits exact HH:mm only',()=>{expect(parseNotificationClock('00:00')).toBe(0);expect(parseNotificationClock('23:59')).toBe(1439);expect(notificationClock(660)).toBe('11:00');for(const v of ['24:00','11:60','9:30',' 09:30','bad'])expect(parseNotificationClock(v)).toBeNull();});
 test('v2 read state does not use delivery status; archived data retained',()=>{
  const n=normalizeNotificationRow({id,user_id:id,delivery_version:2,status:'read',read:false,title:'Title',body:'Body',message:'Message',type:'order.free_confirmed',role:'attendee',category:'purchase',priority:'normal',archived_at:'2026-10-07T21:00:00Z',expires_at:'2026-10-08T21:00:00Z',data:{schema_version:2},created_at:'2026-10-07T21:00:00Z'});
  expect(n.read).toBe(false);expect(n.archived_at).toBeTruthy();expect(n.delivery_version).toBe(2);
  expect(normalizeNotificationRow({read:true,delivery_version:2}).read).toBe(true);
  expect(normalizeNotificationRow({read_at:'2026-10-07T21:00:00Z',delivery_version:2}).read).toBe(true);
  expect(normalizeNotificationRow(undefined as any).id).toBe('');
 });
});
