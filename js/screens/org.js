// Painel da empresa (gestor, administrador e organizador). Cada aba aparece só para quem tem a
// permissão; mesmo assim, o banco confere de novo a cada ação.
import { html, useState, useApp, useLoad, Loading, ErrorBox, Dialog, useConfirm, act, href, Ava, fmtDateTime,
  ROLE_LABEL, STATUS_LABEL, STATUS_CLASS, ORG_STATUS_LABEL, ORG_STATUS_CLASS, KIND_LABEL } from '../ui.js';
import { AuditTable } from './admin.js';

import { VenuesTab, AgendaTab } from './venues.js';
import { GroupsTab, MatchesTab } from './matches.js';

// [rota, rótulo, permissão (null = todo membro aprovado); 'book' = campos ou agenda]
const TABS = [
  ['', 'Visão geral', null], ['jogos', 'Jogos', null], ['grupos', 'Grupos', null], ['campos', 'Campos', 'book'],
  ['agenda', 'Agenda', 'book'], ['membros', 'Membros', 'org.members'], ['equipe', 'Equipe e acessos', 'org.roles'],
  ['config', 'Configurações', 'org.settings'], ['historico', 'Histórico', 'org.settings'],
];

export function OrgPage({ slug, tab = '' }) {
  const { api } = useApp();
  const q = useLoad(() => api.rpc('tfl_org_overview', { p_org: slug }), [slug]);
  if (q.loading && !q.data) return html`<${Loading} />`;
  if (q.error) return html`<div class="empty"><b>Sem acesso</b>${q.error}</div>`;
  const o = q.data;
  const can = (p) => !p || (p === 'book' ? o.permissions.includes('venue.manage') || o.permissions.includes('booking.manage') || o.kind === 'venue_company' : o.permissions.includes(p));
  const tabs = TABS.filter(([, , p]) => can(p) || p === 'org.members');
  const allowed = TABS.find(([k]) => k === tab);
  const blocked = allowed && allowed[2] && !can(allowed[2]) && allowed[0] !== 'membros';
  return html`
    <div class="page-head"><div>
      <div class="eyebrow">${KIND_LABEL[o.kind]}${o.my_role ? ' · você é ' + ROLE_LABEL[o.my_role].toLowerCase() : ''}</div>
      <h1>${o.name}</h1>
      ${o.status !== 'active' && html`<p><span class=${'badge ' + ORG_STATUS_CLASS[o.status]}>${ORG_STATUS_LABEL[o.status]}</span> ${o.status_reason || ''}</p>`}
      ${o.status === 'suspended' && html`<p class="small">Empresa suspensa: nada pode ser alterado até o administrador da plataforma reativar.</p>`}
    </div></div>
    <nav class="tabs" aria-label="Seções da empresa">
      ${tabs.map(([k, label, p]) => html`<a key=${k} href=${href('o/' + slug + (k ? '/' + k : ''))} class=${tab === k ? 'on' : ''}>${label}
        ${k === 'membros' && o.counts.pending ? html`<span class="count">${o.counts.pending}</span>` : ''}</a>`)}
    </nav>
    ${blocked ? html`<div class="empty"><b>Sem acesso</b>Você não tem permissão para esta área.</div>` : html`
      ${tab === '' && html`<${Overview} o=${o} slug=${slug} />`}
      ${tab === 'jogos' && html`<${MatchesTab} slug=${slug} />`}
      ${tab === 'grupos' && html`<${GroupsTab} slug=${slug} />`}
      ${tab === 'campos' && html`<${VenuesTab} slug=${slug} />`}
      ${tab === 'agenda' && html`<${AgendaTab} slug=${slug} />`}
      ${tab === 'membros' && html`<${Members} slug=${slug} onChange=${q.reload} />`}
      ${tab === 'equipe' && html`<${Team} slug=${slug} />`}
      ${tab === 'config' && html`<${Settings} o=${o} slug=${slug} onSaved=${q.reload} />`}
      ${tab === 'historico' && html`<${History} slug=${slug} />`}`}
  `;
}

function Overview({ o, slug }) {
  const k = (label, value, sub, cls = '') => html`<div class=${'kpi ' + cls}><span>${label}</span><b>${value ?? '—'}</b>${sub && html`<small>${sub}</small>`}</div>`;
  const PERM_SHORT = { 'org.settings': 'Editar empresa', 'org.members': 'Aprovar membros', 'org.roles': 'Dar acessos', 'org.billing': 'Assinatura',
    'venue.manage': 'Campos', 'booking.manage': 'Reservas', 'group.manage': 'Grupos', 'match.manage': 'Partidas', 'draw.run': 'Sorteio e telão',
    'competition.manage': 'Campeonatos', 'comms.send': 'Convites', 'comms.settings': 'WhatsApp', 'reports.org': 'Relatórios' };
  return html`
    <div class="grid kpis">
      ${k('Membros aprovados', o.counts.approved, 'participam da liga', 'accent')}
      ${o.counts.pending !== null && k('Aguardando aprovação', o.counts.pending, o.counts.pending ? html`<a href=${href('o/' + slug + '/membros')}>Revisar agora</a>` : 'nenhum', o.counts.pending ? 'warn' : '')}
      ${o.counts.blocked !== null && k('Bloqueados', o.counts.blocked, '')}
      ${k('Equipe', o.counts.staff, 'gestores, administradores e organizadores')}
    </div>
    <h2 class="section-title">O que você pode fazer aqui</h2>
    <div style="display:flex;flex-wrap:wrap;gap:8px">${o.permissions.length ? o.permissions.map((p) => html`<span class="badge blue">${PERM_SHORT[p] || p}</span>`) : html`<span class="muted small">Nenhuma permissão administrativa.</span>`}</div>
    <div class="notice" style="margin-top:20px"><b>Em breve:</b> sorteio, telão e campeonatos chegam na Fase 3.</div>
  `;
}

function Members({ slug, onChange }) {
  const { api, me } = useApp();
  const q = useLoad(() => api.rpc('tfl_org_members', { p_org: slug }), [slug]);
  const [filter, setFilter] = useState('all');
  const [ask, confirmNode] = useConfirm();
  if (q.loading && !q.data) return html`<${Loading} />`;
  if (q.error) return html`<${ErrorBox} message=${q.error} onRetry=${q.reload} />`;
  const { members, can_manage, can_roles } = q.data;
  const done = () => { q.reload(); onChange(); };
  const setStatus = async (m, status) => {
    if (status === 'blocked') {
      const ok = await ask({ title: `Bloquear ${m.name}?`, body: 'A pessoa deixa de ver a liga e não entra mais nas listas. Dá para desfazer depois.', confirmLabel: 'Bloquear', danger: true });
      if (!ok) return;
    }
    if (await act(() => api.rpc('tfl_admin_set_status', { p_org: slug, p_user: m.user_id, p_status: status }), status === 'approved' ? `${m.name} aprovado` : 'Situação atualizada')) done();
  };
  const setRole = async (m, role) => { if (await act(() => api.rpc('tfl_org_set_role', { p_org: slug, p_user: m.user_id, p_role: role }), 'Papel atualizado')) done(); };
  const removePhoto = async (m) => {
    const reason = await ask({ title: `Remover a foto de ${m.name}?`, body: 'Use para foto inadequada. A pessoa pode enviar outra.', reasonLabel: 'Motivo (fica no histórico)', confirmLabel: 'Remover foto', danger: true });
    if (reason === null) return;
    if (await act(() => api.rpc('tfl_admin_remove_photo', { p_org: slug, p_user: m.user_id, p_reason: reason }), 'Foto removida')) done();
  };
  const list = members.filter((m) => filter === 'all' || m.status === filter);
  const pending = members.filter((m) => m.status === 'pending').length;
  return html`
    ${can_manage && html`<div class="seg" style="max-width:420px;grid-template-columns:repeat(4,1fr);margin-top:0">
      ${[['all', 'Todos'], ['pending', `Pendentes${pending ? ' (' + pending + ')' : ''}`], ['approved', 'Aprovados'], ['blocked', 'Bloqueados']].map(([k, l]) =>
        html`<button class=${filter === k ? 'on' : ''} onClick=${() => setFilter(k)}>${l}</button>`)}</div>`}
    ${list.length === 0 ? html`<div class="empty"><b>Ninguém aqui</b>Nenhum membro nesta situação.</div>` : html`
    <div class="list">${list.map((m) => html`<div class="item" key=${m.user_id}>
      <${Ava} path=${m.photo_path} name=${m.name} size=${44} />
      <div class="grow">
        <div class="title">${m.nick || m.name}${m.user_id === me.id ? ' (você)' : ''}</div>
        <div class="sub">
          <span class=${'badge ' + STATUS_CLASS[m.status]}>${STATUS_LABEL[m.status]}</span>
          <span>${ROLE_LABEL[m.role]}</span>
          ${m.is_minor && html`<span class="badge gold" title="Menor de idade: fora do telão e dos rankings públicos">menor</span>`}
          ${m.grants.map((g) => html`<span class="badge blue">${g.role}</span>`)}
          <span class="small">desde ${new Date(m.joined_at).toLocaleDateString('pt-BR')}</span>
        </div>
      </div>
      ${can_manage && m.user_id !== me.id && m.role !== 'owner' && html`<div class="row-actions">
        ${m.status === 'pending' && html`<button class="btn sm primary" onClick=${() => setStatus(m, 'approved')}>Aprovar</button>`}
        ${m.status === 'blocked' && html`<button class="btn sm" onClick=${() => setStatus(m, 'approved')}>Desbloquear</button>`}
        ${can_roles && m.status === 'approved' && html`<select class="btn sm" aria-label="Papel" value=${m.role} onChange=${(e) => setRole(m, e.target.value)}>
          <option value="player">Jogador</option><option value="organizer">Organizador</option><option value="admin">Administrador</option></select>`}
        ${m.photo_path && html`<button class="btn sm" onClick=${() => removePhoto(m)}>Remover foto</button>`}
        ${m.status !== 'blocked' && html`<button class="btn sm danger" onClick=${() => setStatus(m, 'blocked')}>Bloquear</button>`}
      </div>`}
    </div>`)}</div>`}
    ${confirmNode}
  `;
}

function Team({ slug }) {
  const { api } = useApp();
  const roles = useLoad(() => api.rpc('tfl_roles_list', { p_org: slug }), [slug]);
  const people = useLoad(() => api.rpc('tfl_org_members', { p_org: slug }), [slug]);
  const [editing, setEditing] = useState(null);
  const [granting, setGranting] = useState(false);
  if ((roles.loading && !roles.data) || (people.loading && !people.data)) return html`<${Loading} />`;
  if (roles.error) return html`<${ErrorBox} message=${roles.error} onRetry=${roles.reload} />`;
  if (people.error) return html`<${ErrorBox} message=${people.error} onRetry=${people.reload} />`;
  const perms = roles.data.permissions;
  const label = (k) => perms.find((p) => p.key === k)?.label || k;
  const staff = people.data.members.filter((m) => m.status === 'approved' && (m.role !== 'player' || m.grants.length));
  const removeGrant = async (g) => { if (await act(() => api.rpc('tfl_grant_remove', { p_org: slug, p_grant: g.id }), 'Acesso retirado')) people.reload(); };
  return html`
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <h2 class="section-title" style="margin:0">Quem tem acesso</h2>
      <button class="btn primary" onClick=${() => setGranting(true)}>Dar acesso</button>
    </div>
    <div class="list" style="margin-top:12px">${staff.map((m) => html`<div class="item" key=${m.user_id}>
      <${Ava} path=${m.photo_path} name=${m.name} size=${40} />
      <div class="grow"><div class="title">${m.name}</div><div class="sub"><span>${ROLE_LABEL[m.role]} (papel principal)</span></div>
        ${m.grants.length > 0 && html`<div class="sub">${m.grants.map((g) => html`<span class="badge blue">${g.role}${g.scope_type !== 'org' ? ' · ' + g.scope_type : ''}
          <button title="Retirar" aria-label=${'Retirar ' + g.role} style="color:inherit;margin-left:4px" onClick=${() => removeGrant(g)}>×</button></span>`)}</div>`}
      </div></div>`)}</div>

    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:28px">
      <h2 class="section-title" style="margin:0">Papéis</h2>
      <button class="btn" onClick=${() => setEditing({ id: null, name: '', permissions: [] })}>Novo papel</button>
    </div>
    <p class="small muted" style="margin:6px 0 12px">Os papéis padrão não mudam. Crie papéis próprios para funcionários (ex.: recepção, só partidas e telão).</p>
    <div class="grid two">${roles.data.roles.filter((r) => r.key !== 'player').map((r) => html`<div class="panel" key=${r.id}>
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>${r.name}</b>
        ${r.system ? html`<span class="badge">padrão</span>` : html`<button class="btn sm" onClick=${() => setEditing(r)}>Editar</button>`}</div>
      <ul class="small muted" style="margin:10px 0 0 18px">${r.permissions.map((p) => html`<li>${label(p)}</li>`)}</ul>
    </div>`)}</div>

    <${RoleEditor} slug=${slug} role=${editing} perms=${perms} onClose=${() => setEditing(null)} onDone=${() => { setEditing(null); roles.reload(); people.reload(); }} />
    <${GrantDialog} slug=${slug} open=${granting} roles=${roles.data.roles} people=${people.data.members} onClose=${() => setGranting(false)} onDone=${() => { setGranting(false); people.reload(); }} />
  `;
}

function RoleEditor({ slug, role, perms, onClose, onDone }) {
  const { api } = useApp();
  const [v, setV] = useState(null); const [err, setErr] = useState('');
  if (role && (!v || v.id !== role.id)) setV({ id: role.id, name: role.name, permissions: [...role.permissions] });
  const locked = ['org.roles', 'org.billing'];
  // Atualização funcional: marcar várias caixas seguidas não perde nenhuma.
  const toggle = (k) => setV((x) => ({ ...x, permissions: x.permissions.includes(k) ? x.permissions.filter((y) => y !== k) : [...x.permissions, k] }));
  const save = async (e) => {
    e.preventDefault(); setErr('');
    try { await api.rpc('tfl_role_save', { p_org: slug, p_id: v.id, p_name: v.name, p_permissions: v.permissions }); setV(null); onDone(); }
    catch (ex) { setErr(ex.message); }
  };
  const areas = [...new Set(perms.map((p) => p.area))];
  return html`<${Dialog} open=${!!role} onClose=${() => { setV(null); onClose(); }} label="Papel personalizado">
    ${v && html`<h3>${v.id ? 'Editar papel' : 'Novo papel'}</h3>
    <form class="form" onSubmit=${save}>
      <label class="field">Nome<input value=${v.name} onInput=${(e) => { const name = e.target.value; setV((x) => ({ ...x, name })); }} maxlength="40" placeholder="Ex.: Recepção" /></label>
      ${areas.map((a) => html`<div><div class="small muted" style="margin-bottom:6px">${a}</div>
        ${perms.filter((p) => p.area === a).map((p) => html`<label class="check" style="margin:6px 0">
          <input type="checkbox" checked=${v.permissions.includes(p.key)} disabled=${locked.includes(p.key)} onChange=${() => toggle(p.key)} />
          <span>${p.label}${locked.includes(p.key) ? ' (só o gestor)' : ''}</span></label>`)}</div>`)}
      <div class="form-error" role="alert">${err}</div>
      <div class="form-actions"><button type="button" class="btn" onClick=${() => { setV(null); onClose(); }}>Cancelar</button><button class="btn primary">Salvar papel</button></div>
    </form>`}
  <//>`;
}

function GrantDialog({ slug, open, roles, people, onClose, onDone }) {
  const { api, me } = useApp();
  const grantable = roles.filter((r) => !r.system || ['admin', 'organizer'].includes(r.key));
  const approved = people.filter((m) => m.status === 'approved' && m.role !== 'owner' && m.user_id !== me.id);
  const [user, setUser] = useState(''); const [role, setRole] = useState(''); const [err, setErr] = useState('');
  const save = async (e) => {
    e.preventDefault(); setErr('');
    try { await api.rpc('tfl_grant_add', { p_org: slug, p_user: user, p_role: role, p_scope_type: 'org', p_scope_id: null }); setUser(''); setRole(''); onDone(); }
    catch (ex) { setErr(ex.message); }
  };
  return html`<${Dialog} open=${open} onClose=${onClose} label="Dar acesso">
    <h3>Dar acesso</h3>
    <form class="form" onSubmit=${save}>
      <label class="field">Pessoa<select value=${user} onChange=${(e) => setUser(e.target.value)}>
        <option value="">Escolha um membro aprovado</option>${approved.map((m) => html`<option value=${m.user_id}>${m.name}</option>`)}</select></label>
      <label class="field">Papel<select value=${role} onChange=${(e) => setRole(e.target.value)}>
        <option value="">Escolha um papel</option>${grantable.map((r) => html`<option value=${r.id}>${r.name}${r.system ? '' : ' (personalizado)'}</option>`)}</select></label>
      <p class="small muted">Vale para a empresa toda. Na Fase 2 dá para limitar a um campo ou a um grupo.</p>
      <div class="form-error" role="alert">${err}</div>
      <div class="form-actions"><button type="button" class="btn" onClick=${onClose}>Cancelar</button><button class="btn primary" disabled=${!user || !role}>Dar acesso</button></div>
    </form>
  <//>`;
}

function Settings({ o, slug, onSaved }) {
  const { api } = useApp();
  const [name, setName] = useState(o.name); const [tz, setTz] = useState(o.timezone);
  const zones = ['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Bahia', 'America/Rio_Branco', 'America/Noronha'];
  const save = async (e) => { e.preventDefault(); if (await act(() => api.rpc('tfl_org_update', { p_org: slug, p_name: name, p_timezone: tz }), 'Empresa atualizada')) onSaved(); };
  return html`<form class="panel form" style="max-width:520px" onSubmit=${save}>
    <label class="field">Nome da empresa<input value=${name} onInput=${(e) => setName(e.target.value)} maxlength="80" /></label>
    <label class="field">Fuso horário<select value=${tz} onChange=${(e) => setTz(e.target.value)}>${zones.map((z) => html`<option value=${z}>${z.replace('America/', '').replace('_', ' ')}</option>`)}</select>
      <span class="hint">Usado nos horários de jogos e reservas.</span></label>
    <label class="field">Endereço<input value=${'/o/' + slug} disabled /><span class="hint">O endereço só muda pelo administrador da plataforma.</span></label>
    <div class="form-actions"><button class="btn primary">Salvar</button></div>
  </form>`;
}

function History({ slug }) {
  const { api } = useApp();
  const q = useLoad(() => api.rpc('tfl_org_audit', { p_org: slug, p_limit: 150 }), [slug]);
  if (q.loading && !q.data) return html`<${Loading} />`;
  if (q.error) return html`<${ErrorBox} message=${q.error} onRetry=${q.reload} />`;
  return html`
    <h2 class="section-title" style="margin-top:0">Sessões de suporte da plataforma</h2>
    ${q.data.support_sessions.length === 0 ? html`<p class="small muted">Nenhuma. Se o suporte da plataforma acessar sua empresa, aparece aqui com o motivo.</p>` : html`
    <div class="list">${q.data.support_sessions.map((s, i) => html`<div class="item" key=${i}><div class="grow">
      <div class="title">${s.reason}</div><div class="sub"><span>${s.admin}</span><span>${fmtDateTime(s.started_at)}</span>
        <span class=${'badge ' + (s.ended_at || new Date(s.expires_at) < new Date() ? '' : 'pending')}>${s.ended_at ? 'encerrada' : new Date(s.expires_at) < new Date() ? 'expirada' : 'em andamento'}</span></div></div></div>`)}</div>`}
    <h2 class="section-title">Ações</h2>
    <${AuditTable} rows=${q.data.events} />
  `;
}
