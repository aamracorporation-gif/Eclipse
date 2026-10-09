import { resolveAuthRedirect } from '@/lib/authRedirect';
describe('authentication redirect destination', () => {
  it('uses the HTTPS backend bridge instead of a development URL', () => {
    expect(resolveAuthRedirect({ apiUrl: 'https://api.example.test/v1/', fallback: 'exp://localhost/auth/callback' }))
      .toBe('https://api.example.test/auth/verify');
  });
  it('honors a dedicated configured redirect', () => {
    expect(resolveAuthRedirect({ explicitUrl: ' https://auth.example.test/verify ', apiUrl: 'https://api.example.test', fallback: 'eclipse://auth/callback' }))
      .toBe('https://auth.example.test/verify');
  });
  it.each(['http://localhost:8081', 'not a URL', ''])('does not use an unsafe backend %s for email links', apiUrl => {
    expect(resolveAuthRedirect({ apiUrl, fallback: 'eclipse://auth/callback' })).toBe('eclipse://auth/callback');
  });
});
