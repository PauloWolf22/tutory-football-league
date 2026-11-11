// Sorteio e rodízio "quem ganha fica", dentro da página do jogo. Notas secretas e telão.
import { html, useState, useApp, useLoad, Dialog, act, Ava, toast, useLive } from '../ui.js';
import { drawTeams } from '../draw.js';

const MODE_LABEL = { balanced: 'Equilibrado', random: 'Aleatório', order: 'Por ordem de confirmação' };

export function RotationPanel({ match, people, onChange }) {
  const { api } = useApp();
  const q = useLoad(() => api.rpc('tfl_rotation_get', { p_match: match.id }), [match.id]);
  useLive(q.reload, (cb) => api.subscribe('rodizio', 'match_rotation', `match_id=eq.${match.id}`, cb), [match.id]);
  const [setup, setSetup] = useState(false);
  const [levels, setLevels] = useState(false);
  const [screen, setScreen] = useState(false);
  const [swapSel, setSwapSel] = useState(null);
  const [score, setScore] = useState({ a: '', b: '' });
  const [busy, setBusy] = useState(false);
  if (!q.data) return null;
  const r = q.data;
  const reload = () => { q.reload(); onChange?.(); };
  const finish = async (winner) => {
    setBusy(true);
    const ok = await act(() => api.rpc('tfl_round_finish', { p_match: match.id, p_winner: winner, p_score_a: score.a === '' ? null : +score.a, p_score_b: score.b === '' ? null : +score.b }),
      winner === 'draw' ? 'Empate registrado' : `Time ${winner} venceu. Próximos em campo!`);
    setBusy(false); if (ok) { setScore({ a: '', b: '' }); reload(); }
  };
  const tap = async (u) => {
    if (!swapSel) { setSwapSel(u); return; }
    if (swapSel !== u && await act(() => api.rpc('tfl_rotation_swap', { p_match: match.id, p_user1: swapSel, p_user2: u }), 'Jogadores trocados')) reload();
    setSwapSel(null);
  };
  const Player = (p) => html`<button class=${'tp' + (swapSel === p.user_id ? ' sel' : '')} key=${p.user_id} disabled=${!r.can_run || swapSel === false}
      onClick=${() => r.can_run && swapSel !== false && tap(p.user_id)}>
    <${Ava} path=${p.photo_path} name=${p.name || ''} size=${34} /><span>${p.name}</span>${r.can_run && p.level && html`<small title="nota secreta">${p.level}</small>`}</button>`;
  const open = match.status !== 'cancelled';

  return html`<section class="panel" style="margin-top:18px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <div><b style="font-size:18px">Sorteio e rodízio</b>
        <div class="small muted">${r.exists ? `Rodada ${r.round_no} · times de ${r.team_size} · ${MODE_LABEL[r.draw?.mode] || ''}` : `${r.confirmed} confirmados · quem ganha fica, os de fora esperam na fila`}</div></div>
      ${r.can_run && open && html`<div class="row-actions">
        <button class="btn sm" onClick=${() => setLevels(true)}>Notas</button>
        ${r.exists && html`<button class="btn sm" onClick=${() => setScreen(true)}>Telão</button>`}
        <button class=${'btn sm ' + (r.exists ? '' : 'primary')} onClick=${() => setSetup(true)}>${r.exists ? 'Novo sorteio' : 'Sortear times'}</button></div>`}
    </div>
    ${!r.exists && html`<p class="small muted" style="margin-top:10px">${r.can_run ? 'Quando a lista fechar, sorteie os times. Os primeiros confirmados entram em campo; os demais esperam na ordem.' : 'O organizador ainda não sorteou os times.'}</p>`}
    ${r.exists && html`
      ${r.can_run && r.draw?.balance && html`<div class="small muted" style="margin-top:8px">Equilíbrio pelas notas: A ${r.draw.balance.pct_a}% × B ${100 - r.draw.balance.pct_a}%</div>`}
      <div class="teams">
        <div class="team team-a"><div class="team-head"><b>Time A</b>${r.streak.A > 0 && html`<span class="badge">${r.streak.A} rodada(s) em campo</span>`}</div>${r.teams.A.map(Player)}</div>
        <div class="team team-b"><div class="team-head"><b>Time B</b>${r.streak.B > 0 && html`<span class="badge">${r.streak.B} rodada(s) em campo</span>`}</div>${r.teams.B.map(Player)}</div>
      </div>
      ${r.queue.length > 0 && html`<div class="queue"><b class="small">Fila (próximos a entrar)</b><div>${r.queue.map(Player)}</div></div>`}
      ${r.can_run && open && html`<div class="round-actions">
        <div class="score"><input inputmode="numeric" aria-label="Gols do time A" placeholder="A" value=${score.a} onInput=${(e) => { const a = e.target.value.replace(/\D/g, '').slice(0, 2); setScore((s) => ({ ...s, a })); }} />
          <span>×</span><input inputmode="numeric" aria-label="Gols do time B" placeholder="B" value=${score.b} onInput=${(e) => { const b = e.target.value.replace(/\D/g, '').slice(0, 2); setScore((s) => ({ ...s, b })); }} /></div>
        <button class="btn primary big" aria-busy=${busy} onClick=${() => finish('A')}>A venceu</button>
        <button class="btn big" aria-busy=${busy} onClick=${() => finish('draw')}>Empate</button>
        <button class="btn primary big" aria-busy=${busy} onClick=${() => finish('B')}>B venceu</button>
      </div>
      <div class="row-actions" style="justify-content:flex-start;margin-top:10px">
        <button class="btn sm" onClick=${async () => { if (await act(() => api.rpc('tfl_rotation_sync', { p_match: match.id }), 'Rodízio atualizado com a lista')) reload(); }}>Atualizar com a lista</button>
        ${r.rounds.length > 0 && html`<button class="btn sm" onClick=${async () => { if (await act(() => api.rpc('tfl_round_undo', { p_match: match.id }), 'Última rodada desfeita')) reload(); }}>Desfazer última rodada</button>`}
        <span class="small muted">${swapSel ? 'Agora toque em quem vai trocar de lugar.' : 'Para trocar dois jogadores, toque em um e depois no outro.'}</span>
      </div>`}
      ${r.rounds.length > 0 && html`<details style="margin-top:12px"><summary class="small muted">Rodadas jogadas (${r.rounds.length})</summary>
        <div class="list" style="margin-top:8px">${r.rounds.map((x) => html`<div class="item" key=${x.round_no}><b>Rodada ${x.round_no}</b>
          <span class="grow">${x.winner === 'draw' ? 'Empate' : `Time ${x.winner} venceu`}${x.score_a != null ? ` · ${x.score_a} × ${x.score_b}` : ''}</span></div>`)}</div></details>`}`}
    <${DrawSetup} match=${match} people=${people} confirmed=${r.confirmed} open=${setup} onClose=${() => setSetup(false)} onDone=${() => { setSetup(false); reload(); }} />
    <${LevelsDialog} match=${match} open=${levels} onClose=${() => setLevels(false)} />
    <${ScreenDialog} match=${match} people=${people} open=${screen} onClose=${() => setScreen(false)} />
  </section>`;
}

function DrawSetup({ match, people, confirmed, open, onClose, onDone }) {
  const { api } = useApp();
  const [mode, setMode] = useState('balanced');
  const [n, setN] = useState(Math.min(5, Math.floor(confirmed / 2)) || 5);
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState('');
  const close = () => { setPreview(null); setErr(''); onClose(); };
  const run = async () => {
    setErr('');
    try {
      let lv = {};
      if (mode === 'balanced') { const l = await api.rpc('tfl_levels_get', { p_match: match.id }); l.levels.forEach((x) => { lv[x.user_id] = x.level; }); }
      // Confirmados na ordem de confirmação (a página do jogo já lista assim).
      const conf = people.filter((p) => p.status === 'confirmed').map((p) => ({ ...p, level: lv[p.user_id] ?? null }));
      setPreview(drawTeams(conf, n, mode));
    } catch (e) { setErr(e.message); }
  };
  const save = async () => {
    if (await act(() => api.rpc('tfl_draw_save', { p_match: match.id, p_mode: mode, p_team_a: preview.A.map((p) => p.user_id), p_team_b: preview.B.map((p) => p.user_id), p_seed: preview.seed }), 'Times sorteados!')) { setPreview(null); onDone(); }
  };
  const max = Math.max(2, Math.min(11, Math.floor(confirmed / 2)));
  return html`<${Dialog} open=${open} onClose=${close} label="Sortear times">
    <h3>Sortear times</h3>
    <p class="small muted">${confirmed} confirmados. Entram em campo os primeiros ${2 * n}; os demais vão para a fila, na ordem de confirmação.</p>
    <div class="seg" style="grid-template-columns:repeat(3,1fr);margin:0">${Object.entries(MODE_LABEL).map(([k, l]) => html`<button class=${mode === k ? 'on' : ''} onClick=${() => { setMode(k); setPreview(null); }}>${k === 'order' ? 'Por ordem' : l}</button>`)}</div>
    <p class="small muted">${mode === 'balanced' ? 'Usa as notas secretas (1 a 5) e sorteia entre as divisões mais equilibradas.' : mode === 'random' ? 'Sorteio puro, sem considerar nível.' : 'Time A: os primeiros a confirmar; Time B: os seguintes.'}</p>
    <label class="field">Jogadores por time<input type="number" min="2" max=${max} value=${n} onInput=${(e) => { setN(Math.max(2, Math.min(max, +e.target.value || 2))); setPreview(null); }} /></label>
    ${preview && html`<div class="teams">
      <div class="team team-a"><div class="team-head"><b>Time A</b>${mode === 'balanced' && html`<span class="badge">${preview.balance.pct_a}%</span>`}</div>${preview.A.map((p) => html`<div class="tp"><${Ava} path=${p.photo_path} name=${p.name || ''} size=${28} /><span>${p.name}</span></div>`)}</div>
      <div class="team team-b"><div class="team-head"><b>Time B</b>${mode === 'balanced' && html`<span class="badge">${100 - preview.balance.pct_a}%</span>`}</div>${preview.B.map((p) => html`<div class="tp"><${Ava} path=${p.photo_path} name=${p.name || ''} size=${28} /><span>${p.name}</span></div>`)}</div>
    </div>`}
    <div class="form-error" role="alert">${err}</div>
    <div class="form-actions">
      <button class="btn" onClick=${close}>Cancelar</button>
      <button class="btn" onClick=${run}>${preview ? 'Refazer' : 'Sortear'}</button>
      ${preview && html`<button class="btn primary" onClick=${save}>Usar estes times</button>`}
    </div>
  <//>`;
}

function LevelsDialog({ match, open, onClose }) {
  const { api } = useApp();
  const q = useLoad(() => (open ? api.rpc('tfl_levels_get', { p_match: match.id }) : Promise.resolve(null)), [open]);
  const set = async (u, level) => { if (await act(() => api.rpc('tfl_level_set', { p_match: match.id, p_user: u, p_level: level }))) q.reload(); };
  return html`<${Dialog} open=${open} onClose=${onClose} label="Notas dos jogadores">
    <h3>Notas dos jogadores</h3>
    <p class="small muted">De 1 (iniciante) a 5 (muito acima da média). <b>Só quem organiza vê.</b> Usadas no sorteio equilibrado; sem nota, vale 3.</p>
    ${q.error && html`<p class="form-error">${q.error}</p>`}
    <div class="list" style="max-height:60vh;overflow:auto">${(q.data?.levels || []).map((p) => html`<div class="item" key=${p.user_id}>
      <${Ava} path=${p.photo_path} name=${p.name || ''} size=${32} /><span class="grow">${p.name}</span>
      <div class="stars" role="radiogroup" aria-label=${'Nota de ' + p.name}>${[1, 2, 3, 4, 5].map((v) => html`<button role="radio" aria-checked=${p.level === v}
        class=${p.level >= v ? 'on' : ''} onClick=${() => set(p.user_id, p.level === v ? null : v)} aria-label=${v + ' de 5'}>★</button>`)}</div></div>`)}</div>
    <div class="form-actions"><button class="btn primary" onClick=${onClose}>Pronto</button></div>
  <//>`;
}

// Abre o telão: gera as URLs das fotos (o banco guarda só as de quem autorizou) e mostra o link.
function ScreenDialog({ match, people, open, onClose }) {
  const { api } = useApp();
  const [link, setLink] = useState(null); const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const photos = {};
      for (const p of people.filter((x) => x.photo_path && x.status === 'confirmed')) {
        const { data } = await api.client.storage.from('player-photos').createSignedUrl(p.photo_path, 12 * 3600);
        if (data?.signedUrl) photos[p.user_id] = data.signedUrl;
      }
      const r = await api.rpc('tfl_display_open', { p_match: match.id, p_photos: photos, p_hours: 12 });
      setLink(`${location.origin}${location.pathname}${api.env === 'mock' ? '?mock=1' : api.env === 'dev' ? '?env=dev' : ''}#/telao/${r.token}`);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link); toast('Link copiado'); } catch { toast('Não deu para copiar: selecione o link e copie', 'error'); } };
  return html`<${Dialog} open=${open} onClose=${() => { setLink(null); onClose(); }} label="Telão">
    <h3>Telão do sorteio</h3>
    <p class="small muted">Abra o link na TV ou no computador ligado ao telão. Não precisa de login. Mostra só o primeiro nome e a foto de quem autorizou; menores de idade aparecem sem foto. O link vale por 12 horas. Este celular continua sendo o controle.</p>
    ${!link ? html`<button class="btn primary" aria-busy=${busy} onClick=${create}>Gerar link do telão</button>` : html`
      <div class="field"><input readonly value=${link} onFocus=${(e) => e.target.select()} /></div>
      <div class="row-actions" style="justify-content:flex-start"><button class="btn primary" onClick=${() => window.open(link, '_blank')}>Abrir telão</button>
        <button class="btn" onClick=${copy}>Copiar link</button>
        <button class="btn danger" onClick=${async () => { if (await act(() => api.rpc('tfl_display_close', { p_match: match.id }), 'Telões deste jogo encerrados')) setLink(null); }}>Encerrar telões</button></div>`}
  <//>`;
}
