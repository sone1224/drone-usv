// 해도(地圖) 렌더링: 해안선, 통신 커버리지, AIS, 선체, 경로점, 탐지 표적
(function () {
  const G = window.GCS;
  const S = G.state;
  const D2R = Math.PI / 180;
  const F = '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

  const view = G.view = { cx: -800, cy: -1600, scale: 0.075, follow: false, wpEdit: false };
  let canvas, ctx, W = 0, H = 0, dpr = 1;

  const w2s = (x, y) => [(x - view.cx) * view.scale + W / 2, -(y - view.cy) * view.scale + H / 2];
  const s2w = (sx, sy) => [(sx - W / 2) / view.scale + view.cx, -(sy - H / 2) / view.scale + view.cy];
  G.w2s = w2s; G.s2w = s2w;

  G.mapInit = function (el) {
    canvas = el; ctx = canvas.getContext('2d');
    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      const r = canvas.getBoundingClientRect();
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    };
    new ResizeObserver(resize).observe(canvas);
    resize();

    let drag = null;
    canvas.addEventListener('mousedown', (e) => { drag = { x: e.offsetX, y: e.offsetY, cx: view.cx, cy: view.cy, moved: false }; });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const r = canvas.getBoundingClientRect();
      const dx = e.clientX - r.left - drag.x, dy = e.clientY - r.top - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) { view.cx = drag.cx - dx / view.scale; view.cy = drag.cy + dy / view.scale; view.follow = false; }
    });
    window.addEventListener('mouseup', (e) => {
      if (drag && !drag.moved && e.target === canvas) onClick(e.offsetX, e.offsetY);
      drag = null;
    });
    canvas.addEventListener('mousemove', (e) => {
      const [x, y] = s2w(e.offsetX, e.offsetY);
      G.cursor = { x, y };
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [wx, wy] = s2w(e.offsetX, e.offsetY);
      const k = Math.exp(-e.deltaY * 0.0015);
      view.scale = Math.max(0.008, Math.min(2.5, view.scale * k));
      const [nx, ny] = s2w(e.offsetX, e.offsetY);
      view.cx += wx - nx; view.cy += wy - ny;
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (view.wpEdit) { const v = G.selected(); if (v && v.wps.length) { v.wps.pop(); G.onChange && G.onChange(); } }
    });
  };

  function onClick(sx, sy) {
    const v = G.selected();
    if (view.wpEdit && v) {
      const [x, y] = s2w(sx, sy);
      if (G.isLand(x, y)) { G.log(v, 'warn', '육지에는 경로점을 둘 수 없습니다'); return; }
      v.wps.push({ x, y });
      G.onChange && G.onChange();
      return;
    }
    let best = null, bd = 22;
    S.vessels.forEach((q) => {
      const [qx, qy] = w2s(q.x, q.y);
      const d = Math.hypot(qx - sx, qy - sy);
      if (d < bd) { bd = d; best = q; }
    });
    if (best) { S.selectedId = best.id; G.onChange && G.onChange(); }
  }

  G.centerOn = function (x, y) { view.cx = x; view.cy = y; };

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  G.mapDraw = function () {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sel = G.selected();
    if (view.follow && sel) { view.cx = sel.x; view.cy = sel.y; }

    // 바다
    ctx.fillStyle = css('--sea'); ctx.fillRect(0, 0, W, H);

    // 격자
    const stepM = view.scale > 0.25 ? 250 : view.scale > 0.06 ? 1000 : 5000;
    const [x0, y1] = s2w(0, 0), [x1, y0] = s2w(W, H);
    ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1; ctx.beginPath();
    for (let gx = Math.floor(x0 / stepM) * stepM; gx <= x1; gx += stepM) { const [sx] = w2s(gx, 0); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); }
    for (let gy = Math.floor(y0 / stepM) * stepM; gy <= y1; gy += stepM) { const [, sy] = w2s(0, gy); ctx.moveTo(0, sy); ctx.lineTo(W, sy); }
    ctx.stroke();

    // LTE 커버리지 경계(해안에서 12km)
    ctx.setLineDash([8, 6]); ctx.strokeStyle = css('--lte'); ctx.lineWidth = 1.2; ctx.beginPath();
    for (let sx = 0; sx <= W; sx += 6) {
      const [wx] = s2w(sx, 0);
      const [, sy] = w2s(wx, G.coastY(wx) - G.LINKS.LTE.rangeOffshore);
      sx === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    // 메시 사거리(지상통제소 기준)
    ctx.strokeStyle = css('--mesh');
    const [gx, gy] = w2s(G.GCS_POS.x, G.GCS_POS.y);
    ctx.beginPath(); ctx.arc(gx, gy, G.LINKS.MESH.range * view.scale, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '11px ' + F; ctx.fillStyle = css('--lte');
    { const [lx, ly] = w2s(view.cx, G.coastY(view.cx) - G.LINKS.LTE.rangeOffshore); ctx.fillText('LTE 커버리지 한계', lx + 6, ly - 6); }
    ctx.fillStyle = css('--mesh'); ctx.fillText('메시 직결 사거리', gx + 6, gy + G.LINKS.MESH.range * view.scale - 6);

    // 유출유(관측형이 탐지한 이후 표시, 탐지 전에는 희미하게)
    {
      const o = S.oil;
      const [ox, oy] = w2s(o.x, o.y);
      ctx.save(); ctx.translate(ox, oy); ctx.rotate(o.rot);
      ctx.beginPath(); ctx.ellipse(0, 0, o.rx * view.scale, o.ry * view.scale, 0, 0, Math.PI * 2);
      ctx.fillStyle = o.reported ? 'rgba(255,170,0,0.28)' : 'rgba(120,120,120,0.08)';
      ctx.fill();
      if (o.reported) { ctx.strokeStyle = '#ffaa00'; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]); }
      ctx.restore();
      if (o.reported) { ctx.fillStyle = '#ffaa00'; ctx.fillText('유출유 의심 구역', ox + 8, oy - o.ry * view.scale - 6); }
    }

    // 국가중요시설(가상) 경계구역·접근 경고선
    {
      const Z = G.ZONE, b = Z.buffer;
      const [ax, ay] = w2s(Z.x0, Z.ySea), [bx, by] = w2s(Z.x1, 3000);
      ctx.fillStyle = 'rgba(255,77,79,0.10)'; ctx.fillRect(ax, by, bx - ax, ay - by);
      ctx.strokeStyle = 'rgba(255,77,79,0.85)'; ctx.lineWidth = 1.6; ctx.setLineDash([]); ctx.strokeRect(ax, by, bx - ax, ay - by);
      const [cx, cy] = w2s(Z.x0 - b, Z.ySea - b), [dx, dy] = w2s(Z.x1 + b, 3000);
      ctx.strokeStyle = 'rgba(250,173,20,0.8)'; ctx.setLineDash([6, 5]); ctx.strokeRect(cx, dy, dx - cx, cy - dy); ctx.setLineDash([]);
      ctx.fillStyle = '#ff7875'; ctx.font = 'bold 11px ' + F;
      ctx.fillText('경계구역(진입 금지)', ax + 6, ay - 8);
      ctx.fillStyle = '#faad14'; ctx.font = '10px ' + F; ctx.fillText('접근 경고선', cx + 6, cy - 6);
    }

    // 육지
    ctx.beginPath();
    for (let sx = -4; sx <= W + 4; sx += 4) {
      const [wx] = s2w(sx, 0);
      const [, sy] = w2s(wx, G.coastY(wx));
      sx === -4 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
    }
    ctx.lineTo(W + 4, -4); ctx.lineTo(-4, -4); ctx.closePath();
    ctx.fillStyle = css('--land'); ctx.fill();
    ctx.strokeStyle = css('--coast'); ctx.lineWidth = 1.5; ctx.stroke();

    // 시설(가상 원전) 표시
    {
      const s = G.ZONE.site; const [sx, sy] = w2s(s.x, G.coastY(s.x) + 260);
      ctx.fillStyle = '#c9d1d9';
      [[-14, 0], [14, 0]].forEach(([o]) => { ctx.beginPath(); ctx.arc(sx + o, sy, 9, Math.PI, 0); ctx.lineTo(sx + o + 9, sy + 8); ctx.lineTo(sx + o - 9, sy + 8); ctx.fill(); });
      ctx.fillStyle = '#ff7875'; ctx.font = 'bold 11px ' + F; ctx.fillText(s.name, sx + 30, sy + 4);
    }

    // 지상통제소·지정점
    ctx.fillStyle = css('--fg');
    ctx.fillRect(gx - 5, gy - 5, 10, 10);
    ctx.fillText('지상통제소', gx + 8, gy + 4);
    const [hx, hy] = w2s(G.HOME.x, G.HOME.y);
    ctx.strokeStyle = css('--fg'); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(hx, hy, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.fillText('H', hx - 3.5, hy + 4);
    ctx.fillText('지정점(복귀)', hx + 10, hy + 4);

    // 메시 중계선
    ctx.strokeStyle = css('--mesh'); ctx.globalAlpha = 0.45; ctx.lineWidth = 1;
    S.vessels.forEach((v) => {
      const L = v.links.MESH;
      if (!L || !L.up) return;
      const src = L.via === 'GCS' ? G.GCS_POS : L.via === 'MCS' ? S.mcs : S.vessels.find((q) => q.id === L.via);
      if (!src) return;
      const [ax, ay] = w2s(src.x, src.y), [bx, by] = w2s(v.x, v.y);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // 해상통제소(지원함): 선체·메시 범위·항적
    if (S.mcs && S.mcs.active) {
      const M = S.mcs, [mx, my] = w2s(M.x, M.y);
      ctx.strokeStyle = 'rgba(115,209,61,0.55)'; ctx.setLineDash([4, 5]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(mx, my, G.LINKS.MESH.range * view.scale, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      if (M.trail.length > 1) { ctx.strokeStyle = 'rgba(115,209,61,0.35)'; ctx.beginPath(); M.trail.forEach((p, i) => { const [sx, sy] = w2s(p.x, p.y); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }); ctx.lineTo(mx, my); ctx.stroke(); }
      const len = Math.max(20, 30 * view.scale * 6);
      ctx.save(); ctx.translate(mx, my); ctx.rotate(M.hdg * D2R);
      ctx.beginPath(); ctx.moveTo(0, -len / 2); ctx.lineTo(len * 0.22, -len * 0.15); ctx.lineTo(len * 0.2, len / 2); ctx.lineTo(-len * 0.2, len / 2); ctx.lineTo(-len * 0.22, -len * 0.15); ctx.closePath();
      ctx.fillStyle = '#73d13d'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#0d1117'; ctx.fillRect(-len * 0.12, -len * 0.05, len * 0.24, len * 0.22);
      ctx.restore();
      ctx.fillStyle = '#95de64'; ctx.font = 'bold 11px ' + F;
      ctx.fillText(`해상통제소(지원함)${M.escort ? ' · ' + M.escort + ' 호위' : ''}`, mx + len / 2 + 6, my - 2);
      ctx.fillStyle = css('--muted'); ctx.font = '10px ' + F; ctx.fillText(`메시 6km · ${(M.spd * 1.944).toFixed(1)}kn`, mx + len / 2 + 6, my + 11);
    }

    // AIS 표적
    S.ais.forEach((a) => {
      const [ax, ay] = w2s(a.x, a.y);
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(a.cog * D2R);
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath();
      ctx.strokeStyle = css('--ais'); ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(0, -8 - a.sog * 60 * view.scale); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = css('--ais'); ctx.font = '10px ' + F;
      ctx.fillText(`${a.name} ${(a.sog * 1.944).toFixed(1)}kn`, ax + 8, ay - 6);
    });

    // 레이더 탐지 범위(선택한 D) · 미식별 선박(탐지된 경우만)
    if (sel && sel.m.radarRange && sel.pdu.RADAR && sel.pdu.RADAR.on) {
      const [rx, ry] = w2s(sel.x, sel.y);
      ctx.strokeStyle = 'rgba(155,140,255,0.55)'; ctx.setLineDash([3, 5]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(rx, ry, sel.m.radarRange * view.scale, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    {
      const I = S.intruder;
      if (I && !I.gone && I.trackX != null && S.t - I.lastSeen < 10) {
        const [ix, iy] = w2s(I.trackX, I.trackY);
        ctx.save(); ctx.translate(ix, iy); ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#ff4d4f'; ctx.fillRect(-6, -6, 12, 12); ctx.restore();
        ctx.strokeStyle = '#ff4d4f'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(ix, iy, 14, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#ff4d4f'; ctx.font = 'bold 11px ' + F;
        ctx.fillText(`미식별 선박 ${(I.sog * 1.944).toFixed(0)}kn${I.leaving ? ' · 이탈 중' : ''}`, ix + 18, iy + 4);
      }
    }

    // 구조부이·요구조자
    S.buoys.forEach((b) => {
      const [bx, by] = w2s(b.x, b.y);
      ctx.fillStyle = '#ff4d4f'; ctx.beginPath(); ctx.arc(bx, by, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
    });
    if (S.piw.detected) {
      const [px, py] = w2s(S.piw.detX, S.piw.detY);
      ctx.strokeStyle = S.piw.rescued ? '#52c41a' : '#ff4d4f'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px - 8, py - 8); ctx.lineTo(px + 8, py + 8); ctx.moveTo(px + 8, py - 8); ctx.lineTo(px - 8, py + 8); ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py, 13, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle; ctx.font = '11px ' + F;
      ctx.fillText(S.piw.rescued ? '요구조자(부이 전달)' : '요구조자 추정 위치', px + 16, py + 4);
    }

    // 선체
    S.vessels.forEach((v) => {
      const isSel = sel && v.id === sel.id;
      // 항적
      if (v.trail.length > 1) {
        ctx.strokeStyle = v.m.color; ctx.globalAlpha = 0.35; ctx.lineWidth = 1.5; ctx.beginPath();
        v.trail.forEach((p, i) => { const [sx, sy] = w2s(p.x, p.y); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
        const [cx, cy] = w2s(v.x, v.y); ctx.lineTo(cx, cy);
        ctx.stroke(); ctx.globalAlpha = 1;
      }
      // 경로점
      if (v.wps.length && (isSel || v.mode === 'AUTO')) {
        ctx.strokeStyle = v.m.color; ctx.lineWidth = isSel ? 1.6 : 1; ctx.setLineDash([5, 4]);
        ctx.beginPath();
        const ep = G.estPos(v);
        let [sx, sy] = w2s(ep.x, ep.y);
        ctx.moveTo(sx, sy);
        for (let i = Math.min(v.wpIdx, v.wps.length); i < v.wps.length; i++) { [sx, sy] = w2s(v.wps[i].x, v.wps[i].y); ctx.lineTo(sx, sy); }
        ctx.stroke(); ctx.setLineDash([]);
        if (isSel) {
          v.wps.forEach((w, i) => {
            const [wx, wy] = w2s(w.x, w.y);
            ctx.fillStyle = i < v.wpIdx ? css('--muted') : v.m.color;
            ctx.beginPath(); ctx.arc(wx, wy, 6, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#000'; ctx.font = 'bold 9px ' + F; ctx.textAlign = 'center';
            ctx.fillText(String(i + 1), wx, wy + 3); ctx.textAlign = 'left';
          });
        }
      }
      // 추정 위치 불확도(GNSS 교란)
      const ep = G.estPos(v);
      const [ex, ey] = w2s(ep.x, ep.y);
      if (v.faults.gnss) {
        ctx.strokeStyle = '#faad14'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(ex, ey, Math.max(6, v.est.unc * view.scale), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
      // 선체 아이콘(추정 위치에 표시 — 운용자가 보는 값)
      const len = Math.max(14, v.m.lengthM * view.scale * 6);
      ctx.save(); ctx.translate(ex, ey); ctx.rotate(v.hdg * D2R);
      ctx.beginPath();
      ctx.moveTo(0, -len / 2); ctx.lineTo(len * 0.28, -len * 0.1); ctx.lineTo(len * 0.25, len / 2);
      ctx.lineTo(-len * 0.25, len / 2); ctx.lineTo(-len * 0.28, -len * 0.1); ctx.closePath();
      ctx.fillStyle = v.m.color; ctx.fill();
      ctx.strokeStyle = isSel ? '#fff' : 'rgba(0,0,0,0.6)'; ctx.lineWidth = isSel ? 2 : 1; ctx.stroke();
      if (v.spd > 0.2) {
        ctx.strokeStyle = v.m.color; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, -len / 2); ctx.lineTo(0, -len / 2 - v.spd * 60 * view.scale); ctx.stroke();
      }
      ctx.restore();
      // 라벨
      const crit = Object.values(v.alarms).some((a) => a.level === 'crit');
      ctx.font = 'bold 11px ' + F;
      ctx.fillStyle = crit ? '#ff4d4f' : css('--fg');
      ctx.fillText(`${v.id} ${G.MODES[v.mode]}`, ex + len / 2 + 6, ey - 2);
      ctx.font = '10px ' + F; ctx.fillStyle = css('--muted');
      ctx.fillText(`${(v.spd * 1.944).toFixed(1)}kn · ${Math.round(v.soc * 100)}% · ${v.activeLink ? G.LINKS[v.activeLink].name : '링크 없음'}`, ex + len / 2 + 6, ey + 11);
      if (isSel) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.arc(ex, ey, len * 0.9 + 6, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
    });

    // 축척 막대
    const targetPx = 120;
    const raw = targetPx / view.scale;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const nice = [1, 2, 5, 10].map((k) => k * pow).find((k) => k >= raw) || raw;
    const px = nice * view.scale;
    ctx.fillStyle = css('--fg'); ctx.strokeStyle = css('--fg'); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(14, H - 18); ctx.lineTo(14 + px, H - 18); ctx.stroke();
    ctx.font = '11px ' + F;
    ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, 14, H - 24);

    if (G.cursor) {
      const t = G.fmtLatLon(G.cursor.x, G.cursor.y);
      ctx.textAlign = 'right'; ctx.fillStyle = css('--muted');
      ctx.fillText(t, W - 12, H - 12); ctx.textAlign = 'left';
    }
    if (view.wpEdit) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(W / 2 - 170, 10, 340, 26);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = '12px ' + F;
      ctx.fillText('경로점 편집: 좌클릭 추가 · 우클릭 마지막 점 삭제', W / 2, 27); ctx.textAlign = 'left';
    }
  };
})();
