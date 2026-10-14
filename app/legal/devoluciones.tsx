import { LegalDocumentScreen } from '@/components/legal/LegalDocumentScreen';
import { organizerBillingVisible } from '@/lib/payments/organizerBilling';

export default function RefundPolicyScreen() {
  return <LegalDocumentScreen title="Cancelaciones y devoluciones" text={organizerBillingVisible
    ? 'Si el organizador cancela un evento, se devolverá el importe íntegro pagado por la compra, incluido el cargo de servicio, al medio de pago original. Las entradas dejarán de ser válidas. La devolución se tramitará independientemente del cobro de los costes al organizador; su reflejo en la cuenta dependerá del banco. Te informaremos de la cancelación y podrás consultar su estado en Eclipse.\n\nSi cambias de opinión y el evento se celebra conforme a lo anunciado, no se ofrecen devoluciones voluntarias. Se respetan siempre los derechos y devoluciones legalmente obligatorios, incluidos los que puedan corresponder por cambios sustanciales.\n\nEl organizador autoriza por separado el cobro posterior de la comisión de Eclipse y los costes reales no recuperados de Stripe asociados a la cancelación. No se exige una fianza inicial. Estos costes no se descuentan de la devolución del comprador. Esta política no limita derechos imperativos del consumidor.'
    : 'La nueva política de cancelaciones todavía no está activa. Contacta con soporte para tramitar una devolución. Se respetan los derechos legalmente obligatorios.'} />;
}
