-- 잠금 차액 할인코드를 MY 화면에 바로 띄우려면 코드 원문을 다시 읽어야 한다.
-- PRD §16.7 은 "코드 원문은 저장하지 않거나 암호화"를 요구하므로 암호화해서 둔다.
-- lib/crypto.ts 의 AES-256-GCM, TOKEN_ENCRYPTION_KEY 를 그대로 쓴다.

alter table reward_claims
  add column if not exists discount_code_ciphertext text;

-- 잠금 차액 코드는 비율 보상이 아니라 정액이다. 0 을 넣으면 "0% 보상"으로
-- 읽혀 오해를 만든다. 예측 보상만 rate_pct 를 채운다.
alter table reward_claims
  alter column rate_pct drop not null;

-- 한 잠금당 코드 1회는 이미 유니크 인덱스가 막는다 (schema.sql).
-- 크론이 같은 실행을 중복 호출해도 두 번 발급되지 않는다.
