-- These tables are implementation details used by privileged database
-- functions and service workers. They are not part of the mobile Data API.

REVOKE ALL ON TABLE
  public.event_notifications_log,
  public.notification_delivery_events,
  public.notification_template_translations,
  public.notification_templates,
  public.organizer_balances,
  public.organizer_revenue_ledger,
  public.organizer_stats_cache,
  public.platform_escrow_balances
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.event_notifications_log,
  public.notification_delivery_events,
  public.notification_template_translations,
  public.notification_templates,
  public.organizer_balances,
  public.organizer_revenue_ledger,
  public.organizer_stats_cache,
  public.platform_escrow_balances
TO service_role;
