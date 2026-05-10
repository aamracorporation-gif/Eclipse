UPDATE public.notification_templates
SET
  title_template = '🎟️ Compra confirmada',
  body_template = 'Tu entrada para "{{event_title}}" está lista. Ve a "Entradas" para ver el QR y añadir el evento al calendario.',
  default_channels = ARRAY['in_app','push','email']::text[],
  updated_at = now()
WHERE key = 'purchase_completed';

INSERT INTO public.notification_template_translations (key, language, title_template, body_template)
VALUES
  ('purchase_completed', 'en', '🎟️ Purchase confirmed', 'Your ticket for "{{event_title}}" is ready. Open "Tickets" to view the QR and add it to your calendar.'),
  ('purchase_completed', 'fr', '🎟️ Achat confirmé', 'Votre billet pour "{{event_title}}" est prêt. Ouvrez "Billets" pour voir le QR et l’ajouter au calendrier.')
ON CONFLICT (key, language) DO UPDATE
SET
  title_template = EXCLUDED.title_template,
  body_template = EXCLUDED.body_template,
  updated_at = now();

NOTIFY pgrst, 'reload schema';
