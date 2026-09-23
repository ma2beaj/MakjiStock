-- Cafe24 Admin API OAuth 토큰 보관
-- access_token 2시간 · refresh_token 2주. 하루 2번 도는 작업이라 갱신이 필수다.
-- 몰 하나당 한 행. RLS 를 켜고 정책을 두지 않아 service_role 만 접근한다.

create table if not exists cafe24_tokens (
  mall_id                  text primary key,
  access_token             text not null,
  refresh_token            text not null,
  access_token_expires_at  timestamptz not null,
  refresh_token_expires_at timestamptz not null,
  scopes                   text[] not null default '{}',
  updated_at               timestamptz not null default now()
);

-- 정책을 만들지 않으므로 RLS 만으로 anon·authenticated 는 차단된다.
alter table cafe24_tokens enable row level security;

-- anon/authenticated 는 Supabase 에만 있는 역할이다. 로컬 Postgres 검증에서도
-- 돌도록 존재할 때만 회수한다.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on cafe24_tokens from anon, authenticated;
  end if;
end $$;
