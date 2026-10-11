type SignupData = {
  user?: { id?: string; identities?: unknown[] } | null;
  session?: unknown;
} | null;

/** An obfuscated duplicate response is not evidence of a newly created account. */
export function signupResultError(data: SignupData) {
  if (!data?.user?.id || (!data.session && Array.isArray(data.user.identities) && data.user.identities.length === 0)) {
    return {
      code: 'SIGNUP_NOT_CREATED',
      message: 'No se ha creado una cuenta nueva. Si ya tienes cuenta, inicia sesión o recupera tu contraseña.',
    };
  }
  return null;
}
