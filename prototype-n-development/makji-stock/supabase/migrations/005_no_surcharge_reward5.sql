-- 산식 v1.0 에 DB 제약을 맞춘다.
--   1. 할인율 하한 -10 → 0. v1.0 은 정가를 넘지 않는다(할증 없음).
--   2. 예측 보상률 (0,3,7) → (0,5). 예측 쿠폰이 5% 로 바뀌었는데 제약이 남아
--      판정 결과(reward_rate_pct = 5) 저장이 거부되고 있었다.
-- 기존 행은 모두 새 범위 안이라 그대로 통과한다.

alter table daily_prices drop constraint if exists daily_prices_discount_pct_check;
alter table daily_prices add constraint daily_prices_discount_pct_check
  check (discount_pct between 0 and 38);

alter table prediction_entries drop constraint if exists prediction_entries_reward_rate_pct_check;
alter table prediction_entries add constraint prediction_entries_reward_rate_pct_check
  check (reward_rate_pct in (0,5));
