/** Read-only admin diagnostics. Neither provider acceptance nor a heartbeat proves device delivery. */
export type NotificationHealth = {
  checked_at: string; capture_enabled: boolean; operations_enabled: boolean; live_delivery_enabled: boolean;
  allow_all_recipients: boolean; pilot_recipient_count: number; outbox_pending: number; sales_pending: number;
  active_installations: number; oldest_due_seconds: number | null; expired_leases: number; delayed_receipts: number;
  worker: { last_started_at: string | null; last_completed_at: string | null; last_failed_at: string | null;
    last_status: string; push_configured: boolean | null; email_configured: boolean | null };
  by_channel: { channel: string; status: string; total: number }[];
  errors_24h: { code: string | null; total: number }[];
};
export const NOTIFICATION_DELIVERY_LABELS: Record<string, string> = {
  pending: 'Pendientes', processing: 'En preparación', accepted: 'Aceptadas por el servicio de envío',
  confirmed: 'Confirmadas por el proveedor', failed: 'Fallidas', cancelled: 'Suprimidas', expired: 'Caducadas', unknown: 'Resultado desconocido',
};
export function notificationHealthSummary(h: NotificationHealth): { title: string; detail: string } {
  if (!h.capture_enabled) return { title: 'Sistema sin activar', detail: 'No se capturan avisos nuevos. Esto no es una confirmación de entrega.' };
  if (!h.live_delivery_enabled) return { title: 'Envíos externos desactivados', detail: 'La captura y el historial pueden probarse sin enviar mensajes.' };
  if (!h.allow_all_recipients && h.pilot_recipient_count === 0) return { title: 'Faltan destinatarios de prueba', detail: 'Nadie tiene autorizados los envíos del piloto.' };
  if (h.worker.last_status === 'never') return { title: 'Sin ejecución registrada', detail: 'Todavía no se ha comprobado el funcionamiento del proceso de envío.' };
  if (h.worker.last_status === 'disabled') return { title: 'Proceso con envíos desactivados', detail: 'La protección de envío del servidor sigue cerrada.' };
  if (h.worker.last_status === 'failed') return { title: 'Revisar el proceso de envío', detail: 'La última ejecución no terminó correctamente.' };
  const age = Date.parse(h.checked_at) - Date.parse(h.worker.last_completed_at ?? '');
  if (!Number.isFinite(age) || age > 5 * 60_000 || (h.oldest_due_seconds ?? 0) > 300 || h.expired_leases > 0) {
    return { title: 'Revisar planificación y cola', detail: 'No hay una ejecución reciente completada o hay trabajo retrasado.' };
  }
  if (h.delayed_receipts > 0) return { title: 'Recibos pendientes de comprobar', detail: 'La aceptación del envío no demuestra que haya llegado al móvil.' };
  return { title: h.allow_all_recipients ? 'Proceso activo' : 'Piloto restringido', detail: 'Hay ejecución reciente. Confirma la recepción en dispositivos y buzones de prueba.' };
}
