/* global __ENV */
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '2m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
  },
};

export default function () {
  const baseUrl = __ENV.STAGING_API_URL;
  if (!baseUrl) throw new Error('STAGING_API_URL is required');
  const response = http.get(`${baseUrl}/health`);
  check(response, { 'health returns 2xx': (r) => r.status >= 200 && r.status < 300 });
  sleep(1);
}
