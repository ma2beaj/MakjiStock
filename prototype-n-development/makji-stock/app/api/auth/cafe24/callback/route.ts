import { cookies } from "next/headers";
import { exchangeCodeForTokens } from "@/lib/cafe24/client";

function page(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="ko"><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${title}</title>
     <body style="font-family:system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 1.5rem;line-height:1.7">
     <h1 style="font-size:1.25rem">${title}</h1>${body}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");

  if (error) {
    return page("인증이 취소됐습니다", `<p>Cafe24 응답: <code>${error}</code></p>`, 400);
  }

  const jar = await cookies();
  const expected = jar.get("cafe24_oauth_state")?.value;
  // state 가 일치해야 우리가 시작한 요청이다. 남이 끼워넣은 code 로 토큰이 덮이는 것을 막는다.
  if (!expected || !state || state !== expected) {
    return page(
      "state 검증 실패",
      "<p>이 브라우저에서 시작한 인증이 아니거나 10분이 지났습니다. <code>/api/auth/cafe24/start</code> 부터 다시 진행하세요.</p>",
      400,
    );
  }
  jar.delete("cafe24_oauth_state");

  if (!code) return page("code 가 없습니다", "<p>다시 시도해주세요.</p>", 400);

  try {
    const saved = await exchangeCodeForTokens(code);
    return page(
      "Cafe24 연결 완료",
      `<p>몰 <b>${saved.mall_id}</b> 토큰을 저장했습니다.</p>
       <p>access_token 만료: ${saved.access_token_expires_at}<br>
          refresh_token 만료: ${saved.refresh_token_expires_at}</p>
       <p>만료 5분 전부터 자동 갱신됩니다. 이 창은 닫아도 됩니다.</p>`,
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return page("토큰 교환 실패", `<pre style="white-space:pre-wrap">${message}</pre>`, 502);
  }
}
