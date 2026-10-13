import { isValidSignupEmail, normalizeSignupEmail, signupResultError } from '../lib/signupResult';

it.each(['  New@Example.COM  ', '\tOwner@example.test\n', 'owner@example.test'])('accepts normalized signup email %j',email=>{
  expect(isValidSignupEmail(email)).toBe(true);
});
it.each(['   ', 'own er@example.test', 'owner@exa mple.test', 'owner@example', 'owner@example.c'])('rejects invalid signup email %j',email=>{
  expect(isValidSignupEmail(email)).toBe(false);
});

describe('signup result handling', () => {
  it('does not advance for an obfuscated existing account', () => {
    expect(signupResultError({ user: { id: 'obfuscated', identities: [] }, session: null })?.code).toBe('EMAIL_ALREADY_REGISTERED');
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


describe('duplicate and incomplete signup responses', () => {
  it('normalizes case and surrounding whitespace', () => {
    expect(normalizeSignupEmail('  Owner@Example.COM  ')).toBe('owner@example.com');
  });
  it.each([undefined, null, {}, { access_token: 'unexpected' }])('rejects empty identities even with session %j', (session) => {
    expect(signupResultError({ user: { id: 'existing', identities: [] }, session })?.code).toBe('EMAIL_ALREADY_REGISTERED');
  });
  it.each([undefined, null, {}, { access_token: 'unexpected', user: { id: 'other' } }])('rejects missing identity without a matching session %j', (session) => {
    expect(signupResultError({ user: { id: 'unknown' }, session })?.code).toBe('SIGNUP_NOT_CREATED');
  });
  it('accepts a matching authenticated session', () => {
    expect(signupResultError({ user: { id: 'new' }, session: { access_token: 'test', user: { id: 'new' } } })).toBeNull();
  });
});
