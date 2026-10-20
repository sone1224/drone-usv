// 수상드론 what's next — 자체 호스팅 서버
// claude.ai 아티팩트의 런타임 기능(db / sample / downloads / assets)을 대체한다.
//   db      → JSON 파일 저장소 + REST + SSE(실시간 갱신)
//   sample  → Anthropic Messages API 스트리밍 프록시(API 키는 서버에만 보관)
//   assets  → 업로드 파일을 data/uploads 에 저장
//   downloads → 브라우저에서 직접 처리(서버 불필요)
import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const loadEnv = () => {
  const f = path.join(ROOT, ".env");
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
};
loadEnv();

const PORT = Number(process.env.PORT || 3000);
const PROD = process.env.NODE_ENV === "production";
// 배포(production)에서는 인증 없이 열리지 않게 한다. 사내망 전용 등 의도적으로 끄려면 ALLOW_NO_AUTH=1
if (PROD && !process.env.APP_PASSWORD && process.env.ALLOW_NO_AUTH !== "1") {
  console.error("NODE_ENV=production 에서는 APP_PASSWORD 가 필요합니다(.env). 의도적으로 인증 없이 운영하려면 ALLOW_NO_AUTH=1");
  process.exit(1);
}
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || "data");
const DB_DIR = path.join(DATA_DIR, "db");
const UP_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(DB_DIR, { recursive: true });
fs.mkdirSync(UP_DIR, { recursive: true });

// ---------- 저장소 ----------
const NAME = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const store = new Map(); // col -> { id: {...fields, _v} }
for (const f of fs.readdirSync(DB_DIR)) {
  if (f.endsWith(".json")) store.set(f.slice(0, -5), JSON.parse(fs.readFileSync(path.join(DB_DIR, f), "utf8")));
}
const timers = new Map();
function persist(col) {
  clearTimeout(timers.get(col));
  timers.set(col, setTimeout(() => {
    const tmp = path.join(DB_DIR, col + ".json.tmp");
    fs.writeFileSync(tmp, JSON.stringify(store.get(col) || {}, null, 1));
    fs.renameSync(tmp, path.join(DB_DIR, col + ".json"));
  }, 200));
}
const colOf = (c) => { if (!store.has(c)) store.set(c, {}); return store.get(c); };
function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === "object" && v.__delete__ === true) delete out[k];
    else if (v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) out[k] = merge(a[k], v);
    else out[k] = v;
  }
  return out;
}

// ---------- 실시간(SSE) ----------
const clients = new Set();
function broadcast(col, id) {
  const msg = `data: ${JSON.stringify({ col, id })}\n\n`;
  for (const res of clients) res.write(msg);
}

// ---------- 앱 ----------
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", "loopback, uniquelocal"); // Caddy/Nginx 뒤에서 실제 접속 IP 사용
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "SAMEORIGIN" });
  next();
});
app.get("/healthz", (req, res) => res.json({ ok: true })); // 컨테이너·프록시 상태 확인(인증 없음)

// 선택: APP_PASSWORD 가 있으면 HTTP Basic 인증(사용자명 임의)
if (process.env.APP_PASSWORD) {
  app.use((req, res, next) => {
    const h = req.headers.authorization || "";
    const pass = h.startsWith("Basic ") ? Buffer.from(h.slice(6), "base64").toString().split(":").slice(1).join(":") : "";
    const a = Buffer.from(pass), b = Buffer.from(process.env.APP_PASSWORD);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
    res.set("WWW-Authenticate", 'Basic realm="USV whats next", charset="UTF-8"').status(401).send("인증이 필요합니다.");
  });
}

app.get("/api/events", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  res.write(": ok\n\n");
  clients.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { clearInterval(ping); clients.delete(res); });
});

const json = express.json({ limit: "5mb" });
const check = (req, res, next) => (NAME.test(req.params.col) && (!req.params.id || NAME.test(req.params.id)) ? next() : res.status(400).json({ error: "bad_name" }));
const pub = (id, d) => { const { _v, ...data } = d; return { id, version: _v || 1, data }; };

app.get("/api/db/:col", check, (req, res) => res.json(Object.entries(colOf(req.params.col)).map(([id, d]) => pub(id, d))));
app.get("/api/db/:col/:id", check, (req, res) => {
  const d = colOf(req.params.col)[req.params.id];
  d ? res.json(pub(req.params.id, d)) : res.status(404).json({ error: "not_found" });
});
app.put("/api/db/:col/:id", check, json, (req, res) => {
  const c = colOf(req.params.col), prev = c[req.params.id];
  c[req.params.id] = { ...req.body, _v: (prev?._v || 0) + 1 };
  persist(req.params.col); broadcast(req.params.col, req.params.id);
  res.json(pub(req.params.id, c[req.params.id]));
});
app.patch("/api/db/:col/:id", check, json, (req, res) => {
  const c = colOf(req.params.col), prev = c[req.params.id];
  if (!prev) return res.status(404).json({ error: "not_found" });
  c[req.params.id] = { ...merge(prev, req.body), _v: (prev._v || 1) + 1 };
  persist(req.params.col); broadcast(req.params.col, req.params.id);
  res.json(pub(req.params.id, c[req.params.id]));
});
app.delete("/api/db/:col/:id", check, (req, res) => {
  delete colOf(req.params.col)[req.params.id];
  persist(req.params.col); broadcast(req.params.col, req.params.id);
  res.json({ ok: true });
});

// ---------- 화면 설정: 부산 실지도 운용 화면의 Google Maps 키(없으면 OpenStreetMap 사용) ----------
// 브라우저에 노출되는 키이므로 Google Cloud 콘솔에서 'HTTP 리퍼러' 제한을 반드시 건다.
app.get("/api/config", (req, res) => res.json({ googleMapsKey: process.env.GOOGLE_MAPS_API_KEY || null }));

// ---------- sample: Claude 호출 프록시 ----------
// 남용 방지: 접속 IP별 시간당 호출 수 제한(SAMPLE_LIMIT_PER_HOUR, 기본 30)
const SAMPLE_LIMIT = Number(process.env.SAMPLE_LIMIT_PER_HOUR || 30);
const sampleHits = new Map(); // ip -> [timestamps]
function sampleLimit(req, res, next) {
  const now = Date.now(), ip = req.ip || "?";
  const hits = (sampleHits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (hits.length >= SAMPLE_LIMIT) return res.status(429).json({ code: "rate_limited", message: `시간당 ${SAMPLE_LIMIT}회까지 호출할 수 있습니다.` });
  hits.push(now); sampleHits.set(ip, hits);
  next();
}
app.post("/api/sample", sampleLimit, json, async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ code: "unavailable", message: "서버에 ANTHROPIC_API_KEY 가 설정되지 않았습니다." });
  const { prompt, messages, modelTier } = req.body || {};
  const model = (modelTier === "complex" && process.env.ANTHROPIC_MODEL_COMPLEX) || process.env.ANTHROPIC_MODEL;
  if (!model) return res.status(503).json({ code: "unavailable", message: "서버에 ANTHROPIC_MODEL 이 설정되지 않았습니다." });
  const msgs = Array.isArray(messages) ? messages : [{ role: "user", content: String(prompt || "") }];
  const ac = new AbortController();
  req.on("close", () => ac.abort());
  try {
    const up = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ac.signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: Number(process.env.ANTHROPIC_MAX_TOKENS || 16000), stream: true, messages: msgs }),
    });
    if (!up.ok) {
      const t = await up.text();
      return res.status(up.status === 429 ? 429 : 502).json({ code: up.status === 429 ? "rate_limited" : "upstream_error", message: t.slice(0, 500) });
    }
    res.set({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
    const dec = new TextDecoder(); let buf = "";
    for await (const chunk of up.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        try { const ev = JSON.parse(line.slice(5)); if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") res.write(ev.delta.text); } catch {}
      }
    }
    res.end();
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ code: "upstream_error", message: String(e?.message || e) }); else res.end();
  }
});

// ---------- assets: 사진 업로드 ----------
const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg" };
app.post("/api/assets", express.raw({ type: () => true, limit: "20mb" }), (req, res) => {
  const ext = EXT[(req.headers["content-type"] || "").split(";")[0]];
  if (!ext) return res.status(415).json({ code: "unsupported_type" });
  const id = crypto.randomBytes(16).toString("hex");
  fs.writeFileSync(path.join(UP_DIR, id + ext), req.body);
  res.json({ id, url: "uploads/" + id + ext, sizeBytes: req.body.length, contentType: req.headers["content-type"] });
});
app.use("/uploads", express.static(UP_DIR, { maxAge: "30d", setHeaders: (r) => r.set("Content-Security-Policy", "default-src 'none'") }));

// ---------- 정적 파일 ----------
app.use(express.static(path.join(ROOT, "public"), { extensions: ["html"] }));

app.listen(PORT, () => console.log(`USV whats next: http://localhost:${PORT}  (시뮬레이터: /sim/)`));
