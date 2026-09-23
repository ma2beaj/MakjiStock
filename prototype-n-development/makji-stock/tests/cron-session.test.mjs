import assert from "node:assert/strict";
import test from "node:test";
import { resolveSession } from "../lib/pricing/daily-job.ts";

/* app/api/internal/daily-pricing 가 쓰는 바로 그 함수를 부른다.
   예전에는 규칙을 여기 복사해 뒀는데, 그러면 라우트가 바뀌어도 통과한다.

   Hobby 크론은 지정 시각이 아니라 그 시간대 안 아무 때나 실행되므로
   현재 시각으로는 오전장/오후장을 구분할 수 없다. 스케줄 헤더로 판별한다. */

test("쿼리 파라미터가 가장 우선한다", () => {
  assert.equal(resolveSession("pm", "0 20 * * *", 5), "pm");
  assert.equal(resolveSession("am", "0 6 * * *", 15), "am");
});

test("크론 스케줄로 장을 구분한다", () => {
  // UTC 20시대 = KST 05시대 → 06:00 오전가 준비
  assert.equal(resolveSession(null, "0 20 * * *", 5), "am");
  // UTC 6시대 = KST 15시대 → 16:00 오후가 준비
  assert.equal(resolveSession(null, "0 6 * * *", 15), "pm");
});

test("스케줄 헤더는 실행 시각보다 우선한다 — Hobby 지터를 견딘다", () => {
  // 05:00 에 걸린 오전 작업이 05:59 에 실행돼도 오전장이다
  assert.equal(resolveSession(null, "0 20 * * *", 5), "am");
  // 15:00 에 걸린 오후 작업이 15:59 에 실행돼도 오후장이다
  assert.equal(resolveSession(null, "0 6 * * *", 15), "pm");
});

test("스케줄이 없으면 KST 시각으로 추정한다", () => {
  assert.equal(resolveSession(null, null, 5), "am");
  assert.equal(resolveSession(null, null, 14), "am");
  assert.equal(resolveSession(null, null, 15), "pm");
  assert.equal(resolveSession(null, null, 23), "pm");
  // 자정~새벽은 다음 오전장을 준비하는 시간이다
  assert.equal(resolveSession(null, null, 0), "am");
});

test("망가진 스케줄 헤더는 시각 추정으로 내려간다", () => {
  assert.equal(resolveSession(null, "not-a-cron", 15), "pm");
  assert.equal(resolveSession(null, "", 5), "am");
});
