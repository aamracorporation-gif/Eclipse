-- Cover every production foreign key reported by the Supabase advisor.
-- These indexes keep parent updates/deletes and relation lookups predictable as
-- the corresponding tables grow. The largest table had fewer than 600 rows at
-- rollout, so regular transactional index creation is appropriate here.

CREATE INDEX IF NOT EXISTS idx_fk_admin_audit_logs_admin_id
  ON public.admin_audit_logs (admin_id);
CREATE INDEX IF NOT EXISTS idx_fk_discount_code_uses_discount_code_id
  ON public.discount_code_uses (discount_code_id);
CREATE INDEX IF NOT EXISTS idx_fk_discount_codes_creator_id
  ON public.discount_codes (creator_id);
CREATE INDEX IF NOT EXISTS idx_fk_event_audit_logs_actor_id
  ON public.event_audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_fk_event_checkins_user_id
  ON public.event_checkins (user_id);
CREATE INDEX IF NOT EXISTS idx_fk_event_reports_user_id
  ON public.event_reports (user_id);
CREATE INDEX IF NOT EXISTS idx_fk_event_share_clicks_share_link_id
  ON public.event_share_clicks (share_link_id);
CREATE INDEX IF NOT EXISTS idx_fk_event_share_conversions_share_link_id
  ON public.event_share_conversions (share_link_id);
CREATE INDEX IF NOT EXISTS idx_fk_event_share_conversions_user_id
  ON public.event_share_conversions (user_id);
CREATE INDEX IF NOT EXISTS idx_fk_event_share_links_created_by
  ON public.event_share_links (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_event_waitlist_entries_user_id
  ON public.event_waitlist_entries (user_id);
CREATE INDEX IF NOT EXISTS idx_fk_notification_delivery_events_delivery_id
  ON public.notification_delivery_events (delivery_id);
CREATE INDEX IF NOT EXISTS idx_fk_notification_delivery_events_notification_id
  ON public.notification_delivery_events (notification_id);
CREATE INDEX IF NOT EXISTS idx_fk_organizer_revenue_ledger_event_id
  ON public.organizer_revenue_ledger (event_id);
CREATE INDEX IF NOT EXISTS idx_fk_payment_transactions_user_id
  ON public.payment_transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_fk_profiles_suspended_by
  ON public.profiles (suspended_by);
CREATE INDEX IF NOT EXISTS idx_fk_profiles_verification_reviewed_by
  ON public.profiles (verification_reviewed_by);
CREATE INDEX IF NOT EXISTS idx_fk_qa_sessions_created_by
  ON public.qa_sessions (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_resale_listings_seller_id
  ON public.resale_listings (seller_id);
CREATE INDEX IF NOT EXISTS idx_fk_resale_transactions_listing_id
  ON public.resale_transactions (listing_id);
CREATE INDEX IF NOT EXISTS idx_fk_resale_transactions_payment_transaction_id
  ON public.resale_transactions (payment_transaction_id);
CREATE INDEX IF NOT EXISTS idx_fk_resale_transactions_ticket_id
  ON public.resale_transactions (ticket_id);
CREATE INDEX IF NOT EXISTS idx_fk_ticket_audit_logs_performed_by
  ON public.ticket_audit_logs (performed_by);
CREATE INDEX IF NOT EXISTS idx_fk_ticket_audit_logs_ticket_id
  ON public.ticket_audit_logs (ticket_id);
CREATE INDEX IF NOT EXISTS idx_fk_ticket_cancellations_ticket_id
  ON public.ticket_cancellations (ticket_id);
CREATE INDEX IF NOT EXISTS idx_fk_tickets_payment_transaction_id
  ON public.tickets (payment_transaction_id);
CREATE INDEX IF NOT EXISTS idx_fk_tickets_sold_by_worker_id
  ON public.tickets (sold_by_worker_id);
CREATE INDEX IF NOT EXISTS idx_fk_tickets_ticket_type_id
  ON public.tickets (ticket_type_id);
CREATE INDEX IF NOT EXISTS idx_fk_user_push_tokens_user_id
  ON public.user_push_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_fk_wallet_transactions_wallet_id
  ON public.wallet_transactions (wallet_id);
