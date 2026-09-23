-- 실제 자사몰(makji.kr) 상품 주소를 저장해 둔다. 지금은 쓰지 않는다.
--
-- 몰이 둘이다.
--   rabbit3456 데모몰 : 가격 PUT 을 시험하는 곳. cafe24_product_no 가 가리킨다
--   makji.kr 자사몰   : 손님이 실제로 사는 곳. shop_url 이 가리킨다
--
-- 구매 버튼이 어디로 갈지는 환경변수 SHOP_TARGET 이 정한다.
--   demo (기본) → 데모몰 상품 상세
--   live        → shop_url
-- 실제 자사몰로 넘길 때 코드를 고치지 않고 값 하나만 바꾼다.
--
-- 주소에 슬러그가 들어 있어 상품번호만으로는 만들 수 없다. 전체를 저장한다.
-- icid 추적 파라미터는 뺐다. 자사몰 메인 목록에서 온 것처럼 집계되면 안 된다.

alter table products
  add column if not exists shop_url text;

comment on column products.shop_url is
  '실제 자사몰(makji.kr) 상품 상세 주소. SHOP_TARGET=live 일 때 구매 버튼이 여기로 간다.';

update products set shop_url = 'https://makji.kr/product/%EB%A7%89%EC%A7%80-%EA%B8%80%EB%A3%A8%ED%85%90%ED%94%84%EB%A6%AC-%EB%83%89%EB%8F%99%EC%83%9D%EC%A7%80-3%EC%A2%85/33/category/1/display/2/' where id = 'gluten_free_frozen_dough_set';
update products set shop_url = 'https://makji.kr/product/%EB%8B%B4%EB%B0%B1%ED%8F%AD%EC%8B%A0-%EB%A7%89%EC%A7%80-%EC%A0%9C%EB%A1%9C-%EB%AC%B4%EC%84%A4%ED%83%95-%EB%AA%A8%EB%8B%9D%EB%A1%A4/32/category/1/display/2/' where id = 'morning_roll';
update products set shop_url = 'https://makji.kr/product/%ED%8F%AD%EC%8B%A0%ED%95%9C-%ED%86%B5%EC%8B%9D%EB%B9%B5-%EB%A7%89%EC%A7%80-%ED%85%8C%ED%8A%B8%EB%A6%AC%EC%8A%A4-%EB%B8%8C%EB%A0%88%EB%93%9C/31/category/1/display/2/' where id = 'tetris_bread';
update products set shop_url = 'https://makji.kr/product/%EB%A7%89%EC%A7%80-%EB%B9%84%EA%B1%B4-%EC%9E%89%EA%B8%80%EB%A6%AC%EC%8B%9C-%EB%A8%B8%ED%95%80%ED%96%84%EC%B9%98%EC%A6%88%EB%B9%84%EA%B1%B4/30/category/1/display/2/' where id = 'english_muffin';
update products set shop_url = 'https://makji.kr/product/%EA%B2%89%EB%B0%94%EC%86%8D%EC%AB%80-%EB%A7%89%EC%A7%80-%EA%B8%80%EB%A3%A8%ED%85%90%ED%94%84%EB%A6%AC-%ED%9C%98%EB%82%AD%EC%8B%9C%EC%97%90/28/category/1/display/2/' where id = 'gluten_free_financier';
update products set shop_url = 'https://makji.kr/product/%ED%99%98%EC%83%81%EC%9D%98-%EB%8B%A8%EC%A7%9C-%EC%A1%B0%ED%95%A9-%EB%A7%89%EC%A7%80-%EA%B8%80%EB%A3%A8%ED%85%90%ED%94%84%EB%A6%AC-%EC%8A%A4%EC%BD%98/25/category/1/display/2/' where id = 'gluten_free_scone';

select ticker, name, cafe24_product_no as demo_no, shop_url is not null as has_shop_url
from products order by ticker;
