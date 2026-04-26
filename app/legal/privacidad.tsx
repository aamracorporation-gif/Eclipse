import { LegalDocumentScreen } from '@/components/legal/LegalDocumentScreen';
import { useTranslation } from 'react-i18next';

export default function PrivacidadScreen() {
  const { t } = useTranslation();
  return <LegalDocumentScreen title={t('legal.documents.privacy.title')} text={t('legal.documents.privacy.text')} />;
}
