"use client";

import { useEffect, useRef, useState } from "react";
import { won } from "@/lib/bread-market/engine";

/* 시세가 처음 뜰 때 숫자가 굴러가며 자리를 잡는다. 주식 호가창처럼
   "지금 막 정해진 값"이라는 느낌을 준다.

   굴러가는 동안의 값만 상태로 둔다(rolling). 평소에는 value 를 그대로 그려서
   effect 안에서 상태를 동기로 바꾸지 않는다.
   접근성 설정에서 동작 줄이기를 켠 사람에게는 굴리지 않는다. */

const DURATION_MS = 1000;
const UNIT = 10; // 판매가는 10원 단위다

export function RollingNumber({ value, className }: { value: number; className?: string }) {
  const [rolling, setRolling] = useState<number | null>(null);
  /* "끝났는가"를 기록한다. "시작했는가"로 잠그면 StrictMode 에서 죽는다 —
     개발 모드는 effect 를 두 번 돌리는데, 첫 번째가 잠그고 정리에서 프레임을
     취소하면 두 번째는 잠금에 걸려 그냥 반환한다. 굴러가다 만 채로 끝난다. */
  const done = useRef(false);

  useEffect(() => {
    /* 첫 등장에만 굴린다. 이후 값이 바뀌면 그대로 갈아끼운다.
       서버가 이미 실시세를 심고 그린 화면이라, 굴러가는 값이 곧 진짜 값이다. */
    if (done.current) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      done.current = true;
      return;
    }

    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      if (t >= 1) {
        done.current = true;
        setRolling(null);
        return;
      }
      /* 처음엔 넓게 흔들리다 좁혀진다. 목표값 근처를 맴돌게 해서
         자리수가 튀지 않는다 — 폭이 바뀌면 옆 글자가 흔들린다. */
      const spread = value * 0.22 * (1 - t) ** 2;
      const noise = (Math.random() - 0.5) * 2 * spread;
      const eased = value * (1 - (1 - t) ** 3);
      setRolling(Math.max(UNIT, Math.round((eased + noise) / UNIT) * UNIT));
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    // done 을 그대로 두어 StrictMode 두 번째 마운트가 다시 시작하게 한다.
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {won(rolling ?? value)}원
    </span>
  );
}
