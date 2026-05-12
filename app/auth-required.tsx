import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LogIn } from '@/lib/icons';
import { AuthRequiredScreen } from '@/components/ui/AuthRequiredScreen';

export default function AuthRequiredRoute() {
  const { t } = useTranslation();
  const params = useLocalSearchParams();
  const titleKey = typeof params.titleKey === 'string' ? params.titleKey : 'auth.login';
  const subtitleKey = typeof params.subtitleKey === 'string' ? params.subtitleKey : 'profile.sign_in_prompt';

  return (
    <AuthRequiredScreen
      title={t(titleKey)}
      subtitle={t(subtitleKey)}
      ctaLabel={t('auth.login')}
      Icon={LogIn}
    />
  );
}
