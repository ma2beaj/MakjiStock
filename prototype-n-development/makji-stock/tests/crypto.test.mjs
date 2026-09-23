import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import test from "node:test";

/* lib/crypto.ts 와 같은 규칙. TS 를 직접 import 할 수 없어 형식을 고정한다.
   형식: base64( iv[12] || tag[16] || ciphertext ) */
const KEY = Buffer.from("a".repeat(64), "hex");

function encrypt(plaintext, k = KEY) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}
function decrypt(payload, k = KEY) {
  const raw = Buffer.from(payload, "base64");
  const d = createDecipheriv("aes-256-gcm", k, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

test("암호화한 값은 원래대로 복호화된다", () => {
  const token = "sample-cafe24-access-token-abcdef0123456789";
  assert.equal(decrypt(encrypt(token)), token);
});

test("같은 값을 두 번 암호화하면 다른 암호문이 나온다", () => {
  // iv 가 매번 달라야 한다. 같으면 같은 토큰인지 밖에서 알 수 있다.
  assert.notEqual(encrypt("same"), encrypt("same"));
});

test("암호문에 평문이 남지 않는다", () => {
  const token = "cafe24-secret-value";
  const blob = Buffer.from(encrypt(token), "base64").toString("latin1");
  assert.ok(!blob.includes(token));
});

test("변조된 암호문은 복호화가 실패한다", () => {
  const raw = Buffer.from(encrypt("payload"), "base64");
  raw[raw.length - 1] ^= 0xff;
  assert.throws(() => decrypt(raw.toString("base64")));
});

test("다른 키로는 복호화되지 않는다", () => {
  const other = Buffer.from("b".repeat(64), "hex");
  assert.throws(() => decrypt(encrypt("payload"), other));
});
