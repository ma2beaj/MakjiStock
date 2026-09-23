-- 예측에 리스크/리워드 선택을 붙인다.
--   ① 안정형 투자(바로 받기)  — 10~15% 중 오늘 값. 고르기 전에 숫자가 보인다
--   ② 공격형 투자(내일 맞히기) —  5~20% 중 하나. 걸 때는 "?" 이고 결과가 나와야 안다
--
-- 1. 보상률 범위를 넓힌다. (0,5) 고정이던 것을 0~20 으로 연다.
--    예측 제출 시점에 그 회차의 약속 보상률을 저장하고, 판정 때 그 값을 쓴다.
--    빗나가면 0 이라 하한은 그대로 0 이다.
--
-- 2. 즉시 수령을 reward_claims 에 직접 남긴다. prediction_entries 에 넣지 않는
--    이유는 그 행이 예측이 아니기 때문이다 — direction 도 판정 결과도 없다.
--    대신 round_id 를 달아 "이 회차에서 한 선택" 임을 표시하고, 부분 유니크
--    인덱스로 회차당 1회를 DB 가 막게 한다. prediction_entries 의
--    (round_id, visitor_hash) 유니크와 같은 역할이다.
--
-- 둘의 상호 배타(즉시 받고 예측까지 하는 것)는 애플리케이션이 막는다 —
-- 서로 다른 테이블이라 한 인덱스로는 걸 수 없다.

alter table prediction_entries drop constraint if exists prediction_entries_reward_rate_pct_check;
alter table prediction_entries add constraint prediction_entries_reward_rate_pct_check
  check (reward_rate_pct between 0 and 20);

alter table reward_claims add column if not exists round_id text references prediction_rounds(id);

create unique index if not exists reward_claims_instant_round_visitor
  on reward_claims (round_id, visitor_hash)
  where round_id is not null;

-- 3. 쿠폰의 출처가 셋이 된다. 기존 제약은 예측·잠금 둘만 허용했다.
alter table reward_claims drop constraint if exists reward_claims_check;
alter table reward_claims drop constraint if exists reward_claims_source_check;
alter table reward_claims add constraint reward_claims_source_check
  check (prediction_entry_id is not null or price_lock_id is not null or round_id is not null);

comment on column reward_claims.round_id is
  '즉시 수령(바로 받기)으로 발급된 쿠폰의 회차. 예측 보상·잠금 차액은 null.';
