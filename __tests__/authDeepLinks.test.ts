import { isPasswordRecovery, parseAuthLinkParams } from '@/lib/authDeepLinks';

describe('Supabase auth deep links', () => {
  it('lee token_hash de un enlace recovery con query params', () => {
    const params = parseAuthLinkParams('eclipse://auth/reset-password?token_hash=abc%2B123&type=recovery');

    expect(params).toEqual({ token_hash: 'abc+123', type: 'recovery' });
    expect(isPasswordRecovery(params)).toBe(true);
  });

  it('lee access y refresh token del fragmento del flujo implícito', () => {
    const params = parseAuthLinkParams(
      'eclipse://auth/callback#access_token=access.jwt&refresh_token=refresh.jwt&type=recovery'
    );

    expect(params.access_token).toBe('access.jwt');
    expect(params.refresh_token).toBe('refresh.jwt');
    expect(isPasswordRecovery(params)).toBe(true);
  });

  it('combina query y fragmento preservando los datos de recuperación', () => {
    const params = parseAuthLinkParams(
      'https://api.example.com/auth/verify?code=pkce-code#type=recovery&refresh_token=refresh%3Dvalue'
    );

    expect(params).toEqual({ code: 'pkce-code', type: 'recovery', refresh_token: 'refresh=value' });
  });

  it('no clasifica una confirmación de registro como recuperación', () => {
    const params = parseAuthLinkParams('eclipse://auth/callback?token_hash=abc&type=signup');
    expect(isPasswordRecovery(params)).toBe(false);
  });
});
