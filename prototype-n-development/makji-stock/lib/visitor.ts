import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";

/* 익명 방문자 식별 — PRD §13.4
   - 브라우저에는 추측하기 어려운 무작위 visitor_token 만 HttpOnly 쿠키로 둔다
   - DB 에는 원문 토큰을 저장하지 않고 HMAC 해시만 남긴다
   - 쿠키 삭제·다른 브라우저·다른 기기는 같은 사람으로 볼 수 없다.
     완벽한 차단이 아니라 마찰을 주는 것이 목적이다 */

const COOKIE = "visitor_token";
const ONE_YEAR = 60 * 60 * 24 * 365;

function hmac(token: string) {
  const secret = process.env.VISITOR_TOKEN_HMAC_SECRET;
  if (!secret || secret === "change-me-in-production") {
    throw new Error("VISITOR_TOKEN_HMAC_SECRET 가 설정되지 않았습니다.");
  }
  return createHmac("sha256", secret).update(token).digest("hex");
}

/** 토큰 비교는 길이가 같을 때만 상수 시간으로 한다. */
export function sameToken(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * 방문자 해시를 돌려준다. 쿠키가 없으면 발급하고 anonymous_visitors 에 등록한다.
 * Route Handler 안에서만 부를 수 있다(쿠키를 쓴다).
 */
export async function getOrCreateVisitorHash(): Promise<string> {
  const jar = await cookies();
  let token = jar.get(COOKIE)?.value;
  let issued = false;

  if (!token || token.length < 32) {
    token = randomBytes(32).toString("hex");
    issued = true;
    jar.set(COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: ONE_YEAR,
    });
  }

  const visitorHash = hmac(token);
  const db = supabaseAdmin();

  if (issued) {
    const { error } = await db.from("anonymous_visitors").insert({ visitor_hash: visitorHash });
    // 이미 있으면(쿠키를 지우고 같은 토큰이 다시 나올 일은 없지만) 무시한다
    if (error && !error.message.includes("duplicate")) throw new Error(error.message);
  } else {
    await db
      .from("anonymous_visitors")
      .upsert({ visitor_hash: visitorHash, last_seen_at: new Date().toISOString() })
      .select("visitor_hash");
  }

  return visitorHash;
}

/** 쿠키가 이미 있을 때만 해시를 돌려준다. 새로 발급하지 않는다. */
export async function readVisitorHash(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || token.length < 32) return null;
  return hmac(token);
}
