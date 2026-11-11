// Painel do super admin: indicadores globais, empresas, sessões de suporte e auditoria.
// Sem sessão de suporte, ele só vê números agregados; listas de pessoas exigem a sessão.
import { html, useState, useApp, useLoad, Loading, ErrorBox, Dialog, useConfirm, act, go, href, fmtDateTime,
  ORG_STATUS_LABEL, ORG_STATUS_CLASS, KIND_LABEL, ACTION_LABEL } from '../ui.js';

export function AdminPage({ tab = '' }) {
  const { me } = useApp();
  if (!me.is_platform_admin) return html`<div class="empty"><b>Sem acesso</b>Esta área é só do administrador da plataforma.</div>`;
  return html`
    <div class="page-head"><div><div class="eyebrow">Administração da plataforma</div><h1>Super admin</h1>
      <p>Visão de todas as empresas. Para ver pessoas e listas de uma empresa, abra uma sessão de suporte: ela fica registrada e visível ao gestor.</p></div></div>
    <nav class="tabs" aria-label="Seções do super admin">
      <a href=${href('admin')} class=${tab === '' ? 'on' : ''}>Visão geral</a>
      <a href=${href('admin/empresas')} class=${tab === 'empresas' ? 'on' : ''}>Empresas</a>
      <a href=${href('admin/auditoria')} class=${tab === 'auditoria' ? 'on' : ''}>Auditoria</a>
    </nav>
    ${tab === '' && html`<${Overview} />`}
    ${tab === 'empresas' && html`<${Orgs} />`}
    ${tab === 'auditoria' && html`<${Audit} />`}
  `;
}

function Overview() {
  const { api } = useApp();
  const q = useLoad(() => api.rpc('tfl_pa_overview'));
  if (q.loading && !q.data) return html`<${Loading} />`;
  if (q.error) return html`<${ErrorBox} message=${q.error} onRetry=${q.reload} />`;
  const d = q.data;
  const k = (label, value, sub, cls = '') => html`<div class=${'kpi ' + cls}><span>${label}</span><b>${value ?? 0}</b>${sub && html`<small>${sub}</small>`}</div>`;
  return html`
    <div class="grid kpis">
      ${k('Empresas', d.orgs_total, `${d.orgs_by_status.active || 0} ativas · ${d.orgs_by_status.suspended || 0} suspensas`, 'accent')}
      ${k('Usuários', d.users_total, `${d.users_new_30d} novos em 30 dias`)}
      ${k('Ativos em 30 dias', d.users_active_30d, 'entraram na conta')}
      ${k('Jogadores aprovados', d.players_approved, 'em pelo menos uma liga')}
      ${k('Aguardando aprovação', d.members_pending, 'em todas as empresas', d.members_pending ? 'warn' : '')}
      ${k('Menores de idade', d.minors, 'com responsável registrado')}
      ${k('Com foto', d.photos, 'perfis')}
      ${k('Suportes abertos', d.support_open, 'sessões em andamento', d.support_open ? 'warn' : '')}
    </div>
    <h2 class="section-title">Tipos de empresa</h2>
    <div class="grid kpis">
      ${Object.entries(KIND_LABEL).map(([key, label]) => k(label, d.orgs_by_kind[key] || 0, ''))}
    </div>
    <div class="notice" style="margin-top:20px"><b>Ainda não coletado:</b> ${d.not_collected_yet.join(', ')}.
      Esses indicadores aparecem quando as fases de operação, comunicação e cobrança começarem a gravar dados. Nada aqui é estimado.</div>
  `;
}

function Orgs() {
  const { api, refreshMe } = useApp();
  const q = useLoad(() => api.rpc('tfl_pa_orgs'));
  const [creating, setCreating] = useState(false);
  const [support, setSupport] = useState(null);
  const [ask, confirmNode] = useConfirm();

  const setStatus = async (o, status) => {
    let reason = '';
    if (status === 'suspended' || status === 'closed') {
      reason = await ask({ title: `${status === 'suspended' ? 'Suspender' : 'Encerrar'} ${o.name}?`,
        body: status === 'suspended' ? 'Ninguém da empresa poderá alterar nada até você reativar. O histórico continua visível para os membros.' : 'A empresa deixa de operar. Os dados são mantidos.',
        reasonLabel: 'Motivo (fica registrado e aparece para a empresa)', confirmLabel: status === 'suspended' ? 'Suspender' : 'Encerrar', danger: true });
      if (reason === null) return;
    }
    if (await act(() => api.rpc('tfl_pa_org_set_status', { p_org_id: o.id, p_status: status, p_reason: reason }), 'Situação atualizada')) q.reload();
  };

  if (q.loading && !q.data) return html`<${Loading} />`;
  if (q.error) return html`<${ErrorBox} message=${q.error} onRetry=${q.reload} />`;
  return html`
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
      <p class="muted small">${q.data.length} empresas · números agregados, sem dados pessoais.</p>
      <button class="btn primary" onClick=${() => setCreating(true)}>Nova empresa</button>
    </div>
    ${q.data.length === 0 ? html`<div class="empty"><b>Nenhuma empresa</b>Crie a primeira.</div>` : html`
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Empresa</th><th>Situação</th><th>Membros</th><th>Gestor</th><th>Tipo</th><th>Última atividade</th><th></th></tr></thead>
      <tbody>${q.data.map((o) => html`<tr key=${o.id} class=${o.support_active ? 'support' : ''}>
        <td><b>${o.name}</b><div class="small muted">/${o.slug}</div></td>
        <td><span class=${'badge ' + ORG_STATUS_CLASS[o.status]}>${ORG_STATUS_LABEL[o.status]}</span>
          ${o.status_reason && html`<div class="small muted" title=${o.status_reason}>${o.status_reason.slice(0, 40)}</div>`}</td>
        <td>${o.approved}${o.pending ? html` <span class="badge pending">+${o.pending}</span>` : ''}</td>
        <td>${o.owner || '—'}</td>
        <td class="small">${KIND_LABEL[o.kind]}</td>
        <td class="small muted">${fmtDateTime(o.last_activity)}</td>
        <td><div class="row-actions">
          <button class="btn sm" onClick=${() => setSupport(o)}>Suporte</button>
          ${o.status === 'suspended' || o.status === 'closed'
            ? html`<button class="btn sm" onClick=${() => setStatus(o, 'active')}>Reativar</button>`
            : html`<button class="btn sm danger" onClick=${() => setStatus(o, 'suspended')}>Suspender</button>`}
        </div></td>
      </tr>`)}</tbody>
    </table></div>`}
    <${CreateOrg} open=${creating} onClose=${() => setCreating(false)} onDone=${() => { setCreating(false); q.reload(); }} />
    <${StartSupport} org=${support} onClose=${() => setSupport(null)} onDone=${async (slug) => { setSupport(null); await refreshMe(); go('o/' + slug); }} />
    ${confirmNode}
  `;
}

function CreateOrg({ open, onClose, onDone }) {
  const { api } = useApp();
  const [v, setV] = useState({ name: '', slug: '', kind: 'venue_company', owner: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await api.rpc('tfl_pa_org_create', { p_name: v.name, p_slug: v.slug, p_kind: v.kind, p_owner_email: v.owner }); setV({ name: '', slug: '', kind: 'venue_company', owner: '' }); onDone(); }
    catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return html`<${Dialog} open=${open} onClose=${onClose} label="Nova empresa">
    <h3>Nova empresa</h3>
    <form class="form" onSubmit=${submit}>
      <label class="field">Nome<input value=${v.name} onInput=${(e) => setV({ ...v, name: e.target.value, slug: v.slug && v.slug !== slugify(v.name) ? v.slug : slugify(e.target.value) })} /></label>
      <label class="field">Endereço<input value=${v.slug} onInput=${(e) => setV({ ...v, slug: e.target.value })} /><span class="hint">Usado nos links: #/o/${v.slug || 'endereco'}</span></label>
      <label class="field">Tipo<select value=${v.kind} onChange=${(e) => setV({ ...v, kind: e.target.value })}>
        ${Object.entries(KIND_LABEL).map(([key, label]) => html`<option value=${key}>${label}</option>`)}</select></label>
      <label class="field">E-mail do gestor<input type="email" value=${v.owner} onInput=${(e) => setV({ ...v, owner: e.target.value })} />
        <span class="hint">A pessoa precisa ter criado a conta antes. Ela entra como gestora, já aprovada.</span></label>
      <div class="form-error" role="alert">${err}</div>
      <div class="form-actions"><button type="button" class="btn" onClick=${onClose}>Cancelar</button><button class="btn primary" aria-busy=${busy ? 'true' : 'false'}>Criar empresa</button></div>
    </form>
  <//>`;
}

function StartSupport({ org, onClose, onDone }) {
  const { api } = useApp();
  const [reason, setReason] = useState(''); const [minutes, setMinutes] = useState(60);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { const r = await api.rpc('tfl_support_start', { p_org_id: org.id, p_reason: reason, p_minutes: +minutes }); setReason(''); onDone(r.slug); }
    catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return html`<${Dialog} open=${!!org} onClose=${onClose} label="Abrir sessão de suporte">
    ${org && html`<h3>Suporte em ${org.name}</h3>
    <p class="muted small">Durante a sessão você age como administrador desta empresa. Tudo fica na auditoria com a marca da sessão, e o gestor vê o histórico. Uma faixa amarela fica no topo enquanto ela estiver aberta.</p>
    <form class="form" onSubmit=${submit}>
      <label class="field">Motivo (mínimo 10 letras)<textarea value=${reason} onInput=${(e) => setReason(e.target.value)} maxlength="300" placeholder="Ex.: gestor pediu ajuda para aprovar membros"></textarea></label>
      <label class="field">Duração<select value=${minutes} onChange=${(e) => setMinutes(e.target.value)}>
        ${[15, 30, 60, 120].map((m) => html`<option value=${m}>${m} minutos</option>`)}</select></label>
      <div class="form-error" role="alert">${err}</div>
      <div class="form-actions"><button type="button" class="btn" onClick=${onClose}>Cancelar</button><button class="btn primary" aria-busy=${busy ? 'true' : 'false'}>Abrir sessão</button></div>
    </form>`}
  <//>`;
}

function Audit() {
  const { api } = useApp();
  const q = useLoad(() => api.rpc('tfl_pa_audit', { p_org_id: null, p_limit: 150 }));
  if (q.loading && !q.data) return html`<${Loading} />`;
  if (q.error) return html`<${ErrorBox} message=${q.error} onRetry=${q.reload} />`;
  return html`<${AuditTable} rows=${q.data} showOrg=${true} />`;
}

export function AuditTable({ rows, showOrg = false }) {
  if (!rows.length) return html`<div class="empty"><b>Nada registrado ainda</b></div>`;
  return html`<div class="table-wrap"><table class="data">
    <thead><tr><th>Quando</th><th>O quê</th><th>Quem</th><th>Sobre</th>${showOrg && html`<th>Empresa</th>`}</tr></thead>
    <tbody>${rows.map((a, i) => html`<tr key=${i} class=${a.support ? 'support' : ''}>
      <td class="small muted">${fmtDateTime(a.at)}</td>
      <td>${ACTION_LABEL[a.action] || a.action}${a.support && html` <span class="badge pending">suporte</span>`}
        ${a.detail?.reason && html`<div class="small muted">${a.detail.reason}</div>`}
        ${a.detail?.status && html`<div class="small muted">→ ${a.detail.status}</div>`}
        ${a.detail?.to && html`<div class="small muted">${a.detail.from} → ${a.detail.to}</div>`}</td>
      <td>${a.actor}</td><td>${a.target || '—'}</td>${showOrg && html`<td class="small">${a.org || '—'}</td>`}
    </tr>`)}</tbody></table></div>`;
}
