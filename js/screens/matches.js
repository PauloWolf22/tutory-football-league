// Grupos (convite pelo organizador) e jogos (marcar, presença por ordem de confirmação, lista de espera ao vivo).
import { html, useState, useApp, useLoad, Loading, ErrorBox, Dialog, useConfirm, act, go, href, Ava, money, fmtDay, fmtTime, fmtWhen,
  localToIso, todayStr, BOOKING_LABEL, BOOKING_CLASS, RSVP_LABEL, RSVP_CLASS, useLive, toast } from '../ui.js';
import { RotationPanel } from './rotation.js';

// ---------------------------------------------------------------- Grupos (aba da empresa)
export function GroupsTab({ slug }) {
  const { api } = useApp();
  const q = useLoad(() => api.rpc('tfl_groups_list', { p_org: slug }), [slug]);
  const [creating, setCreating] = useState(false);
  if (q.loading && !q.data) return html`<${Loading} />`;
  if (q.error) return html`<${ErrorBox} message=${q.error} onRetry=${q.reload} />`;
  return html`
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <p class="muted small">Cada grupo tem seus jogadores, convidados pelo organizador.</p>
      ${q.data.can_create && html`<button class="btn primary" onClick=${() => setCreating(true)}>Novo grupo</button>`}
    </div>
    ${q.data.groups.length === 0 ? html`<div class="empty"><b>Nenhum grupo</b>${q.data.can_create ? 'Crie o primeiro (ex.: "Futebol de terça").' : 'Você ainda não participa de nenhum grupo desta liga.'}</div>` : html`
    <div class="grid two">${q.data.groups.map((g) => html`<a class="panel" key=${g.id} href=${href('grupo/' + g.id)} style="text-decoration:none;color:inherit;display:block">
      <div style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:17px">${g.name}</b>
        ${g.my_status === 'invited' ? html`<span class="badge pending">convite</span>` : g.can_manage ? html`<span class="badge blue">você organiza</span>` : ''}</div>
      <div class="small muted" style="margin-top:6px">${g.members} jogadores${g.invited ? ` · ${g.invited} convidados` : ''} · ${g.default_venue || g.default_location || 'local a definir'}</div>
      <div class="small" style="margin-top:10px">${g.next_match ? html`Próximo jogo: <b>${fmtWhen(g.next_match.starts_at)}</b>` : html`<span class="muted">Sem jogo marcado</span>`}</div>
    </a>`)}</div>`}
    <${GroupEditor} slug=${slug} open=${creating} onClose=${() => setCreating(false)} onDone=${(id) => { setCreating(false); go('grupo/' + id); }} />
  `;
}

function GroupEditor({ slug, open, group, onClose, onDone }) {
  const { api } = useApp();
  const venues = useLoad(() => (open ? api.rpc('tfl_venues_list', { p_org: slug }) : Promise.resolve(null)), [open, slug]);
  const [v, setV] = useState(null); const [err, setErr] = useState('');
  if (open && !v) setV({ name: group?.name || '', venue: group?.default_venue_id || '', location: group?.default_location || '', capacity: group?.default_capacity || 14 });
  const close = () => { setV(null); setErr(''); onClose(); };
  const save = async (e) => {
    e.preventDefault(); setErr('');
    try { const r = await api.rpc('tfl_group_save', { p_org: slug, p_id: group?.id || null, p_name: v.name, p_default_venue: v.venue || null, p_default_location: v.location, p_default_capacity: +v.capacity }); setV(null); onDone(r.id); }
    catch (ex) { setErr(ex.message); }
  };
  const list = (venues.data?.venues || []).filter((x) => x.status === 'active');
  return html`<${Dialog} open=${open} onClose=${close} label="Grupo">
    ${v && html`<h3>${group ? 'Editar grupo' : 'Novo grupo'}</h3>
    <form class="form" onSubmit=${save}>
      <label class="field">Nome<input value=${v.name} onInput=${(e) => setV({ ...v, name: e.target.value })} maxlength="60" placeholder="Futebol de terça" /></label>
      ${list.length > 0 && html`<label class="field">Campo padrão (opcional)<select value=${v.venue} onChange=${(e) => setV({ ...v, venue: e.target.value })}>
        <option value="">Nenhum (local livre)</option>${list.map((x) => html`<option value=${x.id}>${x.name}</option>`)}</select></label>`}
      ${!v.venue && html`<label class="field">Local padrão<input value=${v.location} onInput=${(e) => setV({ ...v, location: e.target.value })} maxlength="120" placeholder="Ex.: Quadra do condomínio" /></label>`}
      <label class="field">Vagas por jogo<input type="number" min="2" max="60" value=${v.capacity} onInput=${(e) => setV({ ...v, capacity: e.target.value })} /></label>
      <div class="form-error" role="alert">${err}</div>
      <div class="form-actions"><button type="button" class="btn" onClick=${close}>Cancelar</button><button class="btn primary">Salvar grupo</button></div>
    </form>`}
  <//>`;
}

// ---------------------------------------------------------------- Página do grupo
export function GroupPage({ id }) {
  const { api } = useApp();
  const q = useLoad(() => api.rpc('tfl_group_get', { p_group: id }), [id]);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [ask, confirmNode] = useConfirm();
  useLive(q.reload, (cb) => api.subscribe('grupo', 'group_members', `group_id=eq.${id}`, cb), [id]);
  if (q.loading && !q.data) return html`<${Loading} />`;
  if (q.error) return html`<div class="empty"><b>Sem acesso</b>${q.error}</div>`;
  const g = q.data;
  const remove = async (m) => {
    const ok = await ask({ title: `Tirar ${m.name} do grupo?`, body: 'A pessoa deixa de receber os convites dos próximos jogos.', confirmLabel: 'Tirar', danger: true });
    if (ok && await act(() => api.rpc('tfl_group_remove', { p_group: id, p_user: m.user_id }), 'Membro retirado')) q.reload();
  };
  const active = g.members.filter((m) => m.status === 'active');
  const invited = g.members.filter((m) => m.status === 'invited');
  return html`
    <div class="page-head"><div>
      <div class="eyebrow"><a href=${href('o/' + g.org_slug + '/grupos')}>← Grupos</a></div>
      <h1>${g.name}</h1><p>${active.length} jogadores · ${g.default_venue || g.default_location || 'local padrão a definir'} · ${g.default_capacity} vagas por jogo</p>
    </div><div class="row-actions">
      ${g.can_match && html`<button class="btn primary" onClick=${() => setCreating(true)}>Marcar jogo</button>`}
      ${g.can_manage && html`<button class="btn" onClick=${() => setInviting(true)}>Convidar</button><button class="btn" onClick=${() => setEditing(true)}>Editar</button>`}
    </div></div>
    <${GroupMatches} slug=${g.org_slug} groupId=${id} />
    <h2 class="section-title">Jogadores</h2>
    <div class="list">${active.map((m) => html`<div class="item" key=${m.user_id}>
      <${Ava} path=${m.photo_path} name=${m.name} size=${40} /><div class="grow"><div class="title">${m.name}</div></div>
      ${g.can_manage && html`<button class="btn sm" onClick=${() => remove(m)}>Tirar</button>`}</div>`)}</div>
    ${invited.length > 0 && html`<h2 class="section-title">Convidados (ainda não aceitaram)</h2>
      <div class="list">${invited.map((m) => html`<div class="item" key=${m.user_id}><${Ava} path=${m.photo_path} name=${m.name} size=${36} />
        <div class="grow"><div class="title">${m.name}</div></div><span class="badge pending">convite enviado</span></div>`)}</div>`}
    <${InviteDialog} group=${g} open=${inviting} onClose=${() => setInviting(false)} onDone=${() => { setInviting(false); q.reload(); }} />
    <${GroupEditor} slug=${g.org_slug} group=${g} open=${editing} onClose=${() => setEditing(false)} onDone=${() => { setEditing(false); q.reload(); }} />
    <${MatchCreate} slug=${g.org_slug} group=${g} open=${creating} onClose=${() => setCreating(false)} onDone=${(mid) => { setCreating(false); go('jogo/' + mid); }} />
    ${confirmNode}
  `;
}

function GroupMatches({ slug, groupId }) {
  const { api } = useApp();
  const from = new Date(Date.now() - 3 * 3600e3).toISOString(), to = new Date(Date.now() + 60 * 864e5).toISOString();
  const q = useLoad(() => api.rpc('tfl_matches_list', { p_org: slug, p_from: from, p_to: to }), [slug, groupId]);
  const list = (q.data?.matches || []).filter((m) => m.group_id === groupId && m.status !== 'cancelled');
  if (!list.length) return null;
  return html`<h2 class="section-title">Próximos jogos</h2><div class="list">${list.map((m) => html`<${MatchRow} m=${m} key=${m.id} />`)}</div>`;
}

function InviteDialog({ group, open, onClose, onDone }) {
  const { api } = useApp();
  const q = useLoad(() => (open ? api.rpc('tfl_org_members', { p_org: group.org_slug }) : Promise.resolve(null)), [open]);
  const [sel, setSel] = useState([]);
  const inGroup = new Set(group.members.map((m) => m.user_id));
  const options = (q.data?.members || []).filter((m) => m.status === 'approved' && !inGroup.has(m.user_id));
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const send = async () => { if (await act(() => api.rpc('tfl_group_invite', { p_group: group.id, p_users: sel }), `${sel.length} convite(s) enviado(s)`)) { setSel([]); onDone(); } };
  return html`<${Dialog} open=${open} onClose=${() => { setSel([]); onClose(); }} label="Convidar">
    <h3>Convidar para ${group.name}</h3>
    <p class="small muted">Só membros aprovados da liga. Cada um recebe um aviso e aceita para entrar.</p>
    ${q.loading ? html`<${Loading} />` : options.length === 0 ? html`<p class="muted">Todos os membros aprovados já estão no grupo.</p>` : html`
      <div class="list" style="max-height:340px;overflow:auto">${options.map((m) => html`<label class="item check" key=${m.user_id} style="cursor:pointer">
        <input type="checkbox" checked=${sel.includes(m.user_id)} onChange=${() => toggle(m.user_id)} /><${Ava} path=${m.photo_path} name=${m.name} size=${32} />
        <span class="grow">${m.nick || m.name}</span></label>`)}</div>`}
    <div class="form-actions"><button class="btn" onClick=${() => { setSel([]); onClose(); }}>Cancelar</button>
      <button class="btn primary" disabled=${!sel.length} onClick=${send}>Convidar ${sel.length || ''}</button></div>
  <//>`;
}

// ---------------------------------------------------------------- Marcar jogo
export function MatchCreate({ slug, group, open, onClose, onDone }) {
  const { api } = useApp();
  const venues = useLoad(() => (open ? api.rpc('tfl_venues_list', { p_org: slug }) : Promise.resolve(null)), [open, slug]);
  const [v, setV] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  if (open && !v) setV({ date: todayStr(1), time: '20:00', minutes: 60, capacity: group.default_capacity, venue: group.default_venue_id || '', location: group.default_location || '', notes: '' });
  const list = (venues.data?.venues || []).filter((x) => x.status === 'active');
  const venue = list.find((x) => x.id === v?.venue);
  const fee = venues.data?.fee_pct ?? 6;
  const price = venue ? Math.round(venue.price_per_hour_cents * v.minutes / 60) : 0;
  const close = () => { setV(null); setErr(''); onClose(); };
  const save = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const r = await api.rpc('tfl_match_create', { p_org: slug, p_group: group.id, p_starts_at: localToIso(v.date, v.time), p_minutes: +v.minutes,
        p_capacity: +v.capacity, p_venue: v.venue || null, p_location: v.venue ? null : v.location, p_notes: v.notes });
      toast(venue ? 'Jogo marcado. O horário fica segurado até o campo confirmar.' : 'Jogo marcado e convites enviados');
      setV(null); onDone(r.id);
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return html`<${Dialog} open=${open} onClose=${close} label="Marcar jogo">
    ${v && html`<h3>Marcar jogo · ${group.name}</h3>
    <form class="form" onSubmit=${save}>
      <div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:10px">
        <label class="field">Dia<input type="date" min=${todayStr()} value=${v.date} onInput=${(e) => setV({ ...v, date: e.target.value })} /></label>
        <label class="field">Início<input type="time" step="1800" value=${v.time} onInput=${(e) => setV({ ...v, time: e.target.value })} /></label>
        <label class="field">Duração<select value=${v.minutes} onChange=${(e) => setV({ ...v, minutes: +e.target.value })}><option value="60">1 h</option><option value="90">1 h 30</option><option value="120">2 h</option></select></label>
      </div>
      ${list.length > 0 && html`<label class="field">Campo da empresa<select value=${v.venue} onChange=${(e) => setV({ ...v, venue: e.target.value })}>
        <option value="">Outro local (sem reserva)</option>${list.map((x) => html`<option value=${x.id}>${x.name}</option>`)}</select></label>`}
      ${venue ? html`<div class="panel" style="padding:12px 14px"><div class="small muted">Reserva do ${venue.name}</div>
          <div>${money(price)} + ${money(Math.round(price * fee / 100))} do app = <b style="color:var(--beam)">${money(price + Math.round(price * fee / 100))}</b></div>
          <div class="small muted">O horário fica segurado até a empresa confirmar (até 24 h).</div></div>`
        : html`<label class="field">Local<input value=${v.location} onInput=${(e) => setV({ ...v, location: e.target.value })} maxlength="120" placeholder="Ex.: Quadra do condomínio" /></label>`}
      <label class="field">Vagas<input type="number" min="2" max=${venue?.capacity_players || 60} value=${v.capacity} onInput=${(e) => setV({ ...v, capacity: e.target.value })} />
        <span class="hint">Quem confirmar depois de lotar vai para a lista de espera, por ordem.</span></label>
      <label class="field">Observação (opcional)<textarea value=${v.notes} maxlength="500" onInput=${(e) => setV({ ...v, notes: e.target.value })} placeholder="Ex.: levar colete escuro"></textarea></label>
      <div class="form-error" role="alert">${err}</div>
      <div class="form-actions"><button type="button" class="btn" onClick=${close}>Cancelar</button><button class="btn primary" aria-busy=${busy ? 'true' : 'false'}>Marcar e convidar o grupo</button></div>
    </form>`}
  <//>`;
}

// ---------------------------------------------------------------- Jogos (aba da empresa)
const Bar = ({ c, cap }) => html`<div style="display:flex;align-items:center;gap:8px;min-width:150px">
  <div style="flex:1;height:8px;border-radius:9px;background:rgba(255,255,255,.07);overflow:hidden"><i style=${`display:block;height:100%;width:${Math.min(100, (c / cap) * 100)}%;background:${c >= cap ? 'var(--ok)' : 'var(--electric)'}`}></i></div>
  <b class="small">${c}/${cap}</b></div>`;

function MatchRow({ m }) {
  return html`<a class="item" href=${href('jogo/' + m.id)} style="text-decoration:none;color:inherit">
    <div style="text-align:center;min-width:64px"><div class="small muted">${fmtDay(m.starts_at)}</div><div style="font:800 20px Gilroy">${fmtTime(m.starts_at)}</div></div>
    <div class="grow"><div class="title">${m.group}</div>
      <div class="sub"><span>${m.venue || m.location}</span>
        ${m.status === 'cancelled' ? html`<span class="badge danger">cancelado</span>` : m.status === 'closed' ? html`<span class="badge">lista fechada</span>` : ''}
        ${m.booking_status && m.status !== 'cancelled' && html`<span class=${'badge ' + BOOKING_CLASS[m.booking_status]}>campo: ${BOOKING_LABEL[m.booking_status].toLowerCase()}</span>`}
        ${m.waitlist > 0 && html`<span>${m.waitlist} na espera</span>`}${m.pending > 0 && html`<span>${m.pending} sem resposta</span>`}</div></div>
    <${Bar} c=${m.confirmed} cap=${m.capacity} /></a>`;
}

export function MatchesTab({ slug }) {
  const { api } = useApp();
  const from = new Date(Date.now() - 3 * 3600e3).toISOString(), to = new Date(Date.now() + 60 * 864e5).toISOString();
  const q = useLoad(() => api.rpc('tfl_matches_list', { p_org: slug, p_from: from, p_to: to }), [slug]);
  const groups = useLoad(() => api.rpc('tfl_groups_list', { p_org: slug }), [slug]);
  useLive(q.reload, (cb) => api.subscribe('jogos', 'match_participants', null, cb), [slug]);
  const [pick, setPick] = useState(null);
  if (q.loading && !q.data) return html`<${Loading} />`;
  if (q.error) return html`<${ErrorBox} message=${q.error} onRetry=${q.reload} />`;
  const canCreate = (groups.data?.groups || []).filter((g) => g.can_match);
  return html`
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <p class="muted small">Próximos 60 dias. As listas atualizam sozinhas.</p>
      ${canCreate.length > 0 && html`<select class="btn primary" value="" onChange=${(e) => setPick(canCreate.find((g) => g.id === e.target.value))} aria-label="Marcar jogo">
        <option value="">Marcar jogo…</option>${canCreate.map((g) => html`<option value=${g.id}>${g.name}</option>`)}</select>`}
    </div>
    ${q.data.matches.length === 0 ? html`<div class="empty"><b>Nenhum jogo marcado</b>Os jogos dos grupos aparecem aqui com a lista ao vivo.</div>` : html`
      <div class="list">${q.data.matches.map((m) => html`<${MatchRow} m=${m} key=${m.id} />`)}</div>`}
    ${pick && html`<${MatchCreate} slug=${slug} group=${pick} open=${true} onClose=${() => setPick(null)} onDone=${(id) => { setPick(null); go('jogo/' + id); }} />`}
  `;
}

// ---------------------------------------------------------------- Página do jogo (ao vivo)
export function MatchPage({ id }) {
  const { api, me } = useApp();
  const q = useLoad(() => api.rpc('tfl_match_get', { p_match: id }), [id]);
  useLive(q.reload, (cb) => api.subscribe('jogo', 'match_participants', `match_id=eq.${id}`, cb), [id]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [ask, confirmNode] = useConfirm();
  if (q.loading && !q.data) return html`<${Loading} />`;
  if (q.error) return html`<div class="empty"><b>Sem acesso</b>${q.error}</div>`;
  const m = q.data;
  const rsvp = async (going) => {
    setBusy(true);
    try {
      const r = await api.rpc('tfl_match_rsvp', { p_match: id, p_going: going });
      toast(r.status === 'confirmed' ? 'Presença confirmada! 🔥' : r.status === 'waitlist' ? 'Lotou: você está na lista de espera' : 'Tudo bem, sua vaga foi liberada');
      q.reload();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const setPlayer = async (p, remove) => {
    if (remove && !(await ask({ title: `Tirar ${p.name} deste jogo?`, body: p.status === 'confirmed' ? 'A vaga passa para o primeiro da lista de espera.' : '', confirmLabel: 'Tirar', danger: true }))) return;
    if (await act(() => api.rpc('tfl_match_set_player', { p_match: id, p_user: p.user_id, p_remove: remove }), remove ? 'Jogador retirado' : 'Jogador recolocado')) q.reload();
  };
  const cancel = async () => {
    const reason = await ask({ title: 'Cancelar este jogo?', body: 'Todos recebem o aviso e o horário do campo é liberado.', reasonLabel: 'Motivo', confirmLabel: 'Cancelar jogo', danger: true });
    if (reason !== null && await act(() => api.rpc('tfl_match_cancel', { p_match: id, p_reason: reason }), 'Jogo cancelado')) q.reload();
  };
  const open = m.status === 'open' && new Date(m.starts_at) > new Date();
  const sec = (title, list, extra) => list.length > 0 && html`<h2 class="section-title">${title} <span class="muted small">${list.length}</span></h2>
    <div class="list">${list.map((p, i) => html`<div class="item" key=${p.user_id}>
      ${extra === 'num' && html`<b style="width:22px;text-align:right" class="muted">${i + 1}</b>`}${extra === 'wait' && html`<b style="width:22px;text-align:right;color:var(--beam)">${p.waitlist_pos}º</b>`}
      <${Ava} path=${p.photo_path} name=${p.name || ''} size=${40} />
      <div class="grow"><div class="title">${p.name}${p.user_id === me.id ? ' (você)' : ''}</div>
        <div class="sub">${p.responded_at && p.status !== 'invited' && html`<span>${p.status === 'declined' ? 'desistiu' : 'confirmou'} ${fmtWhen(p.responded_at)}</span>`}
          ${p.promoted_at && html`<span class="badge ok">subiu da espera</span>`}${p.status === 'removed' && html`<span class="badge danger">retirado</span>`}</div></div>
      ${m.can_manage && open && (p.status === 'removed' ? html`<button class="btn sm" onClick=${() => setPlayer(p, false)}>Recolocar</button>`
        : p.user_id !== me.id && p.status !== 'declined' && html`<button class="btn sm" onClick=${() => setPlayer(p, true)}>Tirar</button>`)}
    </div>`)}</div>`;
  const by = (s) => m.people.filter((p) => p.status === s);
  return html`
    <div class="page-head"><div>
      <div class="eyebrow"><a href=${href('grupo/' + m.group_id)}>← ${m.group}</a> · ${m.org}</div>
      <h1>${fmtDay(m.starts_at)} · ${fmtTime(m.starts_at)}</h1>
      <p>${m.venue || m.location} · até ${fmtTime(m.ends_at)}${m.notes ? ' · ' + m.notes : ''}</p>
      <p style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        ${m.status === 'cancelled' && html`<span class="badge danger">jogo cancelado</span>`}
        ${m.status === 'closed' && html`<span class="badge">lista fechada</span>`}
        ${m.booking && html`<span class=${'badge ' + BOOKING_CLASS[m.booking.status]}>campo: ${BOOKING_LABEL[m.booking.status].toLowerCase()}</span>`}
        ${m.booking?.total_cents != null && html`<span class="badge">${money(m.booking.price_cents)} + ${money(m.booking.fee_cents)} app = ${money(m.booking.total_cents)}</span>`}
      </p>
    </div>
    ${m.can_manage && m.status !== 'cancelled' && html`<div class="row-actions"><button class="btn" onClick=${() => setEditing(true)}>Vagas e lista</button><button class="btn danger" onClick=${cancel}>Cancelar jogo</button></div>`}
    </div>

    <div class="grid kpis">
      <div class="kpi accent"><span>Confirmados</span><b>${m.counts.confirmed}<small class="muted" style="font-size:16px"> / ${m.capacity}</small></b><small>${Math.max(0, m.capacity - m.counts.confirmed)} vagas livres</small></div>
      <div class="kpi"><span>Lista de espera</span><b>${m.counts.waitlist}</b></div>
      <div class="kpi ${m.counts.pending ? 'warn' : ''}"><span>Sem resposta</span><b>${m.counts.pending}</b></div>
      <div class="kpi"><span>Não vão</span><b>${m.counts.declined}</b></div>
    </div>

    ${m.me && open && html`<div class="panel" style="margin-top:16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <div class="grow" style="flex:1"><div class="small muted">Sua presença</div>
        <b>${RSVP_LABEL[m.me]}${m.me === 'waitlist' ? ` (${m.people.find((p) => p.user_id === me.id)?.waitlist_pos}º da fila)` : ''}</b></div>
      ${m.me !== 'confirmed' && m.me !== 'waitlist' && m.me !== 'removed' && html`<button class="btn primary" aria-busy=${busy ? 'true' : 'false'} onClick=${() => rsvp(true)} style="min-height:52px;padding:0 26px">Vou!</button>`}
      ${m.me !== 'declined' && m.me !== 'removed' && html`<button class="btn" aria-busy=${busy ? 'true' : 'false'} onClick=${() => rsvp(false)} style="min-height:52px">${m.me === 'invited' ? 'Não vou' : 'Desistir'}</button>`}
    </div>`}

    ${m.status !== 'cancelled' && html`<${RotationPanel} match=${m} people=${m.people} onChange=${q.reload} />`}

    ${sec('Confirmados', by('confirmed'), 'num')}
    ${sec('Lista de espera', by('waitlist'), 'wait')}
    ${sec('Sem resposta', by('invited'))}
    ${sec('Não vão', by('declined'))}
    ${m.can_manage && sec('Retirados', by('removed'))}
    <${MatchEditor} m=${m} open=${editing} onClose=${() => setEditing(false)} onDone=${() => { setEditing(false); q.reload(); }} />
    ${confirmNode}
  `;
}

function MatchEditor({ m, open, onClose, onDone }) {
  const { api } = useApp();
  const [v, setV] = useState(null); const [err, setErr] = useState('');
  if (open && !v) setV({ capacity: m.capacity, status: m.status, notes: m.notes || '' });
  const close = () => { setV(null); setErr(''); onClose(); };
  const save = async (e) => {
    e.preventDefault(); setErr('');
    try { const r = await api.rpc('tfl_match_update', { p_match: m.id, p_capacity: +v.capacity, p_status: v.status, p_notes: v.notes });
      if (r.promoted) toast(`${r.promoted} jogador(es) subiram da lista de espera`); setV(null); onDone(); }
    catch (ex) { setErr(ex.message); }
  };
  return html`<${Dialog} open=${open} onClose=${close} label="Vagas e lista">
    ${v && html`<h3>Vagas e lista</h3><form class="form" onSubmit=${save}>
      <label class="field">Vagas<input type="number" min="2" max="60" value=${v.capacity} onInput=${(e) => setV({ ...v, capacity: e.target.value })} />
        <span class="hint">Aumentar puxa a lista de espera na ordem. Para diminuir, tire confirmados antes.</span></label>
      <label class="field">Lista<select value=${v.status} onChange=${(e) => setV({ ...v, status: e.target.value })}>
        <option value="open">Aberta (aceita confirmações)</option><option value="closed">Fechada (ninguém entra nem sai)</option></select></label>
      <label class="field">Observação<textarea value=${v.notes} maxlength="500" onInput=${(e) => setV({ ...v, notes: e.target.value })}></textarea></label>
      <div class="form-error" role="alert">${err}</div>
      <div class="form-actions"><button type="button" class="btn" onClick=${close}>Cancelar</button><button class="btn primary">Salvar</button></div>
    </form>`}
  <//>`;
}
