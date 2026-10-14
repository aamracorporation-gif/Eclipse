// Web must not import Stripe's native code-generation modules.
export function useOrganizerStripe() {
  const unavailable = async (_options?: unknown) => ({ error: { code: 'Unavailable', message: 'Completa esta operación desde Eclipse para iOS o Android.' } });
  return { initPaymentSheet: unavailable, presentPaymentSheet: unavailable, handleNextAction: unavailable };
}
