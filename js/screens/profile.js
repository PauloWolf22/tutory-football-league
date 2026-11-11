// Perfil global do jogador: dados, nascimento, responsável (menores), foto, telão e ligas.
import { html, useState, useApp, act, toast, go, Ava, ageFrom, fmtDateTime, ROLE_LABEL, STATUS_LABEL, STATUS_CLASS, href } from '../ui.js';
import { PhotoDialog } from './photo.js';

const isMinorDate = (d) => { const a = ageFrom(d); return a !== null && a < 18; };

// Campos do perfil, usados no cadastro e na edição.
export function ProfileFields({ v, set, showScreenToggle = true }) {
  const minor = isMinorDate(v.birth_date);
  const age = ageFrom(v.birth_date);
  return html`
    <label class="field">Seu nome
      <input value=${v.name} onInput=${(e) => set({ name: e.target.value })} autocomplete="name" maxlength="60" required />
    </label>
    <label class="field">Apelido no campo <span class="hint">opcional, aparece no lugar do nome</span>
      <input value=${v.nick} onInput=${(e) => set({ nick: e.target.value })} maxlength="30" />
    </label>
    <label class="field">Data de nascimento
      <input type="date" value=${v.birth_date} max=${new Date().toISOString().slice(0, 10)} onInput=${(e) => set({ birth_date: e.target.value })} required />
      ${age !== null && html`<span class="hint">${age} anos${minor ? ' · menor de idade' : ''}</span>`}
    </label>
    ${minor && html`
      <fieldset class="fieldset">
        <legend>Responsável legal</legend>
        <p class="small muted">Menores de 18 anos só participam com a autorização de um responsável. Por padrão, não aparecem no telão nem nos rankings públicos.</p>
        <label class="field">Nome do responsável
          <input value=${v.guardian_name} onInput=${(e) => set({ guardian_name: e.target.value })} maxlength="80" />
        </label>
        <label class="field">E-mail do responsável
          <input type="email" value=${v.guardian_email} onInput=${(e) => set({ guardian_email: e.target.value })} />
        </label>
        <label class="check"><input type="checkbox" checked=${v.guardian_consent} onChange=${(e) => set({ guardian_consent: e.target.checked })} />
          <span>Sou o responsável (ou tenho a autorização dele) e autorizo a participação, o cadastro e a foto no card.</span></label>
      </fieldset>`}
    ${showScreenToggle && !minor && html`
      <label class="check"><input type="checkbox" checked=${v.show_on_screen} onChange=${(e) => set({ show_on_screen: e.target.checked })} />
        <span>Aparecer com foto e primeiro nome no telão dos sorteios</span></label>`}
  `;
}

export const profileToForm = (p) => ({
  name: p?.display_name || '', nick: p?.nick || '', birth_date: p?.birth_date || '',
  guardian_name: p?.guardian_name || '', guardian_email: p?.guardian_email || '', guardian_consent: !!p?.guardian_consent_at,
  show_on_screen: p?.show_on_screen !== false,
});

export async function saveProfile(api, v) {
  return api.rpc('tfl_profile_save', {
    p_name: v.name, p_nick: v.nick, p_birth_date: v.birth_date || null,
    p_guardian_name: v.guardian_name || null, p_guardian_email: v.guardian_email || null,
    p_guardian_consent: !!v.guardian_consent, p_show_on_screen: !!v.show_on_screen,
  });
}

export function ProfilePage({ complete = false }) {
  const { api, me, refreshMe } = useApp();
  const [v, setV] = useState(profileToForm(me));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const set = (patch) => setV((x) => ({ ...x, ...patch }));

  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await saveProfile(api, v); await refreshMe(); toast('Perfil salvo'); if (complete) go(''); }
    catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };

  return html`
    <div class="page-head">
      <div>
        <div class="eyebrow">${complete ? 'Falta pouco' : 'Sua conta'}</div>
        <h1>${complete ? 'Complete seu perfil' : 'Meu perfil'}</h1>
        <p>${complete ? 'Precisamos da sua data de nascimento antes de continuar. Ela não aparece para ninguém.' : 'Um perfil único vale em todas as ligas de que você participa.'}</p>
      </div>
    </div>
    <div class="grid two">
      <form class="panel form" onSubmit=${submit}>
        <${ProfileFields} v=${v} set=${set} />
        <div class="form-error" role="alert">${err}</div>
        <div class="form-actions"><button class="btn primary" type="submit" aria-busy=${busy ? 'true' : 'false'}>Salvar perfil</button></div>
      </form>
      <div class="grid" style="align-content:start">
        <div class="panel" style="display:flex;gap:16px;align-items:center">
          <${Ava} path=${me.photo_path} name=${me.display_name || ''} size=${72} />
          <div class="grow" style="flex:1">
            <b>Foto do card</b>
            <p class="small muted">Só colegas aprovados das suas ligas veem.${me.is_minor ? ' Com a autorização do responsável.' : ''}</p>
          </div>
          <button class="btn sm" disabled=${!me.complete} title=${me.complete ? '' : 'Complete o perfil primeiro'} onClick=${() => setPhotoOpen(true)}>Trocar</button>
        </div>
        <div class="panel">
          <b>Minhas ligas</b>
          ${me.orgs.length === 0 && html`<p class="small muted" style="margin-top:8px">Você ainda não participa de nenhuma liga.</p>`}
          <div class="list" style="margin-top:10px">
            ${me.orgs.map((o) => html`<div class="item" key=${o.id}>
              <div class="grow"><div class="title">${o.name}</div>
                <div class="sub"><span>${ROLE_LABEL[o.role]}</span><span class=${'badge ' + STATUS_CLASS[o.status]}>${STATUS_LABEL[o.status]}</span></div></div>
              ${o.status === 'approved' && o.permissions.length > 0 && html`<a class="btn sm" href=${href('o/' + o.slug)}>Painel</a>`}
            </div>`)}
          </div>
        </div>
        <p class="small muted">Conta: ${me.email}</p>
      </div>
    </div>
    <${PhotoDialog} open=${photoOpen} onClose=${() => setPhotoOpen(false)} />
  `;
}
