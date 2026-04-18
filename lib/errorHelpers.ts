import i18n from '@/lib/i18n';

export const getErrorMessage = (error: any): string => {
  if (!error) return i18n.t('errors.generic');

  const message = error.message || error.toString();

  // Mapeo de errores comunes de Supabase/Auth a español amigable
  if (message.includes('Invalid login credentials')) {
    return i18n.t('errors.invalid_credentials');
  }
  if (message.includes('User already registered') || message.includes('User already exists')) {
    return i18n.t('errors.email_exists');
  }
  if (message.includes('Password should be at least')) {
    return i18n.t('errors.password_short');
  }
  if (message.includes('Unable to validate email address: invalid format')) {
    return i18n.t('errors.email_format');
  }
  if (message.includes('Email not confirmed')) {
    return i18n.t('errors.email_unconfirmed');
  }
  if (message.includes('rate limit exceeded')) {
    return i18n.t('errors.rate_limit');
  }
  if (message.includes('Network request failed') || message.includes('fetch failed')) {
    return i18n.t('errors.network');
  }
  if (message.includes('Auth session missing')) {
    return i18n.t('errors.session_expired');
  }
  if (message.includes('Invalid JWT')) {
    return i18n.t('errors.invalid_jwt');
  }
  
  // Errores de base de datos
  if (message.includes('duplicate key value violates unique constraint')) {
    return i18n.t('errors.duplicate');
  }
  if (message.includes('violates foreign key constraint')) {
    return i18n.t('errors.foreign_key');
  }

  // Filtrar información técnica
  const lower = String(message || '').toLowerCase();
  const looksTechnical =
    lower.includes('edge function') ||
    lower.includes('sql') ||
    lower.includes('stack') ||
    lower.includes('trace') ||
    lower.includes('undefined') ||
    lower.includes('exception') ||
    lower.includes('http') ||
    lower.includes('jwt') ||
    lower.includes('token') ||
    lower.includes('supabase') ||
    lower.includes('stripe') ||
    lower.includes('deno') ||
    lower.length > 180;

  if (looksTechnical) return i18n.t('errors.generic');
  return String(message);
};
