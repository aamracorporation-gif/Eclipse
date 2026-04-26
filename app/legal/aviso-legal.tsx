import { LegalDocumentScreen } from '@/components/legal/LegalDocumentScreen';
import { useTranslation } from 'react-i18next';

export default function AvisoLegalScreen() {
  const { t } = useTranslation();
  return <LegalDocumentScreen title={t('legal.documents.legal_notice.title')} text={t('legal.documents.legal_notice.text')} />;
}
