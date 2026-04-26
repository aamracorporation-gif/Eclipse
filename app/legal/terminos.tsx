import { LegalDocumentScreen } from '@/components/legal/LegalDocumentScreen';
import { useTranslation } from 'react-i18next';

export default function TerminosScreen() {
  const { t } = useTranslation();
  return <LegalDocumentScreen title={t('legal.documents.terms.title')} text={t('legal.documents.terms.text')} />;
}
