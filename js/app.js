// Casca do app: sessão, rotas e navegação por perfil.
import { html, render, useState, useEffect, useCallback, AppCtx, useRoute, href, go, Toasts, Ava, Icon, act } from './ui.js';
import { createApi } from './api.js';
import { PRODUCT } from './config.js';
import { LoginPage } from './screens/login.js';
import { ProfilePage } from './screens/profile.js';
import { HomePage } from './screens/home.js';
import { AdminPage } from './screens/admin.js';
import { OrgPage } from './screens/org.js';
import { GroupPage, MatchPage } from './screens/matches.js';
import { Bell, InvitesPage, MyMatchesPage } from './screens/notify.js';

function App({ api }) {
  const [me, setMe] = useState(undefined); // undefined = carregando; null = sem conta
  const route = useRoute();

  const refreshMe = useCallback(async () => {
    const user = await api.session();
    if (!user) { setMe(null); return null; }
    try { const p = await api.rpc('tfl_profile_get'); setMe(p); return p; }
    catch { setMe(null); return null; }
  }, []);
  useEffect(() => { refreshMe(); const sub = api.onAuth(() => refreshMe()); return () => sub?.data?.subscription?.unsubscribe?.(); }, []);

  const ctx = { api, me, refreshMe };
  if (me === undefined) return html`<div class="auth-wrap"><p class="muted">Carregando…</p></div>`;

  const [r0, r1, r2] = route;
  let page;
  if (!me) page = html`<${LoginPage} />`;
  else if (!me.complete && r0 !== 'sair') page = html`<${ProfilePage} complete=${true} />`;
  else if (r0 === 'perfil') page = html`<${ProfilePage} />`;
  else if (r0 === 'admin') page = html`<${AdminPage} tab=${r1 || ''} />`;
  else if (r0 === 'o' && r1) page = html`<${OrgPage} slug=${r1} tab=${r2 || ''} key=${r1} />`;
  else if (r0 === 'jogo' && r1) page = html`<${MatchPage} id=${r1} key=${r1} />`;
  else if (r0 === 'grupo' && r1) page = html`<${GroupPage} id=${r1} key=${r1} />`;
  else if (r0 === 'jogos') page = html`<${MyMatchesPage} />`;
  else if (r0 === 'convites') page = html`<${InvitesPage} />`;
  else page = html`<${HomePage} />`;

  // Toda liga aprovada aparece (jogos e grupos valem para todos); o painel mostra só as abas permitidas.
  const panels = me ? me.orgs.filter((o) => o.status === 'approved') : [];
  const supports = me?.support || [];
  const nav = me && me.complete ? [
    ['', 'Início', Icon.home, !['perfil', 'admin', 'o', 'jogos', 'jogo', 'grupo', 'convites'].includes(r0)],
    ['jogos', 'Meus jogos', Icon.ball, r0 === 'jogos' || r0 === 'jogo'],
    ...panels.map((o) => ['o/' + o.slug, o.name, Icon.org, r0 === 'o' && r1 === o.slug]),
    ...(me.is_platform_admin ? [['admin', 'Super admin', Icon.shield, r0 === 'admin']] : []),
    ['perfil', 'Perfil', Icon.user, r0 === 'perfil'],
  ] : [];

  const endSupport = async (s) => { if (await act(() => api.rpc('tfl_support_end', { p_id: s.id }), 'Sessão de suporte encerrada')) { await refreshMe(); go('admin/empresas'); } };

  return html`<${AppCtx.Provider} value=${ctx}>
    <div class="shell">
      ${supports.map((s) => html`<div class="support-bar" role="status" key=${s.id}>
        <span>Modo suporte em ${s.org_name} · ${s.reason} · até ${new Date(s.expires_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
        <a href=${href('o/' + s.org_slug)} style="color:#ffe1a1">Abrir painel</a>
        <button onClick=${() => endSupport(s)}>Encerrar</button></div>`)}
      ${api.env !== 'prod' && html`<div class="env-flag">${api.env === 'mock' ? 'Modo de teste: banco simulado neste navegador, pessoas fictícias' : 'Ambiente de testes'}</div>`}
      <header class="appbar">
        <a class="brand" href="#/" aria-label=${PRODUCT.name}><img src="assets/logo-branco.png" alt="Tutory" /></a>
        <nav aria-label="Principal">${nav.map(([p, l, , on]) => html`<a href=${href(p)} class=${on ? 'on' : ''}>${l}</a>`)}</nav>
        <span class="spacer"></span>
        ${me && me.complete && html`<${Bell} />`}
        ${me ? html`<a class="who" href=${href('perfil')}><span style="text-align:right"><b>${me.nick || me.display_name}</b><small>${me.is_platform_admin ? 'Super admin' : (me.orgs[0]?.name || 'Sem liga')}</small></span>
            <${Ava} path=${me.photo_path} name=${me.display_name || ''} size=${36} /></a>
            <button class="btn sm ghost" onClick=${async () => { await api.signOut(); await refreshMe(); location.hash = '#/'; }}>Sair</button>`
          : html`<a class="btn sm primary" href="#/">Entrar</a>`}
      </header>
      <main class=${'main' + (r0 === undefined || (!['perfil', 'admin', 'o'].includes(r0)) ? ' home' : '')}>${page}</main>
      ${nav.length > 0 && html`<nav class="mobile-nav" aria-label="Principal (celular)">${nav.slice(0, 4).map(([p, l, ic, on]) => html`<a href=${href(p)} class=${on ? 'on' : ''}>${ic}<span>${l.length > 10 ? l.slice(0, 9) + '…' : l}</span></a>`)}</nav>`}
    </div>
    <${Toasts} />
    ${api.env === 'mock' && html`<${MockBar} />`}
  <//>`;
}

function MockBar() {
  const [mod, setMod] = useState(null);
  useEffect(() => { import('./mock.js').then(setMod); }, []);
  if (!mod) return null;
  const change = (e) => { mod.mockSwitch(e.target.value || null); location.hash = '#/'; location.reload(); };
  return html`<div class="mock-bar"><span>Modo de teste · pessoa:</span>
    <select value=${mod.mockPersona()} onChange=${change}><option value="">(ninguém logado)</option>${mod.PERSONAS.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
    <button class="btn sm" onClick=${() => { mod.mockReset(); location.reload(); }} title="Volta os dados de exemplo ao início">Zerar</button></div>`;
}

(async () => {
  const root = document.getElementById('app');
  try {
    const api = await createApi();
    render(html`<${App} api=${api} />`, root);
  } catch (e) {
    root.innerHTML = `<div class="auth-wrap"><div class="auth-card"><h1>Não deu para iniciar</h1><p class="muted">${e.message}</p></div></div>`;
  }
})();
