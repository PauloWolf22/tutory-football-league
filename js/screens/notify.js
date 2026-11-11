// Avisos dentro do app (sino), convites de grupo e "meus jogos".
import { html, useState, useEffect, useRef, useApp, useLoad, Loading, ErrorBox, act, href, fmtDateTime, fmtDay, fmtTime, Icon,
  RSVP_LABEL, RSVP_CLASS, BOOKING_LABEL, BOOKING_CLASS, useLive, toast } from '../ui.js';

export function Bell() {
  const { api, me } = useApp();
  const [data, setData] = useState({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const box = useRef();
  const load = async () => { try { setData(await api.rpc('tfl_notifications', { p_limit: 20 })); } catch {} };
  useLive(load, (cb) => api.subscribe('avisos', 'notifications', `user_id=eq.${me.id}`, cb), [me.id]);
  useEffect(() => { load(); }, [me.id]);
  useEffect(() => {
    const out = (e) => { if (open && box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', out); return () => document.removeEventListener('pointerdown', out);
  }, [open]);
  const readAll = async () => { await api.rpc('tfl_notifications_read', { p_id: null }); load(); };
  const go = async (n) => { if (!n.read) await api.rpc('tfl_notifications_read', { p_id: n.id }); setOpen(false); if (n.link) location.hash = n.link; load(); };
  return html`<div class="bell" ref=${box}>
    <button class="btn sm ghost" aria-label=${`Avisos${data.unread ? `, ${data.unread} novos` : ''}`} aria-expanded=${open} onClick=${() => setOpen(!open)} style="position:relative;padding:0 10px">
      ${Icon.bell}${data.unread > 0 && html`<span class="count" style="position:absolute;top:2px;right:0">${data.unread > 9 ? '9+' : data.unread}</span>`}</button>
    ${open && html`<div class="bell-menu" role="dialog" aria-label="Avisos">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid var(--line)">
        <b>Avisos</b>${data.unread > 0 && html`<button class="link-out" onClick=${readAll}>Marcar todos como lidos</button>`}</div>
      ${data.items.length === 0 ? html`<p class="small muted" style="padding:18px 14px">Nenhum aviso ainda.</p>` :
        data.items.map((n) => html`<button class="bell-item ${n.read ? '' : 'unread'}" key=${n.id} onClick=${() => go(n)}>
          <b>${n.title}</b><span>${n.body}</span><small>${fmtDateTime(n.created_at)}</small></button>`)}
    </div>`}
  </div>`;
}

// Convites de grupo pendentes (cartões que aparecem na Home e na página de convites).
export function InviteCards({ onChange }) {
  const { api, refreshMe } = useApp();
  const q = useLoad(() => api.rpc('tfl_my_invites'), []);
  if (!q.data || q.data.length === 0) return null;
  const respond = async (i, accept) => {
    if (await act(() => api.rpc('tfl_group_respond', { p_group: i.group_id, p_accept: accept }), accept ? `Você entrou no grupo ${i.group}` : 'Convite recusado')) { q.reload(); await refreshMe(); onChange?.(); }
  };
  return html`<div class="list" style="margin:0 0 18px">${q.data.map((i) => html`<div class="item" key=${i.group_id} style="border-color:rgba(246,195,90,.4)">
    <div class="grow"><div class="title">Convite: ${i.group}</div><div class="sub"><span>${i.org}</span>${i.invited_by && html`<span>de ${i.invited_by}</span>`}
      ${i.org_status !== 'approved' && html`<span class="badge pending">sua conta ainda aguarda aprovação na liga</span>`}</div></div>
    <div class="row-actions"><button class="btn sm primary" disabled=${i.org_status !== 'approved'} onClick=${() => respond(i, true)}>Aceitar</button>
      <button class="btn sm" onClick=${() => respond(i, false)}>Recusar</button></div></div>`)}</div>`;
}

export function InvitesPage() {
  return html`<div class="page-head"><div><div class="eyebrow">Grupos</div><h1>Convites</h1><p>Aceite para entrar nas listas dos jogos do grupo.</p></div></div>
    <${InviteCards} />
    <p class="small muted">Sem outros convites. <a href="#/jogos">Ver meus jogos</a></p>`;
}

// Próximos jogos do jogador, com os botões de presença.
export function useMyMatches() {
  const { api, me } = useApp();
  const q = useLoad(() => api.rpc('tfl_my_matches'), [me.id]);
  useLive(q.reload, (cb) => api.subscribe('meus-jogos', 'match_participants', `user_id=eq.${me.id}`, cb), [me.id]);
  return q;
}

export function RsvpButtons({ m, onDone }) {
  const { api } = useApp();
  const [busy, setBusy] = useState(false);
  const send = async (going) => {
    setBusy(true);
    try { const r = await api.rpc('tfl_match_rsvp', { p_match: m.id, p_going: going });
      toast(r.status === 'confirmed' ? 'Presença confirmada! 🔥' : r.status === 'waitlist' ? 'Lotou: você está na lista de espera' : 'Tudo bem, sua vaga foi liberada'); onDone?.(); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  if (m.status !== 'open' || m.me === 'removed') return null;
  return html`<div class="row-actions">
    ${!['confirmed', 'waitlist'].includes(m.me) && html`<button class="btn primary" aria-busy=${busy ? 'true' : 'false'} onClick=${() => send(true)} style="min-height:48px;padding:0 22px">Vou!</button>`}
    ${m.me !== 'declined' && html`<button class="btn" aria-busy=${busy ? 'true' : 'false'} onClick=${() => send(false)} style="min-height:48px">${m.me === 'invited' ? 'Não vou' : 'Desistir'}</button>`}
  </div>`;
}

export function MyMatchesPage() {
  const q = useMyMatches();
  if (q.loading && !q.data) return html`<${Loading} />`;
  if (q.error) return html`<${ErrorBox} message=${q.error} onRetry=${q.reload} />`;
  return html`<div class="page-head"><div><div class="eyebrow">Agenda</div><h1>Meus jogos</h1><p>Os jogos dos seus grupos, em todas as ligas.</p></div></div>
    <${InviteCards} onChange=${q.reload} />
    ${q.data.length === 0 ? html`<div class="empty"><b>Nenhum jogo marcado</b>Quando o organizador marcar um jogo do seu grupo, ele aparece aqui.</div>` : html`
    <div class="list">${q.data.map((m) => html`<div class="item" key=${m.id}>
      <div style="text-align:center;min-width:64px"><div class="small muted">${fmtDay(m.starts_at)}</div><div style="font:800 20px Gilroy">${fmtTime(m.starts_at)}</div></div>
      <a class="grow" href=${href('jogo/' + m.id)} style="text-decoration:none;color:inherit"><div class="title">${m.group} · ${m.org}</div>
        <div class="sub"><span>${m.venue || m.location}</span><span class=${'badge ' + RSVP_CLASS[m.me]}>${RSVP_LABEL[m.me]}</span>
          <span>${m.confirmed}/${m.capacity} confirmados</span>${m.booking_status && html`<span class=${'badge ' + BOOKING_CLASS[m.booking_status]}>campo: ${BOOKING_LABEL[m.booking_status].toLowerCase()}</span>`}</div></a>
      <${RsvpButtons} m=${m} onDone=${q.reload} />
    </div>`)}</div>`}`;
}
