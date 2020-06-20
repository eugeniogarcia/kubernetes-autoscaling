import { check, sleep } from 'k6';
import http from "k6/http";

export let options = {
  duration: "1m",
  vus: 200,
  thresholds: {
    http_req_duration: ["p(95)<700"]
  }
};
	
export default function () {
  let r = http.get(`${__ENV.ENDPOINT}`);
  check(r, {
    'status is 200': r => r.status === 200,
  });
  sleep(3);
}