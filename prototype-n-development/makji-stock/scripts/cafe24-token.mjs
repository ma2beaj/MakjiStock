/* 저장된 Cafe24 토큰을 읽어 복호화한다.

   Cafe24 는 토큰을 평문으로 준다. 암호화는 우리가 저장 직전에 한 것이라
   (lib/crypto.ts, AES-256-GCM) 복호화에 Cafe24 쪽 정보는 필요 없다.

   필요한 환경변수
     NEXT_PUBLIC_SUPABASE_URL
     SUPABASE_SERVICE_ROLE_KEY   행을 읽는다
     TOKEN_ENCRYPTION_KEY        복호화한다

   사용
     node scripts/cafe24-token.mjs              가려서 보여준다
     node scripts/cafe24-token.mjs --reveal     원문을 그대로 찍는다
     node scripts/cafe24-token.mjs --curl       Cafe24 호출 예시를 만든다

   --reveal 은 터미널·기록에 토큰이 남는다. 공유 화면에서는 쓰지 말 것. */
import { createDecipheriv } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { loadEnvFile } from "../lib/pricing/env.mjs";

function decrypt(payload, keyHex) {
  const raw = Buffer.from(payload, "base64");
  const key = Buffer.from(keyHex.trim(), "hex");
  if (key.length !== 32) throw new Error(`TOKEN_ENCRYPTION_KEY 는 hex 64자여야 합니다 (현재 ${key.length}바이트)`);
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

const mask = (s) => `${s.slice(0, 6)}…${s.slice(-4)} (${s.length}자)`;

async function main() {
  const args = new Set(process.argv.slice(2));
  await loadEnvFile(path.resolve(".env"));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const cryptoKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!url || !serviceKey) throw new Error("Supabase 환경변수가 필요합니다.");
  if (!cryptoKey) throw new Error("TOKEN_ENCRYPTION_KEY 가 필요합니다.");

  const response = await fetch(`${url}/rest/v1/cafe24_tokens?select=*`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  const [row] = await response.json();
  if (!row) throw new Error("저장된 토큰이 없습니다. /api/auth/cafe24/start 로 인증하세요.");

  const access = decrypt(row.access_token_ciphertext, cryptoKey);
  const refresh = decrypt(row.refresh_token_ciphertext, cryptoKey);
  const show = args.has("--reveal");
  const left = (iso) => {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return "만료됨";
    const h = Math.floor(ms / 3600000);
    return h >= 24 ? `${Math.floor(h / 24)}일 ${h % 24}시간 남음` : `${h}시간 ${Math.floor((ms % 3600000) / 60000)}분 남음`;
  };

  console.log(`몰            ${row.mall_id}`);
  console.log(`권한          ${(row.scopes ?? []).join(", ")}`);
  console.log(`access_token  ${show ? access : mask(access)}   ${left(row.access_token_expires_at)}`);
  console.log(`refresh_token ${show ? refresh : mask(refresh)}   ${left(row.refresh_token_expires_at)}`);

  if (args.has("--curl")) {
    console.log("\n# 상품 목록 조회 예시");
    console.log(
      `curl -s "https://${row.mall_id}.cafe24api.com/api/v2/admin/products?shop_no=1&limit=5" \\\n` +
        `  -H "Authorization: Bearer ${show ? access : "<--reveal 로 확인>"}"`,
    );
  }
  if (!show) console.log("\n원문을 보려면 --reveal 을 붙이세요. 터미널 기록에 남으니 주의하세요.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
