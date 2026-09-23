const kstFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function nowStamp(now = new Date()) {
  return {
    utc: now.toISOString(),
    kst: `${kstFormatter.format(now).replace(" ", "T")}+09:00`,
  };
}

export function runId(now = new Date()) {
  return kstFormatter
    .format(now)
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(" ", "-");
}

export async function timedCall({ provider, label, call, log = console.log }) {
  const started = new Date();
  const startedAt = nowStamp(started);
  log(`[${startedAt.kst}] START ${provider} · ${label}`);
  try {
    const value = await call();
    const finished = new Date();
    const elapsedMs = finished.getTime() - started.getTime();
    const finishedAt = nowStamp(finished);
    log(`[${finishedAt.kst}] OK    ${provider} · ${label} · ${elapsedMs}ms`);
    return {
      value,
      timing: {
        provider,
        label,
        status: "success",
        startedAtUtc: startedAt.utc,
        startedAtKst: startedAt.kst,
        finishedAtUtc: finishedAt.utc,
        finishedAtKst: finishedAt.kst,
        elapsedMs,
      },
    };
  } catch (error) {
    const finished = new Date();
    const elapsedMs = finished.getTime() - started.getTime();
    const finishedAt = nowStamp(finished);
    log(`[${finishedAt.kst}] FAIL  ${provider} · ${label} · ${elapsedMs}ms`);
    error.apiTiming = {
      provider,
      label,
      status: "failed",
      startedAtUtc: startedAt.utc,
      startedAtKst: startedAt.kst,
      finishedAtUtc: finishedAt.utc,
      finishedAtKst: finishedAt.kst,
      elapsedMs,
      error: error.message,
    };
    throw error;
  }
}

