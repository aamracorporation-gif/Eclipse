INSERT INTO public.notification_templates (key, title_template, body_template, default_priority, default_channels, dedupe_seconds, enabled)
VALUES
  ('purchase_completed', '🎉 ¡Compra completada!', '¡Listo! Tu compra para "{{event_title}}" se confirmó. Añade el evento al calendario: {{calendar_url}}', 'high', ARRAY['in_app','push','email']::text[], 60, true),
  ('event_updated', '🔁 Cambios en el evento', 'Hubo cambios en "{{event_title}}". Revisa los nuevos detalles antes de ir.', 'high', ARRAY['in_app','push','email','sms']::text[], 60, true),
  ('event_time_changed', '⏰ Cambio de fecha u hora', '"{{event_title}}" cambió de fecha/hora. Revisa y confirma tu asistencia.', 'high', ARRAY['in_app','push','email','sms']::text[], 0, true),
  ('event_location_changed', '📍 Cambio de ubicación', '"{{event_title}}" cambió de ubicación. Abre el mapa para llegar sin problemas.', 'high', ARRAY['in_app','push','email','sms']::text[], 0, true),
  ('event_cancelled', '❌ Evento cancelado', '"{{event_title}}" ha sido cancelado. Recibirás información del reembolso.', 'high', ARRAY['in_app','push','email','sms']::text[], 0, true),
  ('event_reminder_24h', '🌙 Mañana es tu noche', 'Mañana es "{{event_title}}". Ten tu QR listo.', 'high', ARRAY['in_app','push']::text[], 3600, true),
  ('event_reminder_1h', '⏳ Falta 1 hora', 'En 1 hora empieza "{{event_title}}". Ten tu QR listo.', 'high', ARRAY['in_app','push']::text[], 1800, true),
  ('ticket_cancelled_or_refunded', '❗Entrada cancelada', 'Tu entrada para "{{event_title}}" ha sido cancelada. {{reason}}', 'high', ARRAY['in_app','push','email','sms']::text[], 0, true),
  ('waitlist_ticket_available', '🎟️ Entrada disponible', 'Hay una entrada disponible para "{{event_title}}". Tienes hasta {{expires_at}} para comprar.', 'high', ARRAY['in_app','push','email']::text[], 0, true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.notification_template_translations (key, language, title_template, body_template)
VALUES
  ('purchase_completed', 'en', '🎟️ Purchase confirmed', 'Your purchase for "{{event_title}}" is confirmed. Add to calendar: {{calendar_url}}'),
  ('purchase_completed', 'fr', '🎟️ Achat confirmé', 'Votre achat pour "{{event_title}}" est confirmé. Ajouter au calendrier : {{calendar_url}}'),

  ('event_updated', 'en', '🔁 Event updated', '"{{event_title}}" has been updated. Please review the latest details.'),
  ('event_updated', 'fr', '🔁 Événement mis à jour', '"{{event_title}}" a été mis à jour. Vérifiez les nouveaux détails.'),

  ('event_time_changed', 'en', '⏰ Date/time changed', '"{{event_title}}" changed date/time. Please review and confirm your attendance.'),
  ('event_time_changed', 'fr', '⏰ Date/heure modifiée', '"{{event_title}}" a changé de date/heure. Merci de vérifier et confirmer.'),

  ('event_location_changed', 'en', '📍 Location changed', '"{{event_title}}" changed location. Open the map to get there.'),
  ('event_location_changed', 'fr', '📍 Lieu modifié', '"{{event_title}}" a changé de lieu. Ouvrez la carte pour y aller.'),

  ('event_cancelled', 'en', '❌ Event cancelled', '"{{event_title}}" has been cancelled. Refund info will follow if applicable.'),
  ('event_cancelled', 'fr', '❌ Événement annulé', '"{{event_title}}" a été annulé. Les infos de remboursement suivront si applicable.'),

  ('event_reminder_24h', 'en', '🌙 Your event is tomorrow', '"{{event_title}}" is tomorrow. Keep your QR ready.'),
  ('event_reminder_24h', 'fr', '🌙 Votre événement est demain', '"{{event_title}}" est demain. Gardez votre QR prêt.'),

  ('event_reminder_1h', 'en', '⏳ 1 hour to go', '"{{event_title}}" starts in 1 hour. Keep your QR ready.'),
  ('event_reminder_1h', 'fr', '⏳ Plus qu’1 heure', '"{{event_title}}" commence dans 1 heure. Gardez votre QR prêt.'),

  ('ticket_cancelled_or_refunded', 'en', '❗Ticket cancelled', 'Your ticket for "{{event_title}}" was cancelled. {{reason}}'),
  ('ticket_cancelled_or_refunded', 'fr', '❗Billet annulé', 'Votre billet pour "{{event_title}}" a été annulé. {{reason}}'),

  ('waitlist_ticket_available', 'en', '🎟️ Ticket available', 'A ticket is available for "{{event_title}}". You have until {{expires_at}} to buy.'),
  ('waitlist_ticket_available', 'fr', '🎟️ Billet disponible', 'Un billet est disponible pour "{{event_title}}". Vous avez jusqu’à {{expires_at}} pour acheter.')
ON CONFLICT (key, language) DO UPDATE
SET
  title_template = EXCLUDED.title_template,
  body_template = EXCLUDED.body_template,
  updated_at = now();

NOTIFY pgrst, 'reload schema';
