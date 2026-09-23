import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/* 저장용 대칭 암호화 (AES-256-GCM).
   DB 만 털렸을 때 값을 못 쓰게 하는 것이 목적이다. 키는 앱이 들고 DB 에 두지 않는다.
   GCM 이라 변조도 같이 잡힌다 — 복호화 시 tag 가 맞지 않으면 예외가 난다.

   형식: base64( iv[12] || tag[16] || ciphertext ) */

const IV_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY 가 없습니다. openssl rand -hex 32 로 만드세요.");
  const buf = Buffer.from(raw.trim(), "hex");
  if (buf.length !== 32) {
    throw new Error(`TOKEN_ENCRYPTION_KEY 는 hex 64자(32바이트)여야 합니다. 현재 ${buf.length}바이트`);
  }
  return buf;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  if (raw.length <= IV_BYTES + TAG_BYTES) throw new Error("암호문이 너무 짧습니다.");
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
}
