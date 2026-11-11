// Campos (cadastro, preço e horários publicados) e Agenda (pedidos, confirmação pela empresa e reservas).
// Regras: o pedido fica segurado até a empresa confirmar (24 h); preço mostrado = hora + 6% do app.
import { html, useState, useApp, useLoad, Loading, ErrorBox, Dialog, useConfirm, act, money, WEEKDAYS, fmtDay, fmtTime, fmtWhen,
  localToIso, todayStr, BOOKING_LABEL, BOOKING_CLASS, useLive, href } from '../ui.js';

const hoursSummary = (hours) => {
  if (!hours.length) return 'Sem horários publicados';
  const by = {}; hours.forEach((h) => { (by[`${h.opens}–${h.closes === '00:00' ? '24:00' : h.closes}`] ||= []).push(WEEKDAYS[h.weekday]); });
  return Object.entries(by).map(([t, d]) => `${d.join(', ')} ${t}`).join(' · ');
};

// ---------------------------------------------------------------- Campos
export function VenuesTab({ slug }) {
  const { api } = useApp();
  const q = useLoad(() => api.rpc('tfl_venues_list', { p_org: slug }), [slug]);
  const [edit, setEdit] = useState(null);
  if (q.loading && !q.data) return html`<${Loading} />`;
  if (q.error) return html`<${ErrorBox} message=${q.error} onRetry=${q.reload} />`;
  const { venues, can_manage, fee_pct } = q.data;
  return html`
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <p class="muted small">O preço que o organizador vê é o valor da hora + ${String(fee_pct).replace('.', ',')}% do app.</p>
      ${can_manage && html`<button class="btn primary" onClick=${() => setEdit({ id: null, name: '', surface: '', capacity_players: 14, price_per_hour_cents: 0, status: 'active', hours: [] })}>Novo campo</button>`}
    </div>
    ${venues.length === 0 ? html`<div class="empty"><b>Nenhum campo cadastrado</b>${can_manage ? 'Cadastre o primeiro com preço e horários livres.' : 'A empresa ainda não publicou campos.'}</div>` : html`
    <div class="grid two">${venues.map((v) => html`<div class="panel" key=${v.id}>
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <div><b style="font-size:17px">${v.name}</b><div class="small muted">${v.surface || 'Piso não informado'} · até ${v.capacity_players} jogadores</div></div>
        ${v.status === 'inactive' ? html`<span class="badge">inativo</span>` : can_manage && html`<button class="btn sm" onClick=${() => setEdit(v)}>Editar</button>`}
      </div>
      <div style="display:flex;gap:18px;margin:14px 0 10px;flex-wrap:wrap">
        <div><span class="small muted">Hora do campo</span><div style="font:800 20px Gilroy">${money(v.price_per_hour_cents)}</div></div>
        <div><span class="small muted">Com a taxa do app</span><div style="font:800 20px Gilroy;color:var(--beam)">${money(v.price_with_fee_cents)}</div></div>
      </div>
      <p class="small muted">${hoursSummary(v.hours)}</p>
      ${can_manage && v.status === 'inactive' && html`<button class="btn sm" style="margin-top:10px" onClick=${() => setEdit(v)}>Editar</button>`}
    </div>`)}</div>`}
    <${VenueEditor} slug=${slug} venue=${edit} feePct=${fee_pct} onClose=${() => setEdit(null)} onDone=${() => { setEdit(null); q.reload(); }} />
  `;
}

function VenueEditor({ slug, venue, feePct, onClose, onDone }) {
  const { api } = useApp();
  const [v, setV] = useState(null);
  const [err, setErr] = useState('');
  if (venue && (!v || v._src !== venue)) {
    const days = WEEKDAYS.map((_, d) => { const h = venue.hours.find((x) => x.weekday === d); return { on: !!h, opens: h?.opens || '17:00', closes: h?.closes || '00:00' }; });
    setV({ _src: venue, id: venue.id, name: venue.name, surface: venue.surface || '', capacity: venue.capacity_players, price: (venue.price_per_hour_cents / 100).toFixed(2).replace('.', ','), status: venue.status, days });
  }
  const set = (patch) => setV((x) => ({ ...x, ...patch }));
  const setDay = (i, patch) => setV((x) => ({ ...x, days: x.days.map((d, j) => (j === i ? { ...d, ...patch } : d)) }));
  const cents = v ? Math.round(parseFloat(String(v.price).replace(/\./g, '').replace(',', '.') || '0') * 100) : 0;
  const save = async (e) => {
    e.preventDefault(); setErr('');
    try {
      await api.rpc('tfl_venue_save', { p_org: slug, p_id: v.id, p_name: v.name, p_surface: v.surface, p_capacity: +v.capacity,
        p_price_per_hour_cents: cents, p_status: v.status, p_hours: v.days.map((d, i) => (d.on ? { weekday: i, opens: d.opens, closes: d.closes } : null)).filter(Boolean) });
      setV(null); onDone();
    } catch (ex) { setErr(ex.message); }
  };
  const close = () => { setV(null); onClose(); };
  return html`<${Dialog} open=${!!venue} onClose=${close} label="Campo">
    ${v && html`<h3>${v.id ? 'Editar campo' : 'Novo campo'}</h3>
    <form class="form" onSubmit=${save}>
      <label class="field">Nome<input value=${v.name} onInput=${(e) => set({ name: e.target.value })} maxlength="60" placeholder="Ex.: Campo 1" /></label>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px">
        <label class="field">Piso<input value=${v.surface} onInput=${(e) => set({ surface: e.target.value })} maxlength="40" placeholder="Sintético" /></label>
        <label class="field">Jogadores (máx.)<input type="number" min="2" max="40" value=${v.capacity} onInput=${(e) => set({ capacity: e.target.value })} /></label>
      </div>
      <label class="field">Preço da hora (R$)<input inputmode="decimal" value=${v.price} onInput=${(e) => set({ price: e.target.value })} />
        <span class="hint">O organizador vê ${money(cents + Math.round(cents * feePct / 100))} (valor + ${String(feePct).replace('.', ',')}% do app). Você recebe ${money(cents)}.</span></label>
      <div><div class="small muted" style="margin-bottom:8px">Dias e horários livres para pedidos</div>
        ${v.days.map((d, i) => html`<div style="display:flex;align-items:center;gap:8px;margin:6px 0">
          <label class="check" style="width:70px"><input type="checkbox" checked=${d.on} onChange=${(e) => setDay(i, { on: e.target.checked })} /><span>${WEEKDAYS[i]}</span></label>
          <input type="time" class="btn sm" value=${d.opens} disabled=${!d.on} onInput=${(e) => setDay(i, { opens: e.target.value })} aria-label=${'Abre ' + WEEKDAYS[i]} />
          <span class="muted small">às</span>
          <input type="time" class="btn sm" value=${d.closes} disabled=${!d.on} onInput=${(e) => setDay(i, { closes: e.target.value })} aria-label=${'Fecha ' + WEEKDAYS[i]} />
        </div>`)}
        <span class="hint">00:00 no fechamento = meia-noite.</span></div>
      <label class="field">Situação<select value=${v.status} onChange=${(e) => set({ status: e.target.value })}>
        <option value="active">Ativo (aceita pedidos)</option><option value="inactive">Inativo (não aparece para pedidos)</option></select></label>
      <div class="form-error" role="alert">${err}</div>
      <div class="form-actions"><button type="button" class="btn" onClick=${close}>Cancelar</button><button class="btn primary">Salvar campo</button></div>
    </form>`}
  <//>`;
}

// ---------------------------------------------------------------- Agenda
export function AgendaTab({ slug }) {
  const { api } = useApp();
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(+from + 30 * 864e5);
  const q = useLoad(() => api.rpc('tfl_bookings_list', { p_org: slug, p_from: from.toISOString(), p_to: to.toISOString() }), [slug]);
  const venues = useLoad(() => api.rpc('tfl_venues_list', { p_org: slug }), [slug]);
  useLive(q.reload, (cb) => api.subscribe('agenda', 'bookings', null, cb), [slug]);
  const [asking, setAsking] = useState(false);
  const [ask, confirmNode] = useConfirm();
  if (q.loading && !q.data) return html`<${Loading} />`;
  if (q.error) return html`<${ErrorBox} message=${q.error} onRetry=${q.reload} />`;
  const { bookings, can_manage } = q.data;
  const pending = bookings.filter((b) => b.status === 'held');
  const rest = bookings.filter((b) => b.status !== 'held');
  const decide = async (b, approve) => {
    let note = '';
    if (!approve) { note = await ask({ title: 'Recusar este pedido?', body: `${b.venue} · ${fmtWhen(b.starts_at)}`, reasonLabel: 'Motivo (o organizador recebe)', confirmLabel: 'Recusar', danger: true }); if (note === null) return; }
    if (await act(() => api.rpc('tfl_booking_decide', { p_org: slug, p_booking: b.id, p_approve: approve, p_note: note }), approve ? 'Reserva confirmada' : 'Pedido recusado')) q.reload();
  };
  const cancel = async (b) => {
    const reason = await ask({ title: 'Cancelar esta reserva?', body: `${b.venue} · ${fmtWhen(b.starts_at)}`, reasonLabel: 'Motivo', confirmLabel: 'Cancelar reserva', danger: true });
    if (reason === null) return;
    if (await act(() => api.rpc('tfl_booking_cancel', { p_org: slug, p_booking: b.id, p_reason: reason }), 'Reserva cancelada')) q.reload();
  };
  const Row = (b) => html`<div class="item" key=${b.id}>
    <div style="text-align:center;min-width:64px"><div class="small muted">${fmtDay(b.starts_at)}</div><div style="font:800 20px Gilroy">${fmtTime(b.starts_at)}</div></div>
    <div class="grow"><div class="title">${b.venue}${b.group ? ' · ' + b.group : ''}</div>
      <div class="sub"><span class=${'badge ' + BOOKING_CLASS[b.status]}>${BOOKING_LABEL[b.status]}</span>
        ${b.requested_by && html`<span>${b.requested_by}</span>`}
        ${b.total_cents != null && html`<span title="valor do campo + taxa do app">${money(b.price_cents)} + ${money(b.fee_cents)} = <b>${money(b.total_cents)}</b></span>`}
        ${b.status === 'held' && b.hold_expires_at && html`<span>segurado até ${fmtWhen(b.hold_expires_at)}</span>`}
        ${b.decision_note && html`<span>“${b.decision_note}”</span>`}
        ${!b.requested_by && !b.mine && html`<span>horário ocupado</span>`}</div></div>
    <div class="row-actions">
      ${b.match_id && html`<a class="btn sm" href=${href('jogo/' + b.match_id)}>Ver jogo</a>`}
      ${can_manage && b.status === 'held' && html`<button class="btn sm primary" onClick=${() => decide(b, true)}>Confirmar</button><button class="btn sm danger" onClick=${() => decide(b, false)}>Recusar</button>`}
      ${(can_manage || b.mine) && ['held', 'confirmed'].includes(b.status) && !(can_manage && b.status === 'held') && html`<button class="btn sm" onClick=${() => cancel(b)}>Cancelar</button>`}
    </div></div>`;
  return html`
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <p class="muted small">Próximos 30 dias. ${can_manage ? 'Pedidos ficam segurados por até 24 h esperando a sua confirmação.' : 'Seus pedidos ficam segurados até a empresa confirmar.'}</p>
      <button class="btn primary" onClick=${() => setAsking(true)}>Pedir horário</button>
    </div>
    <h2 class="section-title">Aguardando confirmação ${pending.length ? html`<span class="count">${pending.length}</span>` : ''}</h2>
    ${pending.length ? html`<div class="list">${pending.map(Row)}</div>` : html`<p class="small muted">Nenhum pedido esperando.</p>`}
    <h2 class="section-title">Reservas</h2>
    ${rest.length ? html`<div class="list">${rest.map(Row)}</div>` : html`<div class="empty"><b>Agenda livre</b>Nenhuma reserva nos próximos 30 dias.</div>`}
    <${RequestDialog} slug=${slug} open=${asking} venues=${venues.data?.venues || []} feePct=${venues.data?.fee_pct ?? 6} onClose=${() => setAsking(false)} onDone=${() => { setAsking(false); q.reload(); }} />
    ${confirmNode}
  `;
}

function RequestDialog({ slug, open, venues, feePct, onClose, onDone }) {
  const { api } = useApp();
  const active = venues.filter((v) => v.status === 'active');
  const [v, setV] = useState({ venue: '', date: todayStr(1), time: '20:00', minutes: 60 });
  const [err, setErr] = useState('');
  const venue = active.find((x) => x.id === v.venue) || active[0];
  const price = venue ? Math.round(venue.price_per_hour_cents * v.minutes / 60) : 0;
  const fee = Math.round(price * feePct / 100);
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try { await api.rpc('tfl_booking_request', { p_org: slug, p_venue: venue.id, p_starts_at: localToIso(v.date, v.time), p_minutes: +v.minutes }); onDone(); }
    catch (ex) { setErr(ex.message); }
  };
  return html`<${Dialog} open=${open} onClose=${onClose} label="Pedir horário">
    <h3>Pedir horário</h3>
    ${!active.length ? html`<p class="muted">Nenhum campo ativo para pedir.</p>` : html`
    <form class="form" onSubmit=${submit}>
      <label class="field">Campo<select value=${venue?.id} onChange=${(e) => setV({ ...v, venue: e.target.value })}>${active.map((x) => html`<option value=${x.id}>${x.name}</option>`)}</select>
        <span class="hint">${hoursSummary(venue?.hours || [])}</span></label>
      <div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:10px">
        <label class="field">Dia<input type="date" min=${todayStr()} value=${v.date} onInput=${(e) => setV({ ...v, date: e.target.value })} /></label>
        <label class="field">Início<input type="time" step="1800" value=${v.time} onInput=${(e) => setV({ ...v, time: e.target.value })} /></label>
        <label class="field">Duração<select value=${v.minutes} onChange=${(e) => setV({ ...v, minutes: +e.target.value })}>${[60, 90, 120].map((m) => html`<option value=${m}>${m / 60 === Math.floor(m / 60) ? m / 60 + ' h' : '1 h 30'}</option>`)}</select></label>
      </div>
      <div class="panel" style="padding:12px 14px"><div class="small muted">Valor</div>
        <div>${money(price)} do campo + ${money(fee)} do app = <b style="color:var(--beam)">${money(price + fee)}</b></div>
        <div class="small muted" style="margin-top:4px">O pagamento ainda é combinado direto com o campo.</div></div>
      <p class="small muted">O horário fica segurado até a empresa confirmar (até 24 h).</p>
      <div class="form-error" role="alert">${err}</div>
      <div class="form-actions"><button type="button" class="btn" onClick=${onClose}>Cancelar</button><button class="btn primary">Pedir horário</button></div>
    </form>`}
  <//>`;
}
