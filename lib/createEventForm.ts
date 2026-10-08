import { parsePositiveInt } from './createEventTicketConfig';
export type EventDraft = {
  title: string;
  description: string;
  location: string;
  imageUri: string;
  venuePlanUri: string;
  theme: string;
  dressCode: string;
  ageRestriction: string;
  eventType: string;
  allowResale: boolean;
  dateTime: Date | null;
  endDateTime: Date | null;
  coordinates: { latitude: number; longitude: number } | null;
};

export const EVENT_FORM_STEPS = ['El evento', 'Fecha y lugar', 'Entradas', 'Revisión'];
export function eventStepForField(field: string) {
  if (['dateTime','endDateTime','location','coordinates'].includes(field)) return 1;
  if (field === 'ticketTypes') return 2;
  return 0;
}
export function getEventDraftErrors(draft: EventDraft, isEditing: boolean, minDateTime: Date, offerCount: number) {
    const e: Record<string, string> = {};

    if (!draft.title.trim()) e.title = 'Escribe el nombre del evento.';
    else if (draft.title.length > 100) e.title = 'El título no puede superar 100 caracteres';
    if (!draft.description.trim()) e.description = 'Describe qué encontrará el público en el evento.';
    else if (draft.description.length > 2000) e.description = 'La descripción no puede superar 2.000 caracteres';
    if (!draft.location.trim()) e.location = 'Selecciona la ubicación en el mapa.';
    if (!draft.imageUri.trim()) e.imageUri = 'Selecciona un cartel desde la cámara o la galería.';

    const age = parsePositiveInt(draft.ageRestriction);
    if (age === null || age < 16 || age > 99) e.ageRestriction = 'Introduce una edad entre 16 y 99 años.';

    if (!draft.dateTime || !Number.isFinite(draft.dateTime.getTime())) {
      e.dateTime = 'Selecciona fecha y hora.';
    } else if (!isEditing && draft.dateTime.getTime() < minDateTime.getTime()) {
      e.dateTime = 'Debe ser una fecha/hora futura.';
    } else {
      const maxFutureDate = new Date();
      maxFutureDate.setFullYear(maxFutureDate.getFullYear() + 5);
      if (draft.dateTime.getTime() > maxFutureDate.getTime()) {
        e.dateTime = 'La fecha no puede ser más de 5 años en el futuro';
      }
    }

    if (!draft.endDateTime || !Number.isFinite(draft.endDateTime.getTime())) {
      e.endDateTime = 'Selecciona la fecha y hora de finalización.';
    } else if (draft.dateTime && draft.endDateTime.getTime() <= draft.dateTime.getTime()) {
      e.endDateTime = 'Debe ser posterior a la fecha de inicio.';
    }

    if (!draft.coordinates) e.coordinates = 'Marca la ubicación exacta del evento.';

    if (offerCount === 0) {
      e.ticketTypes = 'Añade al menos una entrada, invitación o mesa al evento.';
    }

    return e;
}
