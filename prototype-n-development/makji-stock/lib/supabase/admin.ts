import { createClient } from "@supabase/supabase-js";

/* 서버 전용. service_role 은 RLS 를 통과하므로 브라우저로 새어나가면 안 된다.
   NEXT_PUBLIC_ 접두사를 붙이지 말 것. */
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
