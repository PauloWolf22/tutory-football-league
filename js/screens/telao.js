// Telão (sem login): times, fila e último resultado. Atualiza sozinho a cada 3 s.
// Num sorteio novo, revela os jogadores um a um. Só primeiro nome e foto autorizada.
import { html, useState, useEffect, useRef, fmtDay, fmtTime } from '../ui.js';
import { PRODUCT } from '../config.js';

export function TelaoPage({ api, token }) {
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');
  const [reveal, setReveal] = useState(0);      // quantos jogadores já apareceram no sorteio atual
  const lastDraw = useRef(null);
  const lastVersion = useRef(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const d = await api.rpc('tfl_display_state', { p_token: token });
        if (!live) return;
        setErr(''); setS(d);
        const r = d.rotation;
        if (r && r.draw_id !== lastDraw.current) {
          const first = lastDraw.current === null; lastDraw.current = r.draw_id;
          if (first) setReveal(999); else { setReveal(0); }
        } else if (r && lastVersion.current !== null && r.version !== lastVersion.current) { setFlash(true); setTimeout(() => setFlash(false), 2200); }
        if (r) lastVersion.current = r.version;
      } catch (e) { if (live) setErr(e.message); }
    };
    load(); const t = setInterval(load, 3000);
    return () => { live = false; clearInterval(t); };
  }, [token]);

  // Animação da revelação: um jogador a cada 0,7 s, alternando os times.
  useEffect(() => {
    if (!s?.rotation || reveal >= 999) return;
    const total = s.rotation.A.length + s.rotation.B.length;
    if (reveal >= total) return;
    const t = setTimeout(() => setReveal((x) => x + 1), reveal === 0 ? 900 : 700);
    return () => clearTimeout(t);
  }, [reveal, s?.rotation?.draw_id]);

  const full = () => { const el = document.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el); };

  if (err) return html`<div class="telao"><div class="telao-msg"><img src="assets/logo-branco.png" alt="" /><h1>Telão indisponível</h1><p>${err}</p></div></div>`;
  if (!s) return html`<div class="telao"><div class="telao-msg"><p>Carregando…</p></div></div>`;
  const r = s.rotation;
  // Ordem da revelação: A1, B1, A2, B2...
  const order = r ? r.A.flatMap((p, i) => [['A', i], ['B', i]]).filter(([t, i]) => (t === 'A' ? r.A : r.B)[i]) : [];
  const shown = (team, i) => reveal >= 999 || order.findIndex(([t, j]) => t === team && j === i) < reveal;
  const Tile = (p, team, i) => html`<div class=${'tt' + (shown(team, i) ? ' in' : '')} key=${team + i}>
    ${p.photo ? html`<img src=${p.photo} alt="" />` : html`<span>${(p.name || '?')[0]}</span>`}<b>${p.name}</b></div>`;
  return html`<div class=${'telao' + (flash ? ' flash' : '')}>
    <header>
      <img src="assets/logo-branco.png" alt="" />
      <div><b>${s.group}</b><span>${s.org} · ${fmtDay(s.starts_at)} · ${fmtTime(s.starts_at)} · ${s.place}</span></div>
      ${r && html`<em>Rodada ${r.round_no}</em>`}
    </header>
    ${!r ? html`<div class="telao-msg"><h1>${s.confirmed} confirmados</h1><p>O sorteio dos times aparece aqui.</p></div>` : html`
      <main>
        <section class="ta"><h2>Time A</h2><div class="tgrid">${r.A.map((p, i) => Tile(p, 'A', i))}</div></section>
        <div class="vs">VS${r.last && html`<small>Rodada ${r.last.round_no}: ${r.last.winner === 'draw' ? 'empate' : 'venceu o ' + r.last.winner}${r.last.score_a != null ? ` (${r.last.score_a} × ${r.last.score_b})` : ''}</small>`}</div>
        <section class="tb"><h2>Time B</h2><div class="tgrid">${r.B.map((p, i) => Tile(p, 'B', i))}</div></section>
      </main>
      <footer>${r.queue.length ? html`<b>Próximos:</b> ${r.queue.join(' · ')}` : html`<span>Sem fila: todos em campo</span>`}</footer>`}
    <button class="telao-full" onClick=${full}>Tela cheia</button>
    <div class="telao-brand">${PRODUCT.name}</div>
  </div>`;
}
