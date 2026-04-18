import { LegalDocumentScreen } from '@/components/legal/LegalDocumentScreen';
import { terminosText, terminosTitle } from '@/legal/terminos';

export default function TerminosScreen() {
  return <LegalDocumentScreen title={terminosTitle} text={terminosText} />;
}

