import { eventShareUrl, eventReturnPath } from '../lib/eventLinks';

describe('public event links', () => {
  it('uses the branded event route for guests and token service failures', () => {
    expect(eventShareUrl('event-id')).toBe('https://api.weareeclipseoficial.com/event/event-id');
  });
  it('keeps the event identity without an environment-specific token lookup', () => {
    expect(eventShareUrl('event/?')).toBe('https://api.weareeclipseoficial.com/event/event%2F%3F');
  });
  it('returns to the event after login', () => {
    expect(eventReturnPath('/(tabs)/event/4b136b46-e057-4619-b0d1-8f159c32ae0e'))
      .toBe('/(tabs)/event/4b136b46-e057-4619-b0d1-8f159c32ae0e');
  });
  it.each(['https://attacker.example', '//attacker.example', '/(creator)', '/(tabs)/event/../profile', ['/event/id'], undefined])(
    'rejects unsafe or unrelated return destinations: %s', value => {
      expect(eventReturnPath(value)).toBeNull();
    },
  );
});
