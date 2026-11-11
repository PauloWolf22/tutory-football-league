// Entrar e criar conta. O cadastro já pede nascimento e, para menores, o responsável.
import { html, useState, useApp, toast, ageFrom } from '../ui.js';
import { ProfileFields, profileToForm, saveProfile } from './profile.js';
import { DEFAULT_ORG, PRODUCT } from '../config.js';

export function LoginPage() {
  const { api, refreshMe } = useApp();
  const [mode, setMode] = useState('in');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [v, setV] = useState(profileToForm(null));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch) => setV((x) => ({ ...x, ...patch }));
  // Convite para uma liga específica: #/entrar?liga=<endereço>
  const liga = new URLSearchParams(location.hash.split('?')[1] || '').get('liga') || DEFAULT_ORG;

  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setErr('Informe um e-mail válido.'); return; }
    if (pass.length < (mode === 'up' ? 8 : 1)) { setErr(mode === 'up' ? 'A senha precisa ter pelo menos 8 caracteres.' : 'Informe a senha.'); return; }
    setBusy(true);
    try {
      if (mode === 'in') {
        await api.signIn(email, pass);
      } else {
        if (v.name.trim().length < 2) throw new Error('Informe seu nome.');
        if (!v.birth_date) throw new Error('Informe sua data de nascimento.');
        // Menor: confere o responsável ANTES de criar a conta (o banco confere de novo ao salvar).
        if (ageFrom(v.birth_date) < 18) {
          if (v.guardian_name.trim().length < 2) throw new Error('Menor de 18 anos: informe o nome do responsável.');
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.guardian_email.trim())) throw new Error('Menor de 18 anos: informe o e-mail do responsável.');
          if (!v.guardian_consent) throw new Error('Menor de 18 anos: é preciso a autorização do responsável.');
        }
        await api.signUp(email, pass, v.name.trim());
        await saveProfile(api, v);
        // A conta já existe; se entrar na liga falhar (endereço errado, liga suspensa), avisa sem travar.
        await api.rpc('tfl_join', { p_org: liga, p_name: v.name.trim() }).catch((e) => toast(`Conta criada, mas não deu para entrar na liga: ${e.message}`, 'error'));
      }
      const me = await refreshMe();
      toast(`Olá, ${(me?.display_name || '').split(' ')[0] || 'craque'}!`);
      location.hash = '#/';
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };

  return html`<div class="auth-wrap"><form class="auth-card form" onSubmit=${submit} novalidate>
    <div>
      <div class="eyebrow">${PRODUCT.name}</div>
      <h1>${mode === 'in' ? 'Entrar' : 'Criar conta'}</h1>
      <p class="muted small">${mode === 'in' ? 'Use o e-mail e a senha da sua conta.' : 'Uma conta vale para todas as ligas de que você participar.'}</p>
    </div>
    <div class="seg" role="tablist">
      <button type="button" role="tab" aria-selected=${mode === 'in'} class=${mode === 'in' ? 'on' : ''} onClick=${() => { setMode('in'); setErr(''); }}>Entrar</button>
      <button type="button" role="tab" aria-selected=${mode === 'up'} class=${mode === 'up' ? 'on' : ''} onClick=${() => { setMode('up'); setErr(''); }}>Criar conta</button>
    </div>
    ${mode === 'up' && html`<${ProfileFields} v=${v} set=${set} showScreenToggle=${false} />`}
    <label class="field">E-mail<input type="email" value=${email} onInput=${(e) => setEmail(e.target.value)} autocomplete="email" inputmode="email" /></label>
    <label class="field">Senha<input type="password" value=${pass} onInput=${(e) => setPass(e.target.value)} autocomplete=${mode === 'up' ? 'new-password' : 'current-password'} />
      ${mode === 'up' && html`<span class="hint">Mínimo de 8 caracteres.</span>`}</label>
    <div class="form-error" role="alert">${err}</div>
    <button class="btn primary" type="submit" aria-busy=${busy ? 'true' : 'false'}>${mode === 'in' ? 'Entrar' : 'Criar conta'}</button>
    ${api.env === 'mock' && html`<p class="small muted">Modo de teste: contas de exemplo usam a senha <b>teste1234</b>, ou troque de pessoa na barra amarela.</p>`}
  </form></div>`;
}
