-- ==============================================================================
-- SISTEMA SEGURO DE GESTIÓN DE ENTRADAS Y CÓDIGOS QR (ANTI-FRAUDE)
-- ==============================================================================

-- 1. MEJORA DE LA TABLA TICKETS
-- Añadimos campos para seguridad, auditoría y estado de validación
ALTER TABLE public.tickets 
ADD COLUMN IF NOT EXISTS qr_token uuid DEFAULT gen_random_uuid(),
ADD COLUMN IF NOT EXISTS validation_status text DEFAULT 'valid' CHECK (validation_status IN ('valid', 'used', 'expired', 'revoked')),
ADD COLUMN IF NOT EXISTS transfer_count int DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_transferred_at timestamptz DEFAULT now(),
ADD COLUMN IF NOT EXISTS security_hash text; -- Hash adicional para validación offline si fuera necesario

-- Crear índice para búsquedas rápidas de QR
CREATE INDEX IF NOT EXISTS idx_tickets_qr_token ON public.tickets(qr_token);

-- 2. TABLA DE AUDITORÍA (LOGS)
-- Registra cada movimiento de la entrada para detectar fraudes
CREATE TABLE IF NOT EXISTS public.ticket_audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid REFERENCES public.tickets(id) ON DELETE CASCADE,
    action text NOT NULL, -- 'created', 'transferred', 'scanned', 'regenerated'
    performed_by uuid REFERENCES auth.users(id),
    timestamp timestamptz DEFAULT now(),
    details jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE public.ticket_audit_logs ENABLE ROW LEVEL SECURITY;

-- Solo los organizadores o el sistema pueden ver logs (por ahora restringido)
DROP POLICY IF EXISTS "Admins view logs" ON public.ticket_audit_logs;
CREATE POLICY "Admins view logs" ON public.ticket_audit_logs FOR SELECT USING (false); 

-- 3. FUNCIÓN: VALIDAR QR (Escaneo)
-- Esta función es la que llama el escáner. Es ATÓMICA.
-- Verifica, invalida y registra en un solo paso.
CREATE OR REPLACE FUNCTION public.validate_ticket_qr(p_qr_token uuid, p_scanned_by uuid)
RETURNS json AS $$
DECLARE
    v_ticket record;
    v_result json;
BEGIN
    -- Buscar el ticket
    SELECT t.*, e.title as event_title, e.event_date, p.full_name as owner_name
    INTO v_ticket
    FROM public.tickets t
    JOIN public.events e ON t.event_id = e.id
    JOIN public.profiles p ON t.user_id = p.id
    WHERE t.qr_token = p_qr_token;

    -- Caso 1: No existe
    IF v_ticket.id IS NULL THEN
        RETURN json_build_object(
            'valid', false, 
            'message', 'Código QR no válido o inexistente.'
        );
    END IF;

    -- Caso 2: Ya fue usado
    IF v_ticket.validation_status = 'used' THEN
        RETURN json_build_object(
            'valid', false, 
            'message', 'ALERTA: Esta entrada YA FUE UTILIZADA.',
            'ticket', json_build_object(
                'event', v_ticket.event_title,
                'owner', v_ticket.owner_name,
                'scanned_at', (SELECT timestamp FROM public.ticket_audit_logs WHERE ticket_id = v_ticket.id AND action = 'scanned' ORDER BY timestamp DESC LIMIT 1)
            )
        );
    END IF;

    -- Caso 3: Estado no válido (expirado/revocado)
    IF v_ticket.validation_status != 'valid' THEN
        RETURN json_build_object(
            'valid', false, 
            'message', 'Entrada no válida (Estado: ' || v_ticket.validation_status || ')'
        );
    END IF;

    -- Caso 4: ÉXITO - Marcar como usada
    UPDATE public.tickets 
    SET validation_status = 'used' 
    WHERE id = v_ticket.id;

    -- Registrar auditoría
    INSERT INTO public.ticket_audit_logs (ticket_id, action, performed_by, details)
    VALUES (v_ticket.id, 'scanned', p_scanned_by, json_build_object('status', 'success'));

    RETURN json_build_object(
        'valid', true,
        'message', 'Entrada Válida. Acceso Autorizado.',
        'ticket', json_build_object(
            'id', v_ticket.id,
            'event', v_ticket.event_title,
            'date', v_ticket.event_date,
            'owner', v_ticket.owner_name,
            'type', 'General' -- Placeholder
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
