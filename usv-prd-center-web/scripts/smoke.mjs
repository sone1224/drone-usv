// 서버가 떠 있는 상태에서 실행: npm run smoke
const B = process.env.BASE || "http://localhost:3000/";
const ok = (c, m) => { if (!c) { console.error("FAIL", m); process.exit(1); } console.log("ok", m); };
const j = async (p, o) => (await fetch(B + p, o)).json();
ok((await fetch(B)).ok, "index.html");
ok((await fetch(B + "sim/")).ok, "sim/ (지상통제소 시뮬레이터)");
ok((await fetch(B + "sim/js/scenarios.js")).ok, "sim/js/scenarios.js");
for (const c of ["calls", "drafts", "products", "news", "war", "laws", "company", "meta", "simruns"]) ok(Array.isArray(await j("api/db/" + c)), "db " + c);
const put = await j("api/db/_smoke/t1", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: 1 }) });
ok(put.data.a === 1, "PUT");
const pat = await j("api/db/_smoke/t1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ b: 2 }) });
ok(pat.data.a === 1 && pat.data.b === 2, "PATCH merge");
await fetch(B + "api/db/_smoke/t1", { method: "DELETE" });
console.log("smoke passed");
