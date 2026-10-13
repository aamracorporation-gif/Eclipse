type SignupData = {
  user?: { id?: string; identities?: unknown[] } | null;
  session?: { access_token?: string; user?: { id?: string } } | null;
} | null;

export function normalizeSignupEmail(email: string) {
  return email.trim().toLowerCase();
}

/** Only an explicit new identity or a matching authenticated session is success. */
export function signupResultError(data: SignupData) {
  if (data?.user?.id && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return {
      code: 'EMAIL_ALREADY_REGISTERED',
      message: 'Este correo ya está registrado. Inicia sesión o recupera tu contraseña.',
    };
  }
  const hasIdentity = Array.isArray(data?.user?.identities) && data.user.identities.length > 0;
  const hasSession = !!data?.session?.access_token && data.session.user?.id === data?.user?.id;
  if (!data?.user?.id || (!hasIdentity && !hasSession)) {
    return {
      code: 'SIGNUP_NOT_CREATED',
      message: 'No se ha podido confirmar el registro. Inténtalo de nuevo o recupera tu contraseña si ya tienes cuenta.',
    };
  }
  return null;
}
