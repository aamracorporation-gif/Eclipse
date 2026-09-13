-- Sistema de crédito unificado con reservas explícitas de Stripe
--
-- wallet_reserves: vincula cada euro de crédito real al PaymentIntent de Stripe que lo respalda.
-- user_credit:     fuente de verdad única del saldo (balance_real + balance_promo).
--
-- balance_real  = ganancias de reventa, respaldado por dinero retenido en Stripe.
-- balance_promo = crédito promocional (regalos, descuentos), no respaldado 1:1.
--
-- Invariante: SUM(wallet_reserves WHERE status='pending') == SUM(user_credit.balance_real)
-- Retirada segura: stripe_balance - SUM(pending reserves) = dinero disponible para el organizador.

-- ── TABLAS ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.wallet_reserves (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount                    numeric(12,4) NOT NULL CHECK (amount > 0),
  stripe_payment_intent_id  text        NOT NULL,
  status                    text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'consumed', 'cancelled')),
  consumed_by_stripe_pi     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wallet_reserves_user_status_created
  ON public.wallet_reserves (user_id, status, created_at);

CREATE TABLE IF NOT EXISTS public.user_credit (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_real  numeric(12,4) NOT NULL DEFAULT 0 CHECK (balance_real >= 0),
  balance_promo numeric(12,4) NOT NULL DEFAULT 0 CHECK (balance_promo >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── MIGRAR DATOS EXISTENTES ──────────────────────────────────────────────────
-- wallets.balance       → balance_real  (ganancias de reventa)
-- creditos_usuario.saldo_credito → balance_promo (créditos promocionales)

INSERT INTO public.user_credit (user_id, balance_real, balance_promo)
SELECT
  COALESCE(w.user_id, c.usuario_id)       AS user_id,
  COALESCE(w.balance, 0)                   AS balance_real,
  COALESCE(c.saldo_credito, 0)             AS balance_promo
FROM      public.wallets           w
FULL OUTER JOIN public.creditos_usuario c ON c.usuario_id = w.user_id
WHERE COALESCE(w.user_id, c.usuario_id) IS NOT NULL
ON CONFLICT (user_id) DO UPDATE
  SET balance_real  = EXCLUDED.balance_real,
      balance_promo = EXCLUDED.balance_promo,
      updated_at    = now();

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.wallet_reserves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_credit     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user sees own reserves" ON public.wallet_reserves;
CREATE POLICY "user sees own reserves" ON public.wallet_reserves
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user sees own credit" ON public.user_credit;
CREATE POLICY "user sees own credit" ON public.user_credit
  FOR SELECT USING (auth.uid() = user_id);

-- service_role necesita acceso completo (funciones SECURITY DEFINER lo usan)
GRANT ALL ON public.wallet_reserves TO service_role;
GRANT ALL ON public.user_credit     TO service_role;
GRANT SELECT ON public.wallet_reserves TO authenticated;
GRANT SELECT ON public.user_credit     TO authenticated;
