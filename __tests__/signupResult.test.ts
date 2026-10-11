import { signupResultError } from '../lib/signupResult';

describe('signup result handling', () => {
  it('does not advance for an obfuscated existing account', () => {
    expect(signupResultError({ user: { id: 'obfuscated', identities: [] }, session: null })?.code).toBe('SIGNUP_NOT_CREATED');
  });
  it.each([null, {}, { user: null }, { user: {} }])('fails closed for incomplete response %j', (data) => {
    expect(signupResultError(data)?.code).toBe('SIGNUP_NOT_CREATED');
  });
  it('allows a new account awaiting email confirmation', () => {
    expect(signupResultError({ user: { id: 'new', identities: [{}] }, session: null })).toBeNull();
  });
  it('allows a real authenticated signup', () => {
    expect(signupResultError({ user: { id: 'new', identities: [{}] }, session: { access_token: 'test' } })).toBeNull();
  });
});
