/* global __ENV */
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '1m',
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<750'] },
};

export default function () {
  const url = `${__ENV.SUPABASE_URL}/functions/v1/confirm-payment`;
  const response = http.post(url, JSON.stringify({ payment_intent_id: __ENV.PAYMENT_INTENT_ID }), {
    headers: {
      'Content-Type': 'application/json',
      apikey: __ENV.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${__ENV.QA_USER_JWT}`,
    },
  });
  check(response, { 'status lookup accepted': (r) => [200, 404].includes(r.status) });
  sleep(1);
}
