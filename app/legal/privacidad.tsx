import { LegalDocumentScreen } from '@/components/legal/LegalDocumentScreen';
import { privacidadText, privacidadTitle } from '@/legal/privacidad';

export default function PrivacidadScreen() {
  return <LegalDocumentScreen title={privacidadTitle} text={privacidadText} />;
}

