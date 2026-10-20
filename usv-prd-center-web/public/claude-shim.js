/* claude.ai 아티팩트 런타임(window.claude.use) 호환 계층.
 * 페이지 코드는 그대로 두고, 이 파일이 db / sample / downloads / assets 를 서버 API로 연결한다.
 * 지원하는 db 기능: collection(c).onSnapshot, doc("c/id").get/set/update/delete/onSnapshot
 */
(function () {
  const API = "api/";
  const err = (code, message) => Object.assign(new Error(message || code), { code, message: message || code });

  // ---------- db ----------
  function makeDb() {
    const cache = new Map();   // col -> rows [{id, version, data}]
    const subs = new Map();    // col -> Set(fn)
    async function load(col) {
      const r = await fetch(API + "db/" + encodeURIComponent(col));
      if (!r.ok) throw err("unavailable", "불러오기 실패");
      const rows = await r.json(); cache.set(col, rows);
      (subs.get(col) || new Set()).forEach((fn) => { try { fn(rows); } catch (e) { console.error(e); } });
      return rows;
    }
    try {
      const es = new EventSource(API + "events");
      es.onmessage = (e) => { try { const { col } = JSON.parse(e.data); if (subs.has(col)) load(col).catch(() => {}); } catch {} };
    } catch {}
    function subscribe(col, fn, onErr) {
      if (!subs.has(col)) subs.set(col, new Set());
      subs.get(col).add(fn);
      if (cache.has(col)) queueMicrotask(() => fn(cache.get(col))); else load(col).catch((e) => onErr && onErr(e));
      return () => subs.get(col).delete(fn);
    }
    const qs = (rows) => ({ docs: rows.map((r) => ({ id: r.id, version: r.version, exists: true, data: () => r.data })), size: rows.length, empty: !rows.length });
    const ds = (id, r) => ({ id, exists: !!r, version: r ? r.version : 0, data: () => (r ? r.data : undefined) });
    function split(p) { const s = String(p).split("/"); if (s.length !== 2) throw err("bad_path", "이 호환 계층은 '컬렉션/문서' 2단 경로만 지원합니다: " + p); return s; }
    async function send(method, col, id, body) {
      const r = await fetch(API + "db/" + encodeURIComponent(col) + "/" + encodeURIComponent(id), { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) throw err(r.status === 404 ? "not_found" : "write_failed", "저장 실패(" + r.status + ")");
      return r.json();
    }
    function docRef(col, id) {
      return {
        id,
        get: async () => { const r = await fetch(API + "db/" + encodeURIComponent(col) + "/" + encodeURIComponent(id)); return ds(id, r.ok ? await r.json() : null); },
        set: (data) => send("PUT", col, id, data),
        update: (data) => send("PATCH", col, id, data),
        delete: () => send("DELETE", col, id),
        onSnapshot: (fn, onErr) => subscribe(col, (rows) => fn(ds(id, rows.find((r) => r.id === id))), onErr),
      };
    }
    return {
      collection: (col) => ({
        doc: (id) => docRef(col, id),
        get: async () => qs(await load(col)),
        onSnapshot: (fn, onErr) => subscribe(col, (rows) => fn(qs(rows)), onErr),
      }),
      doc: (p) => { const [c, i] = split(p); return docRef(c, i); },
    };
  }

  // ---------- sample (Claude 호출) ----------
  function makeSample() {
    async function sample(input, opts = {}) {
      const body = typeof input === "string" ? { prompt: input } : { messages: input };
      body.modelTier = opts.modelTier || "default";
      const r = await fetch(API + "sample", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: opts.signal });
      if (!r.ok) { let j = {}; try { j = await r.json(); } catch {} throw err(j.code || "unavailable", j.message); }
      const reader = r.body.getReader(), dec = new TextDecoder(); let text = "";
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          const delta = dec.decode(value, { stream: true }); text += delta;
          if (opts.onText) opts.onText({ text, delta });
        }
      } catch (e) { throw Object.assign(err(opts.signal && opts.signal.aborted ? "aborted" : "stream_error"), { text }); }
      return { text, truncated: false };
    }
    sample.json = async (input, opts) => JSON.parse((await sample(input, opts)).text.replace(/^```(json)?|```$/g, "").trim());
    sample.limits = async () => ({ images: false });
    return sample;
  }

  // ---------- downloads ----------
  const downloads = {
    save: async ({ filename, data }) => {
      const blob = data instanceof Blob ? data : new Blob([data], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    },
  };

  // ---------- assets ----------
  const assets = {
    upload: async (blob) => {
      const r = await fetch(API + "assets", { method: "POST", headers: { "content-type": blob.type || "application/octet-stream" }, body: blob });
      if (!r.ok) throw err("upload_failed", "업로드 실패(" + r.status + ")");
      return r.json();
    },
  };

  const ns = {}; let dbNs = null;
  window.claude = {
    use: async (name) => {
      if (name === "db") return dbNs || (dbNs = makeDb());
      if (name === "sample") return ns.sample || (ns.sample = makeSample());
      if (name === "downloads") return downloads;
      if (name === "assets") return assets;
      return null;
    },
  };
})();
