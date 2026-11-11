// Banco simulado (?mock=1): reproduz as regras da migração 20261111090000_fase1_fundacao.sql
// para testar as telas sem tocar no Supabase real. Estado em localStorage ("tfl.mock.v3").
// Pessoas de exemplo (todas fictícias) trocáveis pela barra "Modo de teste".
const KEY = 'tfl.mock.v3';
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const PERMS = [
  ['org.settings', 'Empresa', 'Editar dados da empresa'], ['org.members', 'Empresa', 'Aprovar e bloquear membros'],
  ['org.roles', 'Empresa', 'Dar acessos à equipe'], ['org.billing', 'Empresa', 'Ver e gerenciar a assinatura'],
  ['venue.manage', 'Campos', 'Gerenciar campos e horários'], ['booking.manage', 'Campos', 'Gerenciar reservas'],
  ['group.manage', 'Jogos', 'Gerenciar grupos'], ['match.manage', 'Jogos', 'Criar partidas e cuidar das listas'],
  ['draw.run', 'Jogos', 'Fazer sorteio e abrir o telão'], ['competition.manage', 'Jogos', 'Criar e organizar campeonatos'],
  ['comms.send', 'Comunicação', 'Enviar convites e lembretes'], ['comms.settings', 'Comunicação', 'Configurar WhatsApp e modelos'],
  ['reports.org', 'Relatórios', 'Ver relatórios'],
].map(([key, area, label]) => ({ key, area, label }));
const ALL = PERMS.map((p) => p.key);
const SYSTEM_ROLES = [
  { id: 'r-owner', key: 'owner', name: 'Gestor', permissions: ALL },
  { id: 'r-admin', key: 'admin', name: 'Administrador', permissions: ALL.filter((k) => k !== 'org.roles' && k !== 'org.billing') },
  { id: 'r-organizer', key: 'organizer', name: 'Organizador', permissions: ['booking.manage', 'group.manage', 'match.manage', 'draw.run', 'competition.manage', 'comms.send', 'reports.org'] },
  { id: 'r-player', key: 'player', name: 'Jogador', permissions: [] },
];

export const PERSONAS = [
  ['paulo', 'Paulo Weber (super admin + gestor Tutory)'], ['gestor', 'Marina Costa (gestora Arena Gol)'],
  ['ana', 'Ana Prado (organizadora Tutory)'], ['bruno', 'Bruno Lima (jogador Tutory)'],
  ['caio', 'Caio Souza (pendente Tutory)'], ['duda', 'Duda Reis (jogadora Tutory + Arena Gol)'],
  ['enzo', 'Enzo Alves (menor, Tutory)'],
];

function seed() {
  const ids = Object.fromEntries(PERSONAS.map(([k]) => [k, uuid()]));
  const tutory = uuid(), arena = uuid();
  const users = {}, profiles = {};
  const add = (k, name, email, birth, extra = {}) => {
    users[ids[k]] = { email, password: 'teste1234', name, created_at: now(), last_sign_in_at: now() };
    profiles[ids[k]] = { display_name: name, nick: null, photo_path: null, show_on_screen: true, birth_date: birth,
      guardian_name: null, guardian_email: null, guardian_consent_at: null, ...extra };
  };
  add('paulo', 'Paulo Weber', 'paulo@mock.test', '1988-05-10', { photo_path: `${ids.paulo}/seed.jpg` });
  add('gestor', 'Marina Costa', 'marina@mock.test', '1985-02-01');
  add('ana', 'Ana Prado', 'ana@mock.test', '1994-08-20');
  add('bruno', 'Bruno Lima', 'bruno@mock.test', '1996-11-03');
  add('caio', 'Caio Souza', 'caio@mock.test', '1999-01-15');
  add('duda', 'Duda Reis', 'duda@mock.test', '1997-07-07');
  add('enzo', 'Enzo Alves', 'enzo@mock.test', '2011-04-02',
    { guardian_name: 'Paula Alves', guardian_email: 'paula@mock.test', guardian_consent_at: now(), show_on_screen: false });
  const m = (org, k, role, status) => ({ org_id: org, user_id: ids[k], display_name: profiles[ids[k]].display_name, role, status, created_at: now(), approved_at: status === 'approved' ? now() : null });
  const base = {
    users, profiles, session: ids.paulo, platform_admins: [ids.paulo],
    orgs: [
      { id: tutory, slug: 'tutory', name: 'Tutory', kind: 'community', status: 'active', status_reason: null, timezone: 'America/Sao_Paulo', created_at: now() },
      { id: arena, slug: 'arena-gol', name: 'Arena Gol Society', kind: 'venue_company', status: 'active', status_reason: null, timezone: 'America/Sao_Paulo', created_at: now() },
    ],
    members: [
      m(tutory, 'paulo', 'owner', 'approved'), m(tutory, 'ana', 'organizer', 'approved'), m(tutory, 'bruno', 'player', 'approved'),
      m(tutory, 'caio', 'player', 'pending'), m(tutory, 'duda', 'player', 'approved'), m(tutory, 'enzo', 'player', 'approved'),
      m(arena, 'gestor', 'owner', 'approved'), m(arena, 'duda', 'player', 'approved'), m(arena, 'ana', 'organizer', 'approved'),
    ],
    roles: [], grants: [], sessions: [], audit: [],
    files: { [`${ids.paulo}/seed.jpg`]: 'assets/foto-exemplo.jpg' },
    personas: ids,
    venues: [], venue_hours: [], bookings: [], groups: [], group_members: [], matches: [], participants: [], notifications: [],
  };
  seedFase2(base, ids, tutory, arena);
  return base;
}

// Exemplo da Fase 2: a Arena Gol publica 2 campos; a Tutory tem o grupo "Futebol de terça" com um jogo marcado.
function seedFase2(b, ids, tutory, arena) {
  const c1 = uuid(), c2 = uuid();
  b.venues.push({ id: c1, org_id: arena, name: 'Campo 1', surface: 'Sintético', capacity_players: 14, price_per_hour_cents: 20000, status: 'active' },
    { id: c2, org_id: arena, name: 'Campo 2', surface: 'Grama natural', capacity_players: 22, price_per_hour_cents: 28000, status: 'active' });
  for (const v of [c1, c2]) for (let d = 0; d < 7; d++) b.venue_hours.push({ venue_id: v, weekday: d, opens: d === 0 ? '08:00' : '17:00', closes: '00:00' });
  const g = uuid();
  b.groups.push({ id: g, org_id: tutory, name: 'Futebol de terça', default_venue_id: null, default_location: 'Quadra de exemplo', default_capacity: 10, status: 'active', created_by: ids.ana });
  for (const k of ['ana', 'paulo', 'bruno', 'duda', 'enzo']) b.group_members.push({ group_id: g, user_id: ids[k], status: 'active', invited_by: ids.ana, invited_at: now(), joined_at: now() });
  const tue = new Date(); tue.setDate(tue.getDate() + ((2 - tue.getDay() + 7) % 7 || 7)); tue.setHours(20, 0, 0, 0);
  const mt = uuid();
  b.matches.push({ id: mt, org_id: tutory, group_id: g, venue_id: null, booking_id: null, location_text: 'Quadra de exemplo', starts_at: tue.toISOString(),
    ends_at: new Date(+tue + 3600e3).toISOString(), capacity: 10, status: 'open', notes: null, version: 1, created_by: ids.ana });
  const t0 = Date.now() - 3600e3;
  [['ana', 'confirmed', 0], ['bruno', 'confirmed', 60e3], ['duda', 'invited', null], ['paulo', 'invited', null], ['enzo', 'invited', null]]
    .forEach(([k, s, dt]) => b.participants.push({ match_id: mt, user_id: ids[k], status: s, responded_at: dt === null ? null : new Date(t0 + dt).toISOString(), promoted_at: null }));
  const g2 = uuid();
  b.groups.push({ id: g2, org_id: arena, name: 'Pelada dos amigos', default_venue_id: c1, default_location: null, default_capacity: 14, status: 'active', created_by: ids.ana });
  b.group_members.push({ group_id: g2, user_id: ids.ana, status: 'active', invited_by: ids.ana, invited_at: now(), joined_at: now() },
    { group_id: g2, user_id: ids.duda, status: 'invited', invited_by: ids.ana, invited_at: now(), joined_at: null });
}

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
let db = load() || seed();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
save();

export function mockReset() { db = seed(); save(); }
export function mockSwitch(personaKey) { db.session = personaKey ? db.personas[personaKey] : null; save(); }
export function mockPersona() { return Object.keys(db.personas).find((k) => db.personas[k] === db.session) || ''; }

// ---------------------------------------------------------------- regras (espelho do SQL)
const uid = () => db.session;
const isMinor = (b) => !!b && new Date(b) > new Date(new Date().setFullYear(new Date().getFullYear() - 18));
const isPA = () => db.platform_admins.includes(uid());
const org = (slug) => db.orgs.find((o) => o.slug === slug);
const orgById = (id) => db.orgs.find((o) => o.id === id);
const member = (orgId, u = uid()) => db.members.find((m) => m.org_id === orgId && m.user_id === u);
const isApproved = (orgId) => member(orgId)?.status === 'approved';
const support = (orgId) => (isPA() ? db.sessions.find((s) => s.org_id === orgId && s.admin_id === uid() && !s.ended_at && new Date(s.expires_at) > new Date()) : null);
const roleById = (id) => SYSTEM_ROLES.find((r) => r.id === id) || db.roles.find((r) => r.id === id);
function can(orgId, perm, scopeType = 'org', scopeId = null) {
  if (!uid() || !orgId) return false;
  if (support(orgId)) return true;
  const o = orgById(orgId);
  if (!o || o.status === 'suspended' || o.status === 'closed') return false;
  const m = member(orgId);
  if (!m || m.status !== 'approved') return false;
  if (SYSTEM_ROLES.find((r) => r.key === m.role)?.permissions.includes(perm)) return true;
  return db.grants.some((g) => g.org_id === orgId && g.user_id === uid() && roleById(g.role_id)?.permissions.includes(perm)
    && (g.scope_type === 'org' || (g.scope_type === scopeType && g.scope_id === scopeId)));
}
const myPerms = (orgId) => ALL.filter((k) => can(orgId, k));
const log = (orgId, action, target, detail = null) => {
  db.audit.push({ at: now(), org_id: orgId, actor: uid(), action, target, detail, support_session_id: orgId ? support(orgId)?.id || null : null });
};
const nameOf = (u) => db.profiles[u]?.display_name || db.members.find((m) => m.user_id === u)?.display_name || null;
class Refused extends Error {}
const requireUid = () => { if (!uid()) throw new Refused('Entre na sua conta.'); return uid(); };
const requirePA = () => { requireUid(); if (!isPA()) throw new Refused('Acesso restrito ao administrador da plataforma.'); };
const E = (message) => ({ error: message });

function profileGet() {
  const u = requireUid(); const p = db.profiles[u];
  return {
    id: u, email: db.users[u]?.email, exists: !!p, display_name: p?.display_name, nick: p?.nick, photo_path: p?.photo_path,
    show_on_screen: (p?.show_on_screen ?? true) && !isMinor(p?.birth_date), birth_date: p?.birth_date, is_minor: isMinor(p?.birth_date),
    guardian_name: p?.guardian_name, guardian_email: p?.guardian_email, guardian_consent_at: p?.guardian_consent_at,
    complete: !!p && !!p.birth_date && (!isMinor(p.birth_date) || !!p.guardian_consent_at),
    is_platform_admin: isPA(),
    orgs: db.members.filter((m) => m.user_id === u).map((m) => { const o = orgById(m.org_id); return { id: o.id, slug: o.slug, name: o.name, kind: o.kind, org_status: o.status, role: m.role, status: m.status, permissions: myPerms(o.id) }; }),
    support: db.sessions.filter((s) => s.admin_id === u && !s.ended_at && new Date(s.expires_at) > new Date() && isPA())
      .map((s) => ({ id: s.id, org_id: s.org_id, org_slug: orgById(s.org_id)?.slug, org_name: orgById(s.org_id)?.name, reason: s.reason, expires_at: s.expires_at })),
  };
}

const rpcs = {
  tfl_profile_get: profileGet,
  tfl_profile_save({ p_name, p_nick, p_birth_date, p_guardian_name, p_guardian_email, p_guardian_consent, p_show_on_screen }) {
    const u = requireUid(); const name = (p_name || '').trim();
    if (name.length < 2 || name.length > 60) return E('Informe seu nome (2 a 60 letras).');
    if (!p_birth_date) return E('Informe sua data de nascimento.');
    const b = new Date(p_birth_date), min = new Date(new Date().setFullYear(new Date().getFullYear() - 5));
    if (isNaN(b) || b > min || b < new Date('1900-01-01')) return E('Data de nascimento inválida.');
    const minor = isMinor(p_birth_date);
    if (minor) {
      if ((p_guardian_name || '').trim().length < 2) return E('Menor de 18 anos: informe o nome do responsável.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p_guardian_email || '')) return E('Menor de 18 anos: informe o e-mail do responsável.');
      if (!p_guardian_consent) return E('Menor de 18 anos: é preciso a autorização do responsável.');
    }
    const old = db.profiles[u] || {};
    db.profiles[u] = { ...old, display_name: name, nick: (p_nick || '').trim() || null, birth_date: p_birth_date,
      guardian_name: minor ? p_guardian_name.trim() : null, guardian_email: minor ? p_guardian_email.trim().toLowerCase() : null,
      guardian_consent_at: minor ? old.guardian_consent_at || now() : null, show_on_screen: minor ? false : p_show_on_screen !== false,
      photo_path: old.photo_path || null };
    db.members.filter((m) => m.user_id === u).forEach((m) => { m.display_name = name; });
    log(null, 'profile.save', u, { minor });
    return profileGet();
  },
  tfl_profile_set_photo({ p_path, p_consent }) {
    const u = requireUid(); const p = db.profiles[u];
    if (!p) return E('Complete seu perfil antes de enviar a foto.');
    if (p_path != null) {
      if (!p_consent) return E('É preciso autorizar o uso da foto.');
      if (isMinor(p.birth_date) && !p.guardian_consent_at) return E('Menor de 18 anos: a foto precisa da autorização do responsável.');
      if (!new RegExp(`^${u}/[0-9]{10,16}\\.jpg$`).test(p_path)) return E('Caminho de foto inválido.');
      if (!db.files[p_path]) return E('A foto não chegou ao armazenamento. Tente de novo.');
    }
    const old = p.photo_path; p.photo_path = p_path; log(null, p_path ? 'photo.set' : 'photo.remove', u, { old, new: p_path });
    return { ok: true, photo_path: p_path, old_path: old };
  },
  tfl_join({ p_org, p_name }) {
    const u = requireUid(); const o = org(p_org);
    if (!o) return E('Empresa não encontrada.');
    if (o.status === 'suspended' || o.status === 'closed') return E('Esta liga não está aceitando novos membros.');
    const name = (p_name || '').trim(); if (name.length < 2 || name.length > 60) return E('Informe seu nome (2 a 60 letras).');
    if (!db.profiles[u]) db.profiles[u] = { display_name: name, nick: null, photo_path: null, show_on_screen: true, birth_date: null };
    if (!member(o.id, u)) db.members.push({ org_id: o.id, user_id: u, display_name: name, role: 'player', status: 'pending', created_at: now(), approved_at: null });
    const m = member(o.id, u);
    return { member: true, org_id: o.id, name: db.profiles[u].display_name, role: m.role, status: m.status, photo_path: db.profiles[u].photo_path };
  },
  tfl_org_overview({ p_org }) {
    requireUid(); const o = org(p_org); if (!o) return E('Empresa não encontrada.');
    const m = member(o.id); const s = support(o.id);
    if (!s && (!m || m.status !== 'approved')) return E('Você não tem acesso a esta empresa.');
    const ms = db.members.filter((x) => x.org_id === o.id); const manage = can(o.id, 'org.members');
    return { id: o.id, slug: o.slug, name: o.name, kind: o.kind, status: o.status, status_reason: o.status_reason, timezone: o.timezone,
      my_role: m?.role || null, permissions: myPerms(o.id), support_session_id: s?.id || null,
      counts: { approved: ms.filter((x) => x.status === 'approved').length, pending: manage ? ms.filter((x) => x.status === 'pending').length : null,
        blocked: manage ? ms.filter((x) => x.status === 'blocked').length : null, staff: ms.filter((x) => x.status === 'approved' && x.role !== 'player').length } };
  },
  tfl_org_members({ p_org }) {
    requireUid(); const o = org(p_org); if (!o) return E('Empresa não encontrada.');
    const manage = can(o.id, 'org.members');
    if (!manage && !isApproved(o.id)) return E('Você não tem acesso a esta empresa.');
    const order = { pending: 0, approved: 1, blocked: 2 };
    return { can_manage: manage, can_roles: can(o.id, 'org.roles'), members: db.members
      .filter((m) => m.org_id === o.id && (manage || m.status === 'approved'))
      .map((m) => { const p = db.profiles[m.user_id] || {}; return { user_id: m.user_id, name: p.display_name || m.display_name, nick: p.nick, photo_path: p.photo_path,
        role: m.role, status: m.status, joined_at: m.created_at, approved_at: m.approved_at, is_minor: manage ? isMinor(p.birth_date) : null,
        grants: db.grants.filter((g) => g.org_id === o.id && g.user_id === m.user_id).map((g) => ({ id: g.id, role: roleById(g.role_id)?.name, role_key: roleById(g.role_id)?.key, scope_type: g.scope_type, scope_id: g.scope_id })) }; })
      .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name)) };
  },
  tfl_admin_set_status({ p_org, p_user, p_status }) {
    const o = org(p_org); if (!can(o?.id, 'org.members')) return E('Você não tem permissão para aprovar ou bloquear membros.');
    if (!['pending', 'approved', 'blocked'].includes(p_status)) return E('Situação inválida.');
    if (p_user === uid()) return E('Você não pode mudar a própria situação.');
    const m = member(o.id, p_user); if (!m) return E('Jogador não encontrado.');
    if (m.role === 'owner' && !support(o.id)) return E('O gestor da empresa não pode ser bloqueado.');
    m.status = p_status; if (p_status === 'approved') m.approved_at = now();
    log(o.id, 'member.status', p_user, { status: p_status }); return { ok: true };
  },
  tfl_admin_remove_photo({ p_org, p_user, p_reason }) {
    const o = org(p_org); if (!can(o?.id, 'org.members')) return E('Você não tem permissão para remover fotos.');
    if (!member(o.id, p_user)) return E('Jogador não encontrado.');
    const p = db.profiles[p_user]; const old = p?.photo_path || null; if (p) p.photo_path = null;
    log(o.id, 'photo.admin_remove', p_user, { old, reason: p_reason }); return { ok: true, old_path: old };
  },
  tfl_org_set_role({ p_org, p_user, p_role }) {
    const o = org(p_org); if (!can(o?.id, 'org.roles')) return E('Só o gestor pode mudar papéis.');
    if (!['admin', 'organizer', 'player'].includes(p_role)) return E('Papel inválido.');
    const m = member(o.id, p_user); if (!m) return E('Membro não encontrado.');
    if (m.role === 'owner') return E('O papel de gestor não pode ser alterado aqui.');
    if (m.status !== 'approved' && p_role !== 'player') return E('Aprove o membro antes de dar um papel administrativo.');
    log(o.id, 'member.role', p_user, { from: m.role, to: p_role }); m.role = p_role; return { ok: true };
  },
  tfl_roles_list({ p_org }) {
    const o = org(p_org); if (!can(o?.id, 'org.roles')) return E('Só o gestor vê e edita papéis.');
    return { roles: [...SYSTEM_ROLES.map((r) => ({ ...r, system: true })), ...db.roles.filter((r) => r.org_id === o.id).map((r) => ({ ...r, system: false }))], permissions: PERMS };
  },
  tfl_role_save({ p_org, p_id, p_name, p_permissions }) {
    const o = org(p_org); if (!can(o?.id, 'org.roles')) return E('Só o gestor cria papéis.');
    const name = (p_name || '').trim(); if (name.length < 2 || name.length > 40) return E('Dê um nome ao papel (2 a 40 letras).');
    const bad = (p_permissions || []).find((x) => !ALL.includes(x)); if (bad) return E('Permissão desconhecida: ' + bad);
    if (p_permissions.includes('org.roles') || p_permissions.includes('org.billing')) return E('Dar acessos e assinatura ficam só com o gestor.');
    let r;
    if (!p_id) { r = { id: uuid(), org_id: o.id, key: 'custom-' + uuid().slice(0, 8), name, permissions: p_permissions }; db.roles.push(r); }
    else { r = db.roles.find((x) => x.id === p_id && x.org_id === o.id); if (!r) return E('Papel não encontrado.'); r.name = name; r.permissions = p_permissions; }
    log(o.id, 'role.save', null, { role: r.id, name, permissions: p_permissions }); return { ok: true, id: r.id };
  },
  tfl_grant_add({ p_org, p_user, p_role, p_scope_type = 'org', p_scope_id = null }) {
    const o = org(p_org); if (!can(o?.id, 'org.roles')) return E('Só o gestor dá acessos.');
    if (member(o.id, p_user)?.status !== 'approved') return E('Aprove o membro antes de dar acessos.');
    const r = roleById(p_role); if (!r || (r.org_id && r.org_id !== o.id)) return E('Papel inválido.');
    if (!r.org_id && ['owner', 'player'].includes(r.key)) return E('Esse papel não pode ser concedido.');
    if ((p_scope_type === 'org') !== (p_scope_id == null)) return E('Escopo inválido.');
    const g = { id: uuid(), org_id: o.id, user_id: p_user, role_id: p_role, scope_type: p_scope_type, scope_id: p_scope_id, granted_by: uid(), created_at: now() };
    db.grants.push(g); log(o.id, 'grant.add', p_user, { grant: g.id, role: p_role }); return { ok: true, id: g.id };
  },
  tfl_grant_remove({ p_org, p_grant }) {
    const o = org(p_org); if (!can(o?.id, 'org.roles')) return E('Só o gestor retira acessos.');
    const i = db.grants.findIndex((g) => g.id === p_grant && g.org_id === o.id); if (i < 0) return E('Acesso não encontrado.');
    const [g] = db.grants.splice(i, 1); log(o.id, 'grant.remove', g.user_id, { grant: p_grant }); return { ok: true };
  },
  tfl_org_update({ p_org, p_name, p_timezone }) {
    const o = org(p_org); if (!can(o?.id, 'org.settings')) return E('Você não pode editar a empresa.');
    const name = (p_name || '').trim(); if (name.length < 2 || name.length > 80) return E('Nome da empresa: 2 a 80 letras.');
    o.name = name; o.timezone = p_timezone; log(o.id, 'org.update', null, { name, timezone: p_timezone }); return { ok: true };
  },
  tfl_org_audit({ p_org }) {
    const o = org(p_org); if (!can(o?.id, 'org.settings')) return E('Você não tem acesso ao histórico da empresa.');
    return {
      events: db.audit.filter((a) => a.org_id === o.id).slice().reverse().slice(0, 100).map((a) => ({ at: a.at, action: a.action, detail: a.detail, support: !!a.support_session_id, actor: nameOf(a.actor) || 'Sistema', target: nameOf(a.target) })),
      support_sessions: db.sessions.filter((s) => s.org_id === o.id).slice().reverse().map((s) => ({ started_at: s.started_at, expires_at: s.expires_at, ended_at: s.ended_at, reason: s.reason, admin: nameOf(s.admin_id) || 'Suporte da plataforma' })),
    };
  },
  tfl_pa_overview() {
    requirePA(); const by = (arr, k) => arr.reduce((a, x) => ({ ...a, [x[k]]: (a[x[k]] || 0) + 1 }), {});
    const users = Object.values(db.users); const month = Date.now() - 30 * 864e5;
    return { orgs_total: db.orgs.length, orgs_by_status: by(db.orgs, 'status'), orgs_by_kind: by(db.orgs, 'kind'), users_total: users.length,
      users_new_30d: users.filter((u) => new Date(u.created_at) > month).length, users_active_30d: users.filter((u) => new Date(u.last_sign_in_at) > month).length,
      players_approved: new Set(db.members.filter((m) => m.status === 'approved').map((m) => m.user_id)).size,
      members_pending: db.members.filter((m) => m.status === 'pending').length,
      minors: Object.values(db.profiles).filter((p) => isMinor(p.birth_date)).length, photos: Object.values(db.profiles).filter((p) => p.photo_path).length,
      support_open: db.sessions.filter((s) => !s.ended_at && new Date(s.expires_at) > new Date()).length,
      not_collected_yet: ['campos', 'jogos agendados', 'jogos realizados', 'taxa de confirmação', 'grupos', 'assinaturas', 'receita recorrente', 'custos de mensagens'] };
  },
  tfl_pa_orgs() {
    requirePA();
    return db.orgs.map((o) => { const ms = db.members.filter((m) => m.org_id === o.id); const own = ms.find((m) => m.role === 'owner');
      const last = db.audit.filter((a) => a.org_id === o.id).map((a) => a.at).sort().pop() || null;
      return { id: o.id, slug: o.slug, name: o.name, kind: o.kind, status: o.status, status_reason: o.status_reason, created_at: o.created_at,
        owner: own ? nameOf(own.user_id) : null, approved: ms.filter((m) => m.status === 'approved').length, pending: ms.filter((m) => m.status === 'pending').length,
        last_activity: last, support_active: db.sessions.some((s) => s.org_id === o.id && !s.ended_at && new Date(s.expires_at) > new Date()) }; });
  },
  tfl_pa_org_create({ p_name, p_slug, p_kind, p_owner_email }) {
    requirePA(); const name = (p_name || '').trim(); const slug = (p_slug || '').trim().toLowerCase();
    if (name.length < 2 || name.length > 80) return E('Nome da empresa: 2 a 80 letras.');
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) return E('Endereço: só letras minúsculas, números e hífen (2 a 40).');
    if (!['venue_company', 'organizer', 'community'].includes(p_kind)) return E('Tipo de empresa inválido.');
    if (org(slug)) return E('Esse endereço já está em uso.');
    const owner = Object.keys(db.users).find((k) => db.users[k].email === (p_owner_email || '').trim().toLowerCase());
    if (!owner) return E('Não há conta com esse e-mail. Peça para a pessoa criar a conta primeiro.');
    const o = { id: uuid(), slug, name, kind: p_kind, status: 'active', status_reason: null, timezone: 'America/Sao_Paulo', created_at: now() };
    db.orgs.push(o);
    db.members.push({ org_id: o.id, user_id: owner, display_name: nameOf(owner), role: 'owner', status: 'approved', created_at: now(), approved_at: now() });
    log(o.id, 'org.create', owner, { name, slug, kind: p_kind }); return { ok: true, id: o.id, slug };
  },
  tfl_pa_org_set_status({ p_org_id, p_status, p_reason }) {
    requirePA(); if (!['trial', 'active', 'suspended', 'closed'].includes(p_status)) return E('Situação inválida.');
    if (['suspended', 'closed'].includes(p_status) && (p_reason || '').trim().length < 5) return E('Informe o motivo (mínimo 5 letras).');
    const o = orgById(p_org_id); if (!o) return E('Empresa não encontrada.');
    log(o.id, 'org.status', null, { from: o.status, to: p_status, reason: p_reason }); o.status = p_status; o.status_reason = (p_reason || '').trim() || null; return { ok: true };
  },
  tfl_support_start({ p_org_id, p_reason, p_minutes = 60 }) {
    requirePA(); const reason = (p_reason || '').trim();
    if (reason.length < 10 || reason.length > 300) return E('Descreva o motivo do suporte (10 a 300 letras).');
    if (!(p_minutes >= 5 && p_minutes <= 120)) return E('Duração entre 5 e 120 minutos.');
    const o = orgById(p_org_id); if (!o) return E('Empresa não encontrada.');
    db.sessions.filter((s) => s.admin_id === uid() && s.org_id === o.id && !s.ended_at).forEach((s) => { s.ended_at = now(); });
    const s = { id: uuid(), admin_id: uid(), org_id: o.id, reason, started_at: now(), expires_at: new Date(Date.now() + p_minutes * 60000).toISOString(), ended_at: null };
    db.sessions.push(s); db.audit.push({ at: now(), org_id: o.id, actor: uid(), action: 'support.start', target: null, detail: { reason, minutes: p_minutes }, support_session_id: s.id });
    return { ok: true, id: s.id, slug: o.slug };
  },
  tfl_support_end({ p_id }) {
    requirePA(); const s = db.sessions.find((x) => x.id === p_id && x.admin_id === uid() && !x.ended_at);
    if (!s) return E('Sessão não encontrada ou já encerrada.');
    s.ended_at = now(); db.audit.push({ at: now(), org_id: s.org_id, actor: uid(), action: 'support.end', target: null, detail: null, support_session_id: s.id }); return { ok: true };
  },
  tfl_pa_audit({ p_org_id = null } = {}) {
    requirePA();
    return db.audit.filter((a) => !p_org_id || a.org_id === p_org_id).slice().reverse().slice(0, 100)
      .map((a) => ({ at: a.at, action: a.action, detail: a.detail, support: !!a.support_session_id, org: orgById(a.org_id)?.name || null, actor: nameOf(a.actor) || 'Sistema', target: nameOf(a.target) }));
  },
};

// ---------------------------------------------------------------- Fase 2 (espelho de 20261112090000_fase2_operacao.sql)
const FEE = 6;
const venueById = (id) => db.venues.find((v) => v.id === id);
const groupById = (id) => db.groups.find((g) => g.id === id);
const inGroup = (gid) => { const g = groupById(gid); return !!g && isApproved(g.org_id) && db.group_members.some((x) => x.group_id === gid && x.user_id === uid() && x.status === 'active'); };
const canSeeMatch = (m) => !!m && (inGroup(m.group_id) || can(m.org_id, 'match.manage', 'group', m.group_id) || db.participants.some((p) => p.match_id === m.id && p.user_id === uid()));
const notify = (user, orgId, kind, title, body, link, dedupe) => {
  if (dedupe && db.notifications.some((n) => n.dedupe_key === dedupe)) return;
  db.notifications.push({ id: uuid(), user_id: user, org_id: orgId, kind, title, body, link, dedupe_key: dedupe, created_at: now(), read_at: null });
};
const fmtWhen = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' às');
const expireHolds = () => db.bookings.forEach((b) => { if (b.status === 'held' && new Date(b.hold_expires_at) < new Date()) b.status = 'expired'; });
const hoursOf = (vid) => db.venue_hours.filter((h) => h.venue_id === vid).sort((a, b) => a.weekday - b.weekday || a.opens.localeCompare(b.opens));
const toMin = (t) => (t === '00:00' ? 1440 : +t.slice(0, 2) * 60 + +t.slice(3, 5));
const overlap = (a1, a2, b1, b2) => new Date(a1) < new Date(b2) && new Date(b1) < new Date(a2);
const counts = (mid) => { const ps = db.participants.filter((p) => p.match_id === mid); const c = (s) => ps.filter((p) => p.status === s).length;
  return { confirmed: c('confirmed'), waitlist: c('waitlist'), pending: c('invited'), declined: c('declined') }; };

function bookingRequest(orgId, venueId, startsAt, minutes) {
  const v = venueById(venueId);
  if (!v || v.org_id !== orgId || v.status !== 'active') return E('Campo não encontrado ou inativo.');
  if (!(can(orgId, 'booking.manage', 'venue', venueId) || can(orgId, 'venue.manage'))) return E('Você não tem acesso para pedir horários neste campo.');
  if (!(minutes >= 30 && minutes <= 240) || minutes % 30) return E('Duração em blocos de 30 minutos, de 30 min a 4 h.');
  const start = new Date(startsAt);
  if (start < new Date(Date.now() + 180 * 60e3)) return E('Pedidos precisam de pelo menos 3 horas de antecedência.');
  if (start > new Date(Date.now() + 60 * 864e5)) return E('Só dá para pedir até 60 dias à frente.');
  const sMin = start.getHours() * 60 + start.getMinutes(), eMin = sMin + minutes;
  if (!hoursOf(venueId).some((h) => h.weekday === start.getDay() && toMin(h.opens) <= sMin && eMin <= toMin(h.closes))) return E('Esse horário não está entre os horários publicados do campo.');
  expireHolds();
  const ends = new Date(+start + minutes * 60e3).toISOString();
  if (db.bookings.some((b) => b.venue_id === venueId && ['held', 'confirmed'].includes(b.status) && overlap(b.starts_at, b.ends_at, start.toISOString(), ends))) return E('Esse horário acabou de ser pedido ou já está ocupado. Escolha outro.');
  const price = Math.round(v.price_per_hour_cents * minutes / 60), fee = Math.round(price * FEE / 100);
  const hold = new Date(Math.min(Date.now() + 24 * 3600e3, +start - 2 * 3600e3)).toISOString();
  const b = { id: uuid(), org_id: orgId, venue_id: venueId, starts_at: start.toISOString(), ends_at: ends, status: 'held', hold_expires_at: hold, requested_by: uid(),
    decided_by: null, decided_at: null, decision_note: null, hour_price_cents: v.price_per_hour_cents, fee_pct: FEE, price_cents: price, fee_cents: fee, total_cents: price + fee, created_at: now() };
  db.bookings.push(b); log(orgId, 'booking.request', null, { booking: b.id, venue: venueId });
  db.members.filter((m) => m.org_id === orgId && m.status === 'approved' && ['owner', 'admin'].includes(m.role))
    .forEach((m) => notify(m.user_id, orgId, 'booking.pending', 'Pedido de horário para confirmar', `${v.name} · ${fmtWhen(b.starts_at)}`, `#/o/${orgById(orgId).slug}/agenda`, `booking.pending:${b.id}:${m.user_id}`));
  return { ok: true, id: b.id, hold_expires_at: hold, price_cents: price, fee_cents: fee, total_cents: price + fee };
}

function fillFromWaitlist(m) {
  let free = m.capacity - counts(m.id).confirmed; let n = 0;
  const wait = db.participants.filter((p) => p.match_id === m.id && p.status === 'waitlist').sort((a, b) => a.responded_at.localeCompare(b.responded_at));
  for (const p of wait) {
    if (free <= 0) break;
    p.status = 'confirmed'; p.promoted_at = now(); free--; n++;
    notify(p.user_id, m.org_id, 'match.promoted', 'Abriu vaga: você está confirmado!', `${groupById(m.group_id).name} · ${fmtWhen(m.starts_at)}`, `#/jogo/${m.id}`, `match.promoted:${m.id}:${p.user_id}:${Date.now()}`);
  }
  return n;
}

Object.assign(rpcs, {
  tfl_venues_list({ p_org }) {
    const o = org(p_org); if (!o) return E('Empresa não encontrada.');
    const manage = can(o.id, 'venue.manage'); if (!manage && !isApproved(o.id)) return E('Você não tem acesso a esta empresa.');
    return { can_manage: manage, fee_pct: FEE, can_book: manage || can(o.id, 'booking.manage'), venues: db.venues.filter((v) => v.org_id === o.id && (manage || v.status === 'active'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((v) => ({ ...v, price_with_fee_cents: v.price_per_hour_cents + Math.round(v.price_per_hour_cents * FEE / 100), hours: hoursOf(v.id).map(({ weekday, opens, closes }) => ({ weekday, opens, closes })) })) };
  },
  tfl_venue_save({ p_org, p_id, p_name, p_surface, p_capacity, p_price_per_hour_cents, p_status, p_hours }) {
    const o = org(p_org); if (!can(o?.id, 'venue.manage')) return E('Você não pode gerenciar campos.');
    const name = (p_name || '').trim(); if (name.length < 2 || name.length > 60) return E('Nome do campo: 2 a 60 letras.');
    if (!(p_capacity >= 2 && p_capacity <= 40)) return E('Capacidade entre 2 e 40 jogadores.');
    if (!(p_price_per_hour_cents >= 0)) return E('Informe o preço da hora.');
    for (const h of p_hours || []) if (h.closes !== '00:00' && h.closes <= h.opens) return E('O horário de fechar precisa ser depois do de abrir.');
    let v;
    if (!p_id) { v = { id: uuid(), org_id: o.id }; db.venues.push(v); } else { v = db.venues.find((x) => x.id === p_id && x.org_id === o.id); if (!v) return E('Campo não encontrado.'); }
    Object.assign(v, { name, surface: (p_surface || '').trim() || null, capacity_players: p_capacity, price_per_hour_cents: p_price_per_hour_cents, status: p_status });
    db.venue_hours = db.venue_hours.filter((h) => h.venue_id !== v.id).concat((p_hours || []).map((h) => ({ venue_id: v.id, weekday: +h.weekday, opens: h.opens, closes: h.closes })));
    log(o.id, 'venue.save', null, { venue: v.id, name }); return { ok: true, id: v.id };
  },
  tfl_booking_request({ p_org, p_venue, p_starts_at, p_minutes }) { const o = org(p_org); return bookingRequest(o?.id, p_venue, p_starts_at, p_minutes); },
  tfl_booking_decide({ p_org, p_booking, p_approve, p_note }) {
    const o = org(p_org); if (!can(o?.id, 'venue.manage')) return E('Só quem gerencia os campos confirma reservas.');
    expireHolds(); const b = db.bookings.find((x) => x.id === p_booking && x.org_id === o.id); if (!b) return E('Reserva não encontrada.');
    if (b.status !== 'held') return E(`Esse pedido não está mais aguardando confirmação (${b.status}).`);
    Object.assign(b, { status: p_approve ? 'confirmed' : 'rejected', decided_by: uid(), decided_at: now(), decision_note: (p_note || '').trim() || null, hold_expires_at: null });
    log(o.id, p_approve ? 'booking.confirm' : 'booking.reject', b.requested_by, { booking: b.id });
    const mt = db.matches.find((m) => m.booking_id === b.id);
    notify(b.requested_by, o.id, p_approve ? 'booking.confirmed' : 'booking.rejected', p_approve ? 'Horário confirmado pelo campo' : 'Horário recusado pelo campo',
      `${venueById(b.venue_id).name} · ${fmtWhen(b.starts_at)}${b.decision_note ? ' · ' + b.decision_note : ''}`, mt ? `#/jogo/${mt.id}` : null, `booking.decided:${b.id}`);
    return { ok: true };
  },
  tfl_booking_cancel({ p_org, p_booking, p_reason }) {
    const o = org(p_org); const b = db.bookings.find((x) => x.id === p_booking && x.org_id === o?.id); if (!b) return E('Reserva não encontrada.');
    if (!(can(o.id, 'venue.manage') || (b.requested_by === uid() && can(o.id, 'booking.manage', 'venue', b.venue_id)))) return E('Você não pode cancelar esta reserva.');
    if (!['held', 'confirmed'].includes(b.status)) return E('Esta reserva já não está ativa.');
    Object.assign(b, { status: 'cancelled', decision_note: (p_reason || '').trim() || null, decided_at: now(), decided_by: uid() });
    log(o.id, 'booking.cancel', b.requested_by, { booking: b.id }); return { ok: true };
  },
  tfl_bookings_list({ p_org, p_from, p_to }) {
    const o = org(p_org); const manage = can(o?.id, 'venue.manage');
    const book = manage || can(o?.id, 'booking.manage') || db.grants.some((g) => g.org_id === o?.id && g.user_id === uid() && roleById(g.role_id)?.permissions.includes('booking.manage'));
    if (!book) return E('Você não tem acesso à agenda dos campos.');
    expireHolds();
    return { can_manage: manage, timezone: o.timezone, bookings: db.bookings.filter((b) => b.org_id === o.id && overlap(b.starts_at, b.ends_at, p_from, p_to) && (manage || b.requested_by === uid() || ['held', 'confirmed'].includes(b.status)))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at)).map((b) => { const vis = manage || b.requested_by === uid(); const mt = db.matches.find((m) => m.booking_id === b.id);
        return { id: b.id, venue_id: b.venue_id, venue: venueById(b.venue_id)?.name, starts_at: b.starts_at, ends_at: b.ends_at, status: b.status, hold_expires_at: b.hold_expires_at, mine: b.requested_by === uid(),
          requested_by: vis ? nameOf(b.requested_by) : null, price_cents: vis ? b.price_cents : null, fee_cents: vis ? b.fee_cents : null, total_cents: vis ? b.total_cents : null,
          decision_note: vis ? b.decision_note : null, match_id: mt?.id || null, group: mt ? groupById(mt.group_id)?.name : null }; }) };
  },
  tfl_groups_list({ p_org }) {
    const o = org(p_org); if (!o) return E('Empresa não encontrada.');
    if (!isApproved(o.id) && !support(o.id)) return E('Você não tem acesso a esta empresa.');
    return { can_create: can(o.id, 'group.manage'), groups: db.groups.filter((g) => g.org_id === o.id && g.status === 'active' && (can(o.id, 'group.manage', 'group', g.id) || can(o.id, 'match.manage', 'group', g.id)
        || db.group_members.some((x) => x.group_id === g.id && x.user_id === uid() && ['active', 'invited'].includes(x.status))))
      .sort((a, b) => a.name.localeCompare(b.name)).map((g) => { const nx = db.matches.filter((m) => m.group_id === g.id && m.status === 'open' && new Date(m.starts_at) > new Date()).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
        return { id: g.id, name: g.name, status: g.status, default_location: g.default_location, default_venue_id: g.default_venue_id, default_venue: venueById(g.default_venue_id)?.name || null,
          default_capacity: g.default_capacity, can_manage: can(o.id, 'group.manage', 'group', g.id), can_match: can(o.id, 'match.manage', 'group', g.id),
          my_status: db.group_members.find((x) => x.group_id === g.id && x.user_id === uid())?.status || null,
          members: db.group_members.filter((x) => x.group_id === g.id && x.status === 'active').length, invited: db.group_members.filter((x) => x.group_id === g.id && x.status === 'invited').length,
          next_match: nx ? { id: nx.id, starts_at: nx.starts_at } : null }; }) };
  },
  tfl_group_save({ p_org, p_id, p_name, p_default_venue, p_default_location, p_default_capacity }) {
    const o = org(p_org); if (!p_id && !can(o?.id, 'group.manage')) return E('Você não pode criar grupos.');
    if (p_id && !can(o?.id, 'group.manage', 'group', p_id)) return E('Você não pode editar este grupo.');
    const name = (p_name || '').trim(); if (name.length < 2 || name.length > 60) return E('Nome do grupo: 2 a 60 letras.');
    if (!(p_default_capacity >= 2 && p_default_capacity <= 60)) return E('Vagas por jogo: entre 2 e 60.');
    let g;
    if (!p_id) { g = { id: uuid(), org_id: o.id, status: 'active', created_by: uid() }; db.groups.push(g); db.group_members.push({ group_id: g.id, user_id: uid(), status: 'active', invited_by: uid(), invited_at: now(), joined_at: now() }); }
    else { g = groupById(p_id); if (!g || g.org_id !== o.id) return E('Grupo não encontrado.'); }
    Object.assign(g, { name, default_venue_id: p_default_venue || null, default_location: (p_default_location || '').trim() || null, default_capacity: p_default_capacity });
    log(o.id, 'group.save', null, { group: g.id, name }); return { ok: true, id: g.id };
  },
  tfl_group_get({ p_group }) {
    const g = groupById(p_group); if (!g) return E('Grupo não encontrado.');
    const manage = can(g.org_id, 'group.manage', 'group', g.id);
    if (!manage && !inGroup(g.id) && !can(g.org_id, 'match.manage', 'group', g.id)) return E('Você não tem acesso a este grupo.');
    const order = { active: 0, invited: 1 };
    return { id: g.id, org_slug: orgById(g.org_id).slug, name: g.name, default_venue: venueById(g.default_venue_id)?.name || null, default_venue_id: g.default_venue_id, default_location: g.default_location, default_capacity: g.default_capacity,
      can_manage: manage, can_match: can(g.org_id, 'match.manage', 'group', g.id),
      members: db.group_members.filter((x) => x.group_id === g.id && (manage || x.status === 'active')).map((x) => { const p = db.profiles[x.user_id] || {};
        return { user_id: x.user_id, status: x.status, name: p.nick || p.display_name, photo_path: p.photo_path, joined_at: x.joined_at }; })
        .sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2) || a.name.localeCompare(b.name)) };
  },
  tfl_group_invite({ p_group, p_users }) {
    const g = groupById(p_group); if (!g || !can(g.org_id, 'group.manage', 'group', g.id)) return E('Você não pode convidar para este grupo.');
    let n = 0;
    for (const u of p_users || []) {
      if (member(g.org_id, u)?.status !== 'approved') continue;
      let x = db.group_members.find((y) => y.group_id === g.id && y.user_id === u);
      if (x && !['declined', 'removed'].includes(x.status)) continue;
      if (!x) { x = { group_id: g.id, user_id: u }; db.group_members.push(x); }
      Object.assign(x, { status: 'invited', invited_by: uid(), invited_at: now(), joined_at: null }); n++;
      notify(u, g.org_id, 'group.invite', `Convite para o grupo ${g.name}`, 'Aceite para entrar nas listas de jogo.', '#/convites', `group.invite:${g.id}:${u}:${Date.now()}`);
    }
    log(g.org_id, 'group.invite', null, { group: g.id, count: n }); return { ok: true, invited: n };
  },
  tfl_group_respond({ p_group, p_accept }) {
    requireUid(); const g = groupById(p_group); if (!g) return E('Grupo não encontrado.');
    const x = db.group_members.find((y) => y.group_id === g.id && y.user_id === uid() && y.status === 'invited'); if (!x) return E('Não há convite pendente para este grupo.');
    if (p_accept && !isApproved(g.org_id)) return E('Sua conta precisa estar aprovada na liga.');
    x.status = p_accept ? 'active' : 'declined'; x.joined_at = p_accept ? now() : null;
    if (p_accept) db.matches.filter((m) => m.group_id === g.id && m.status === 'open' && new Date(m.starts_at) > new Date())
      .forEach((m) => { if (!db.participants.some((p) => p.match_id === m.id && p.user_id === uid())) db.participants.push({ match_id: m.id, user_id: uid(), status: 'invited', responded_at: null, promoted_at: null }); });
    return { ok: true };
  },
  tfl_group_remove({ p_group, p_user }) {
    const g = groupById(p_group); if (!g || !(can(g.org_id, 'group.manage', 'group', g.id) || p_user === uid())) return E('Você não pode remover este membro.');
    const x = db.group_members.find((y) => y.group_id === g.id && y.user_id === p_user); if (x) x.status = 'removed';
    log(g.org_id, 'group.remove', p_user, { group: g.id }); return { ok: true };
  },
  tfl_my_invites() {
    return db.group_members.filter((x) => x.user_id === uid() && x.status === 'invited').map((x) => { const g = groupById(x.group_id); const o = orgById(g.org_id);
      return { group_id: g.id, group: g.name, org: o.name, org_slug: o.slug, invited_by: nameOf(x.invited_by), invited_at: x.invited_at, org_status: member(o.id)?.status || null }; });
  },
  tfl_match_create({ p_org, p_group, p_starts_at, p_minutes, p_capacity, p_venue = null, p_location = null, p_notes = null }) {
    const o = org(p_org); const g = groupById(p_group); if (!g || g.org_id !== o?.id) return E('Grupo não encontrado.');
    if (!can(o.id, 'match.manage', 'group', g.id)) return E('Você não pode criar jogos neste grupo.');
    if (!(p_capacity >= 2 && p_capacity <= 60)) return E('Vagas entre 2 e 60.');
    if (!(p_minutes >= 30 && p_minutes <= 240)) return E('Duração entre 30 minutos e 4 horas.');
    if (new Date(p_starts_at) < new Date(Date.now() + 30 * 60e3)) return E('O jogo precisa começar pelo menos 30 minutos a partir de agora.');
    const loc = (p_location || '').trim() || null;
    if (!p_venue && !loc) return E('Escolha um campo da empresa ou escreva o local.');
    let bk = null;
    if (p_venue) {
      if (p_capacity > (venueById(p_venue)?.org_id === o.id ? venueById(p_venue).capacity_players : 0)) return E('Vagas acima da capacidade do campo (ou campo inválido).');
      bk = bookingRequest(o.id, p_venue, p_starts_at, p_minutes); if (bk.error) return bk;
    }
    const m = { id: uuid(), org_id: o.id, group_id: g.id, venue_id: p_venue || null, booking_id: bk?.id || null, location_text: p_venue ? null : loc, starts_at: new Date(p_starts_at).toISOString(),
      ends_at: new Date(+new Date(p_starts_at) + p_minutes * 60e3).toISOString(), capacity: p_capacity, status: 'open', notes: (p_notes || '').trim() || null, version: 1, created_by: uid() };
    db.matches.push(m);
    db.group_members.filter((x) => x.group_id === g.id && x.status === 'active' && member(o.id, x.user_id)?.status === 'approved').forEach((x) => {
      db.participants.push({ match_id: m.id, user_id: x.user_id, status: 'invited', responded_at: null, promoted_at: null });
      notify(x.user_id, o.id, 'match.invite', `Jogo marcado: ${g.name}`, `${fmtWhen(m.starts_at)} · ${venueById(p_venue)?.name || loc}. Confirme sua presença!`, `#/jogo/${m.id}`, `match.invite:${m.id}:${x.user_id}`);
    });
    log(o.id, 'match.create', null, { match: m.id, group: g.id }); return { ok: true, id: m.id, booking: bk };
  },
  tfl_match_rsvp({ p_match, p_going }) {
    requireUid(); const m = db.matches.find((x) => x.id === p_match); if (!m) return E('Jogo não encontrado.');
    if (m.status !== 'open') return E('A lista deste jogo está fechada.');
    if (new Date(m.starts_at) <= new Date()) return E('O jogo já começou.');
    if (!isApproved(m.org_id)) return E('Sua conta precisa estar aprovada na liga.');
    let p = db.participants.find((x) => x.match_id === m.id && x.user_id === uid());
    if (!p) { if (!inGroup(m.group_id)) return E('Você não faz parte do grupo deste jogo.'); p = { match_id: m.id, user_id: uid(), status: 'invited', responded_at: null, promoted_at: null }; db.participants.push(p); }
    if (p.status === 'removed') return E('O organizador tirou você deste jogo.');
    if (p_going) {
      if (['confirmed', 'waitlist'].includes(p.status)) return { ok: true, status: p.status };
      p.status = counts(m.id).confirmed < m.capacity ? 'confirmed' : 'waitlist'; p.responded_at = now(); p.promoted_at = null;
    } else {
      if (p.status === 'declined') return { ok: true, status: 'declined' };
      const prev = p.status; p.status = 'declined'; p.responded_at = now();
      if (prev === 'confirmed') fillFromWaitlist(m);
    }
    return { ok: true, status: p.status };
  },
  tfl_match_get({ p_match }) {
    expireHolds(); const m = db.matches.find((x) => x.id === p_match);
    if (!m || !canSeeMatch(m)) return E('Jogo não encontrado ou sem acesso.');
    const manage = can(m.org_id, 'match.manage', 'group', m.group_id); const b = db.bookings.find((x) => x.id === m.booking_id);
    const order = { confirmed: 0, waitlist: 1, invited: 2, declined: 3 };
    const ps = db.participants.filter((x) => x.match_id === m.id && (manage || x.status !== 'removed'));
    const wl = ps.filter((x) => x.status === 'waitlist').sort((a, c) => a.responded_at.localeCompare(c.responded_at));
    return { id: m.id, org_slug: orgById(m.org_id).slug, org: orgById(m.org_id).name, timezone: orgById(m.org_id).timezone, group_id: m.group_id, group: groupById(m.group_id).name,
      starts_at: m.starts_at, ends_at: m.ends_at, capacity: m.capacity, status: m.status, notes: m.notes, version: m.version, venue: venueById(m.venue_id)?.name || null, location: m.location_text,
      booking: b ? { status: b.status, hold_expires_at: b.hold_expires_at, total_cents: manage ? b.total_cents : null, fee_cents: manage ? b.fee_cents : null, price_cents: manage ? b.price_cents : null } : null,
      can_manage: manage, me: db.participants.find((x) => x.match_id === m.id && x.user_id === uid())?.status || null, counts: counts(m.id),
      people: ps.map((x) => { const p = db.profiles[x.user_id] || {}; return { user_id: x.user_id, status: x.status, responded_at: x.responded_at, promoted_at: x.promoted_at, name: p.nick || p.display_name,
        photo_path: p.photo_path, waitlist_pos: x.status === 'waitlist' ? wl.indexOf(x) + 1 : null }; })
        .sort((a, c) => (order[a.status] ?? 4) - (order[c.status] ?? 4) || (a.responded_at || '9').localeCompare(c.responded_at || '9') || a.name.localeCompare(c.name)) };
  },
  tfl_matches_list({ p_org, p_from, p_to }) {
    const o = org(p_org); if (!o || (!isApproved(o.id) && !support(o.id))) return E('Você não tem acesso a esta empresa.');
    expireHolds();
    return { matches: db.matches.filter((m) => m.org_id === o.id && m.starts_at >= p_from && m.starts_at < p_to && canSeeMatch(m)).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map((m) => ({ id: m.id, group: groupById(m.group_id).name, group_id: m.group_id, starts_at: m.starts_at, ends_at: m.ends_at, status: m.status, capacity: m.capacity,
        venue: venueById(m.venue_id)?.name || null, location: m.location_text, booking_status: db.bookings.find((b) => b.id === m.booking_id)?.status || null,
        can_manage: can(o.id, 'match.manage', 'group', m.group_id), ...counts(m.id) })) };
  },
  tfl_my_matches() {
    return db.participants.filter((p) => p.user_id === uid() && p.status !== 'removed').map((p) => db.matches.find((m) => m.id === p.match_id))
      .filter((m) => m && new Date(m.starts_at) > new Date(Date.now() - 3 * 3600e3) && ['open', 'closed'].includes(m.status) && isApproved(m.org_id))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at)).map((m) => { const o = orgById(m.org_id);
        return { id: m.id, org: o.name, org_slug: o.slug, group: groupById(m.group_id).name, starts_at: m.starts_at, ends_at: m.ends_at, status: m.status, capacity: m.capacity, timezone: o.timezone,
          venue: venueById(m.venue_id)?.name || null, location: m.location_text, booking_status: db.bookings.find((b) => b.id === m.booking_id)?.status || null,
          me: db.participants.find((p) => p.match_id === m.id && p.user_id === uid()).status, confirmed: counts(m.id).confirmed }; });
  },
  tfl_match_update({ p_match, p_capacity, p_status, p_notes }) {
    const m = db.matches.find((x) => x.id === p_match); if (!m || !can(m.org_id, 'match.manage', 'group', m.group_id)) return E('Você não pode editar este jogo.');
    if (['cancelled', 'played'].includes(m.status)) return E('Este jogo já foi encerrado.');
    if (!['open', 'closed'].includes(p_status)) return E('Situação inválida.');
    if (!(p_capacity >= 2 && p_capacity <= 60)) return E('Vagas entre 2 e 60.');
    const conf = counts(m.id).confirmed; if (p_capacity < conf) return E(`Já há ${conf} confirmados. Para reduzir as vagas, tire alguém antes.`);
    const grew = p_capacity > m.capacity; Object.assign(m, { capacity: p_capacity, status: p_status, notes: (p_notes || '').trim() || null });
    const n = grew && p_status === 'open' ? fillFromWaitlist(m) : 0; log(m.org_id, 'match.update', null, { match: m.id }); return { ok: true, promoted: n };
  },
  tfl_match_set_player({ p_match, p_user, p_remove }) {
    const m = db.matches.find((x) => x.id === p_match); if (!m || !can(m.org_id, 'match.manage', 'group', m.group_id)) return E('Você não pode editar este jogo.');
    const p = db.participants.find((x) => x.match_id === m.id && x.user_id === p_user); if (!p) return E('Jogador não está neste jogo.');
    const prev = p.status; Object.assign(p, { status: p_remove ? 'removed' : 'invited', responded_at: null, promoted_at: null });
    if (p_remove && prev === 'confirmed' && m.status === 'open') fillFromWaitlist(m);
    log(m.org_id, p_remove ? 'match.remove_player' : 'match.restore_player', p_user, { match: m.id }); return { ok: true };
  },
  tfl_match_cancel({ p_match, p_reason }) {
    const m = db.matches.find((x) => x.id === p_match); if (!m || !can(m.org_id, 'match.manage', 'group', m.group_id)) return E('Você não pode cancelar este jogo.');
    if (m.status === 'cancelled') return E('Este jogo já foi cancelado.');
    const reason = (p_reason || '').trim(); if (reason.length < 5) return E('Informe o motivo do cancelamento (mínimo 5 letras).');
    m.status = 'cancelled'; m.version++; m.notes = ((m.notes ? m.notes + '\n' : '') + 'Cancelado: ' + reason).slice(0, 500);
    const b = db.bookings.find((x) => x.id === m.booking_id && ['held', 'confirmed'].includes(x.status)); if (b) Object.assign(b, { status: 'cancelled', decision_note: 'Jogo cancelado: ' + reason });
    db.participants.filter((p) => p.match_id === m.id && ['confirmed', 'waitlist', 'invited'].includes(p.status))
      .forEach((p) => notify(p.user_id, m.org_id, 'match.cancelled', `Jogo cancelado: ${groupById(m.group_id).name}`, `${fmtWhen(m.starts_at)} · ${reason}`, `#/jogo/${m.id}`, `match.cancelled:${m.id}:${p.user_id}`));
    log(m.org_id, 'match.cancel', null, { match: m.id, reason }); return { ok: true };
  },
  tfl_notifications({ p_limit = 30 } = {}) {
    const mine = db.notifications.filter((n) => n.user_id === uid()).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { unread: mine.filter((n) => !n.read_at).length, items: mine.slice(0, p_limit).map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, created_at: n.created_at, read: !!n.read_at })) };
  },
  tfl_notifications_read({ p_id = null } = {}) {
    db.notifications.filter((n) => n.user_id === uid() && !n.read_at && (!p_id || n.id === p_id)).forEach((n) => { n.read_at = now(); }); return { ok: true };
  },
});

// Tempo real simulado: avisa as telas inscritas depois de cada mudança (nesta aba e nas outras).
const rtListeners = new Set();
const fireRealtime = () => rtListeners.forEach((fn) => { try { fn(); } catch {} });
try { addEventListener('storage', (e) => { if (e.key === KEY) { db = load() || db; fireRealtime(); } }); } catch {}

const delay = (v) => new Promise((r) => setTimeout(() => r(v), 90));
const authUser = (id) => (id && db.users[id] ? { id, email: db.users[id].email, user_metadata: { name: db.users[id].name } } : null);
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn('CHANGE', uid() ? { user: authUser(uid()) } : null));

export function createMockClient() {
  return {
    auth: {
      async getSession() { return { data: { session: uid() ? { user: authUser(uid()) } : null }, error: null }; },
      onAuthStateChange(fn) { listeners.add(fn); return { data: { subscription: { unsubscribe() { listeners.delete(fn); } } } }; },
      async signUp({ email, password, options }) {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { data: {}, error: { message: 'Unable to validate email address: invalid format' } };
        if (password.length < 8) return { data: {}, error: { message: 'Password should be at least 8 characters' } };
        if (Object.values(db.users).some((u) => u.email === email)) return { data: {}, error: { message: 'User already registered' } };
        const id = uuid(); db.users[id] = { email, password, name: options?.data?.name, created_at: now(), last_sign_in_at: now() };
        db.session = id; save(); emit(); return delay({ data: { user: authUser(id), session: { user: authUser(id) } }, error: null });
      },
      async signInWithPassword({ email, password }) {
        const id = Object.keys(db.users).find((k) => db.users[k].email === email && db.users[k].password === password);
        if (!id) return delay({ data: {}, error: { message: 'Invalid login credentials' } });
        db.session = id; db.users[id].last_sign_in_at = now(); save(); emit(); return delay({ data: { user: authUser(id), session: {} }, error: null });
      },
      async signOut() { db.session = null; save(); emit(); return { error: null }; },
    },
    async rpc(name, args) {
      const fn = rpcs[name]; if (!fn) return { data: null, error: { message: `função ${name} não existe no simulador` } };
      try { const data = fn(args || {}); save(); if (!/^tfl_(.*_list|.*_get|my_|notifications$|venues_list|roles_list|pa_|org_overview|org_members|org_audit)/.test(name)) setTimeout(fireRealtime, 120); return delay({ data, error: null }); }
      catch (e) { if (e instanceof Refused) return delay({ data: null, error: { message: e.message } }); throw e; }
    },
    // Mesmo formato do Supabase Realtime: channel().on('postgres_changes', ...).subscribe()
    channel() {
      let cb = null;
      const ch = { on(_t, _cfg, fn) { cb = fn; return ch; }, subscribe() { if (cb) rtListeners.add(cb); return ch; } };
      ch._cb = () => cb;
      return ch;
    },
    removeChannel(ch) { const cb = ch?._cb?.(); if (cb) rtListeners.delete(cb); },
    storage: {
      from() {
        return {
          async upload(path, blob, opts) {
            if (!uid() || path.split('/')[0] !== uid()) return { error: { message: 'new row violates row-level security policy' } };
            if ((opts?.contentType || blob.type) !== 'image/jpeg') return { error: { message: 'mime type not supported' } };
            if (blob.size > 2 * 1024 * 1024) return { error: { message: 'The object exceeded the maximum allowed size' } };
            db.files[path] = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
            save(); return delay({ data: { path }, error: null });
          },
          async createSignedUrl(path) { return db.files[path] ? { data: { signedUrl: db.files[path] }, error: null } : { data: null, error: { message: 'Object not found' } }; },
          async remove(paths) { paths.forEach((p) => { if (p.split('/')[0] === uid()) delete db.files[p]; }); save(); return { data: paths, error: null }; },
        };
      },
    },
  };
}
