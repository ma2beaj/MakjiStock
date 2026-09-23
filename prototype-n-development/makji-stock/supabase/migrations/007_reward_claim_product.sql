-- 바로 받기 쿠폰이 어느 빵 것인지 남긴다.
--
-- 쿠폰은 Cafe24 에서 available_product 로 그 빵 하나에만 묶여 발급되는데
-- (lib/rewards/discount-code.ts), 우리 DB 에는 그 사실이 없었다. 그래서 MY 의
-- 쿠폰 줄이 상품 없이 "바로 받기 · 10% 할인코드" 로만 떠서 아무 빵에나 쓸 수
-- 있는 것처럼 보였다.
--
-- 예측 보상은 prediction_entry_id, 잠금 차액은 price_lock_id 를 타고 가면
-- 상품을 알 수 있어 null 이어도 된다. 바로 받기만 탈 곳이 없었다.
alter table reward_claims add column if not exists product_id text references products(id);

comment on column reward_claims.product_id is
  '쿠폰이 묶인 상품. 바로 받기는 이 값으로만 상품을 알 수 있다. 예측 보상·잠금 차액은 entry·lock 을 타고 가면 되므로 null 이어도 된다.';
