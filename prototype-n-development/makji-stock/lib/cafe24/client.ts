import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

/* Cafe24 Admin API OAuth
   - access_token 2시간, refresh_token 2주 (공식 문서 기준)
   - 토큰은 cafe24_tokens 에 몰 하나당 한 행으로 둔다
   - 갱신하면 refresh_token 도 새로 내려오므로 둘 다 저장한다 */

const REFRESH_MARGIN_MS = 5 * 60 * 1000; // 만료 5분 전이면 미리 갱신

/* 토큰은 암호문으로 저장한다. 이 타입의 *_ciphertext 를 평문으로 오해하지 말 것. */
export type Cafe24TokenRow = {
  mall_id: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string;
  scopes: string[];
};

export function cafe24Env() {
  const mallId = process.env.CAFE24_MALL_ID;
  const clientId = process.env.CAFE24_CLIENT_ID;
  const clientSecret = process.env.CAFE24_CLIENT_SECRET;
  if (!mallId || !clientId || !clientSecret) {
    throw new Error("CAFE24_MALL_ID · CAFE24_CLIENT_ID · CAFE24_CLIENT_SECRET 가 필요합니다.");
  }
  return { mallId, clientId, clientSecret };
}

/* 빈 문자열은 ?? 를 통과한다. Number("") 는 0 이고 Cafe24 는 shop_no=0 에
   빈 목록을 돌려준다 — 오류가 아니라 조용히 아무것도 안 나온다.
   || 로 받아 0·NaN·빈값을 모두 1 로 떨어뜨린다. */
export function cafe24ShopNo(): number {
  return Number(process.env.CAFE24_SHOP_NO) || 1;
}

export function cafe24RedirectUri() {
  const base =
    process.env.CAFE24_REDIRECT_BASE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000");
  return `${base}/api/auth/cafe24/callback`;
}

/* 공식 문서가 client_id/secret 전달 방식을 명시하지 않는다.
   Cafe24 는 Basic 인증을 쓰는 것으로 알려져 있어 그쪽을 먼저 시도하고,
   401/400 이면 body 방식으로 한 번 더 시도한다.
   ponytail: 실제 자격증명으로 한 번 확인되면 성공한 쪽만 남긴다. */
async function requestToken(params: Record<string, string>) {
  const { mallId, clientId, clientSecret } = cafe24Env();
  const url = `https://${mallId}.cafe24api.com/api/v2/oauth/token`;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const attempts: RequestInit[] = [
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params).toString(),
    },
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...params,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    },
  ];

  let lastBody = "";
  for (const init of attempts) {
    const response = await fetch(url, init);
    const text = await response.text();
    if (response.ok) return JSON.parse(text);
    lastBody = `${response.status}: ${text.slice(0, 400)}`;
    if (response.status >= 500) break; // 서버 오류는 방식 문제가 아니다
  }
  throw new Error(`Cafe24 토큰 요청 실패 — ${lastBody}`);
}

/* Cafe24 는 만료 시각을 KST 로 주면서 타임존 표시를 붙이지 않는다.
   ("2026-09-19T15:52:50.000") 그대로 new Date() 에 넣으면 UTC 로 읽혀
   실제보다 9시간 뒤로 잡히고, 만료된 토큰을 살아 있다고 오판한다. */
export function parseCafe24Time(value: string): Date {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim());
  return new Date(hasZone ? value : `${value.trim()}+09:00`);
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  refresh_token_expires_at: string;
  scopes?: string[];
};

async function save(payload: TokenResponse) {
  const { mallId } = cafe24Env();
  const row = {
    mall_id: mallId,
    access_token_ciphertext: encryptSecret(payload.access_token),
    refresh_token_ciphertext: encryptSecret(payload.refresh_token),
    access_token_expires_at: parseCafe24Time(payload.expires_at).toISOString(),
    refresh_token_expires_at: parseCafe24Time(payload.refresh_token_expires_at).toISOString(),
    scopes: payload.scopes ?? [],
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin().from("cafe24_tokens").upsert(row);
  if (error) throw new Error(`토큰 저장 실패: ${error.message}`);
  // 호출부가 실수로 평문을 흘리지 않도록 만료 정보만 돌려준다.
  return {
    mall_id: row.mall_id,
    access_token: payload.access_token,
    access_token_expires_at: row.access_token_expires_at,
    refresh_token_expires_at: row.refresh_token_expires_at,
  };
}

export async function exchangeCodeForTokens(code: string) {
  const payload = (await requestToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: cafe24RedirectUri(),
  })) as TokenResponse;
  return save(payload);
}

/** 저장된 토큰을 돌려준다. 만료가 가까우면 먼저 갱신한다. */
export async function getAccessToken(): Promise<string> {
  const { mallId } = cafe24Env();
  const { data, error } = await supabaseAdmin()
    .from("cafe24_tokens")
    .select("*")
    .eq("mall_id", mallId)
    .maybeSingle();

  if (error) throw new Error(`토큰 조회 실패: ${error.message}`);
  if (!data) {
    throw new Error("Cafe24 토큰이 없습니다. /api/auth/cafe24/start 로 인증을 먼저 진행하세요.");
  }

  const tokens = data as Cafe24TokenRow;
  const expiresAt = new Date(tokens.access_token_expires_at).getTime();
  if (Date.now() < expiresAt - REFRESH_MARGIN_MS) {
    return decryptSecret(tokens.access_token_ciphertext);
  }

  if (Date.now() >= new Date(tokens.refresh_token_expires_at).getTime()) {
    throw new Error("refresh_token 이 만료됐습니다. /api/auth/cafe24/start 로 다시 인증하세요.");
  }

  const refreshed = (await requestToken({
    grant_type: "refresh_token",
    refresh_token: decryptSecret(tokens.refresh_token_ciphertext),
  })) as TokenResponse;
  const saved = await save(refreshed);
  return saved.access_token;
}

/* 로컬·프리뷰도 운영과 같은 실몰(rabbit3456)을 본다. 읽기는 무해하지만 쓰기는
   진짜 상품가와 쿠폰을 건드리므로 기본으로 막는다. 연동 자체를 확인해야 할 때만
   CAFE24_ALLOW_LOCAL_WRITES=1 로 연다. */
export const CAFE24_WRITES_ENABLED =
  process.env.NODE_ENV === "production" || process.env.CAFE24_ALLOW_LOCAL_WRITES === "1";

/** Admin API 호출. 401 이면 한 번 갱신하고 재시도한다 (PRD §12.2). */
export async function cafe24Request<T = unknown>(
  pathname: string,
  init: RequestInit = {},
): Promise<T> {
  /* 마지막 방어선. 호출하는 쪽이 저마다 검사하면 새 호출처가 하나 빠지는 순간
     로컬에서 실몰이 바뀐다. 여기서 한 번 막으면 모든 경로가 덮인다. */
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && !CAFE24_WRITES_ENABLED) {
    throw new Error(
      `로컬에서는 Cafe24 쓰기를 보내지 않습니다 (${method} ${pathname}). ` +
        "실몰에 반영하려면 CAFE24_ALLOW_LOCAL_WRITES=1 로 여세요.",
    );
  }
  const { mallId } = cafe24Env();
  const call = async (token: string) =>
    fetch(`https://${mallId}.cafe24api.com${pathname}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

  let response = await call(await getAccessToken());
  if (response.status === 401) {
    const { mallId: id } = cafe24Env();
    await supabaseAdmin()
      .from("cafe24_tokens")
      .update({ access_token_expires_at: new Date(0).toISOString() })
      .eq("mall_id", id);
    response = await call(await getAccessToken());
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Cafe24 ${pathname} ${response.status}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text) as T;
}
