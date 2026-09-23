-- 토큰을 평문으로 두지 않는다. 컬럼 이름도 암호문임이 드러나게 바꾼다.
-- 평문 컬럼명을 남겨두면 나중에 누군가 그대로 쓴다.
--
-- 기존 행은 평문이라 새 키로 복호화할 수 없다. 지우고 재인증한다.
-- (/api/auth/cafe24/start 접속 한 번)

delete from cafe24_tokens;

alter table cafe24_tokens rename column access_token  to access_token_ciphertext;
alter table cafe24_tokens rename column refresh_token to refresh_token_ciphertext;
