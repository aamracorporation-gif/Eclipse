import { LegalDocumentScreen } from '@/components/legal/LegalDocumentScreen';
import { avisoLegalText, avisoLegalTitle } from '@/legal/avisoLegal';

export default function AvisoLegalScreen() {
  return <LegalDocumentScreen title={avisoLegalTitle} text={avisoLegalText} />;
}

