// Peças comuns da interface: rotas, avisos, diálogos, avatar e formatação.
import { html, render, useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } from '../vendor/preact-htm.js';
export { html, render, useState, useEffect, useRef, useMemo, useCallback, createContext, useContext };

// ---------------------------------------------------------------- contexto do app
export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

// ---------------------------------------------------------------- rotas (#/caminho)
const parse = () => (location.hash.replace(/^#\/?/, '').split('?')[0] || '').split('/').filter(Boolean).map(decodeURIComponent);
export function useRoute() {
  const [parts, setParts] = useState(parse());
  useEffect(() => {
    const on = () => { setParts(parse()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parts;
}
export const go = (path) => { location.hash = '#/' + path.replace(/^\/+/, ''); };
export const href = (path) => '#/' + path.replace(/^\/+/, '');

// ---------------------------------------------------------------- avisos
let pushToast = () => {};
export const toast = (message, type = '') => pushToast({ message, type });
export function Toasts() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    pushToast = (t) => {
      const id = Math.random();
      setItems((x) => [...x, { ...t, id }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3200);
    };
  }, []);
  return html`<div class="toasts" role="status" aria-live="polite">${items.map((t) => html`<div key=${t.id} class=${t.type}>${t.message}</div>`)}</div>`;
}

// Executa uma ação, mostra o erro como aviso e devolve true/false.
export async function act(fn, okMessage) {
  try { await fn(); if (okMessage) toast(okMessage); return true; }
  catch (e) { toast(e.message || 'Algo deu errado.', 'error'); return false; }
}

// ---------------------------------------------------------------- diálogo modal
export function Dialog({ open, onClose, children, label }) {
  const ref = useRef();
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal(); else if (!open && d.open) d.close();
  }, [open]);
  return html`<dialog class="dlg" ref=${ref} aria-label=${label} onClose=${onClose} onCancel=${(e) => { e.preventDefault(); onClose(); }}>
    ${open ? html`<div class="dlg-body">${children}</div>` : null}
  </dialog>`;
}

// Confirmação simples, com campo de motivo opcional.
export function useConfirm() {
  const [state, setState] = useState(null);
  const ask = (opts) => new Promise((resolve) => setState({ ...opts, resolve, reason: '' }));
  const close = (value) => { state?.resolve(value); setState(null); };
  const node = html`<${Dialog} open=${!!state} onClose=${() => close(null)} label=${state?.title}>
    ${state && html`
      <h3>${state.title}</h3>
      ${state.body && html`<p class="muted">${state.body}</p>`}
      ${state.reasonLabel && html`<label class="field">${state.reasonLabel}
        <textarea value=${state.reason} onInput=${(e) => setState({ ...state, reason: e.target.value })} maxlength="300"></textarea></label>`}
      <div class="form-actions">
        <button class="btn" onClick=${() => close(null)}>Cancelar</button>
        <button class=${'btn ' + (state.danger ? 'danger' : 'primary')} onClick=${() => close(state.reasonLabel ? state.reason : true)}>${state.confirmLabel || 'Confirmar'}</button>
      </div>`}
  <//>`;
  return [ask, node];
}

// ---------------------------------------------------------------- avatar com foto privada (URL assinada)
export function Ava({ path, name = '', size = 40 }) {
  const { api } = useApp();
  const [url, setUrl] = useState(null);
  useEffect(() => { let live = true; setUrl(null); if (path) api.photoUrl(path).then((u) => live && setUrl(u)); return () => { live = false; }; }, [path]);
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase() || '?';
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px`;
  return url ? html`<img class="ava" src=${url} alt="" style=${style} />` : html`<span class="ava" style=${style} aria-hidden="true">${initials}</span>`;
}

// ---------------------------------------------------------------- dados assíncronos
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try { setState({ loading: false, data: await fn(), error: null }); }
    catch (e) { setState({ loading: false, data: null, error: e.message || 'Erro ao carregar.' }); }
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}
export const Loading = () => html`<div class="empty" aria-busy="true">Carregando…</div>`;
export const ErrorBox = ({ message, onRetry }) => html`<div class="empty"><b>Não deu para carregar</b>${message}
  ${onRetry && html`<div style="margin-top:12px"><button class="btn sm" onClick=${onRetry}>Tentar de novo</button></div>`}</div>`;

// ---------------------------------------------------------------- formatação
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtDate = (iso) => (iso ? new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('pt-BR') : '—');
export const ROLE_LABEL = { owner: 'Gestor', admin: 'Administrador', organizer: 'Organizador', player: 'Jogador' };
export const STATUS_LABEL = { approved: 'Aprovado', pending: 'Pendente', blocked: 'Bloqueado' };
export const STATUS_CLASS = { approved: 'ok', pending: 'pending', blocked: 'danger' };
export const ORG_STATUS_LABEL = { active: 'Ativa', trial: 'Em teste', suspended: 'Suspensa', closed: 'Encerrada' };
export const ORG_STATUS_CLASS = { active: 'ok', trial: 'blue', suspended: 'danger', closed: '' };
export const KIND_LABEL = { venue_company: 'Dono de campos', organizer: 'Organizador independente', community: 'Comunidade / empresa' };
export const ACTION_LABEL = {
  'member.status': 'Mudou a situação de um membro', 'member.role': 'Mudou o papel de um membro', 'photo.set': 'Trocou a foto',
  'photo.remove': 'Removeu a própria foto', 'photo.admin_remove': 'ADM removeu uma foto', 'grant.add': 'Concedeu acesso',
  'grant.remove': 'Retirou acesso', 'role.save': 'Salvou um papel personalizado', 'org.update': 'Editou a empresa',
  'org.create': 'Criou a empresa', 'org.status': 'Mudou a situação da empresa', 'support.start': 'Abriu sessão de suporte',
  'support.end': 'Encerrou sessão de suporte', 'profile.save': 'Atualizou o perfil',
  'venue.save': 'Salvou um campo', 'booking.request': 'Pediu um horário', 'booking.confirm': 'Confirmou uma reserva',
  'booking.reject': 'Recusou uma reserva', 'booking.cancel': 'Cancelou uma reserva', 'group.save': 'Salvou um grupo',
  'group.invite': 'Convidou para um grupo', 'group.remove': 'Tirou alguém de um grupo', 'match.create': 'Marcou um jogo',
  'match.update': 'Editou um jogo', 'match.cancel': 'Cancelou um jogo', 'match.remove_player': 'Tirou alguém de um jogo',
  'match.restore_player': 'Recolocou alguém num jogo',
};
export const ageFrom = (birth) => { if (!birth) return null; const b = new Date(birth + 'T12:00:00'); const n = new Date(); let a = n.getFullYear() - b.getFullYear(); if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--; return a; };

// ---------------------------------------------------------------- dinheiro, dias e horários
export const money = (cents) => (cents == null ? '—' : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
export const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const fmtDay = (iso) => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '');
export const fmtTime = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export const fmtWhen = (iso) => `${fmtDay(iso)} · ${fmtTime(iso)}`;
// Data + hora digitadas no formulário (horário local) → ISO.
export const localToIso = (date, time) => new Date(`${date}T${time}:00`).toISOString();
export const todayStr = (plusDays = 0) => { const d = new Date(); d.setDate(d.getDate() + plusDays); return d.toLocaleDateString('sv-SE'); };
export const BOOKING_LABEL = { held: 'Aguardando confirmação', confirmed: 'Confirmada', rejected: 'Recusada', cancelled: 'Cancelada', expired: 'Expirou' };
export const BOOKING_CLASS = { held: 'pending', confirmed: 'ok', rejected: 'danger', cancelled: '', expired: '' };
export const RSVP_LABEL = { confirmed: 'Confirmado', waitlist: 'Lista de espera', invited: 'Sem resposta', declined: 'Não vai', removed: 'Retirado' };
export const RSVP_CLASS = { confirmed: 'ok', waitlist: 'blue', invited: 'pending', declined: '', removed: 'danger' };

// Recarrega quando o banco avisa uma mudança, e a cada 20 s como reserva (se a conexão ao vivo cair).
export function useLive(reload, subscribeFn, deps = []) {
  useEffect(() => {
    const off = subscribeFn ? subscribeFn(() => reload()) : null;
    const t = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 20000);
    return () => { clearInterval(t); off?.(); };
  }, deps);
}

// ---------------------------------------------------------------- ícones (SVG em linha)
const I = (d) => html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const Icon = {
  home: I(html`<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>`),
  user: I(html`<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>`),
  org: I(html`<path d="M4 21V5l8-3 8 3v16"/><path d="M9 21v-5h6v5M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01"/>`),
  shield: I(html`<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>`),
  ball: I(html`<circle cx="12" cy="12" r="9"/><path d="M12 7l4 3-1.5 5h-5L8 10z"/>`),
  bell: I(html`<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>`),
};
