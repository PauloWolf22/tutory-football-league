// Home do jogador (visual aprovado no protótipo). Sem dados inventados: o que ainda não existe
// (partidas, estatísticas, conquistas) aparece como "ainda não há", até a Fase 2/3 gravar dados reais.
import { html, useEffect, useRef, useState, useApp, href, Ava, fmtDay, fmtTime, RSVP_LABEL, RSVP_CLASS } from '../ui.js';
import { PhotoDialog } from './photo.js';
import { InviteCards, RsvpButtons, useMyMatches } from './notify.js';

export function HomePage() {
  const { me, api } = useApp();
  const ballRef = useRef(), trophyRef = useRef(), achvRef = useRef(), cardRef = useRef();
  const trophyCtl = useRef(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoUrl, setPhotoUrl] = useState(null);
  const first = (me.nick || me.display_name || '').split(' ')[0];
  const league = me.orgs.find((o) => o.status === 'approved') || me.orgs[0];
  const h = new Date().getHours();
  const my = useMyMatches();
  const next = (my.data || []).find((m) => m.status === 'open' && new Date(m.starts_at) > new Date());

  useEffect(() => {
    let disposeBall = () => {};
    import('../home3d.js').then((m) => {
      disposeBall = m.mountBall(ballRef.current);
      trophyCtl.current = m.mountTrophy(trophyRef.current, achvRef.current);
    });
    return () => { disposeBall(); trophyCtl.current?.dispose(); };
  }, []);
  useEffect(() => { let live = true; api.photoUrl(me.photo_path).then((u) => live && setPhotoUrl(u)); return () => { live = false; }; }, [me.photo_path]);

  // Card que inclina com o mouse ou o dedo.
  const tilt = (e) => {
    const c = cardRef.current, r = c.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    c.style.setProperty('--ry', `${(px - 0.5) * 22}deg`); c.style.setProperty('--rx', `${(0.5 - py) * 22}deg`);
    c.style.setProperty('--mx', `${px * 100}%`); c.style.setProperty('--my', `${py * 100}%`);
  };
  const untilt = () => { const c = cardRef.current; c.classList.remove('live'); c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg'); };

  return html`
    <section class="hero" id="terca">
      <div>
        <div class="eyebrow">${league ? league.name : 'Sem liga ainda'}${league && league.status === 'pending' ? ' · aguardando aprovação' : ''}</div>
        <h1>${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'}, ${first}.<br />Bora <em>entrar em campo.</em></h1>
        <p class="lead">${league?.status === 'approved' ? 'Sua carreira começa no primeiro jogo registrado.' : 'Assim que o gestor da liga aprovar sua conta, você entra nas listas de jogo.'}</p>
        <div style="margin-top:22px"><${InviteCards} onChange=${my.reload} /></div>
        ${next ? html`<div class="match">
          <div>
            <div class="when">Próxima partida · ${next.group}</div>
            <h2><a href=${href('jogo/' + next.id)} style="color:inherit;text-decoration:none">${fmtDay(next.starts_at)} · ${fmtTime(next.starts_at)}</a></h2>
            <div class="meta"><span>${next.venue || next.location}</span><span>${next.confirmed} de ${next.capacity} confirmados</span>
              <span class=${'badge ' + RSVP_CLASS[next.me]}>${RSVP_LABEL[next.me]}</span></div>
          </div>
          <${RsvpButtons} m=${next} onDone=${my.reload} />
        </div>` : html`<div class="match">
          <div>
            <div class="when">Próxima partida</div>
            <h2>Nenhuma partida marcada</h2>
            <div class="meta"><span>Quando o organizador do seu grupo marcar um jogo, ele aparece aqui para você confirmar.</span></div>
          </div>
        </div>`}
      </div>
      <div class="ball-stage" ref=${ballRef} aria-label="Bola 3D. Arraste para girar."><div class="ball-hint">Arraste para girar</div></div>
    </section>

    <section class="section" id="card">
      <div class="section-head"><h2>Seu card</h2><p>O Overall vem só do resultado dos jogos. Os números aparecem depois das primeiras partidas registradas.</p></div>
      <div class="card-zone">
        <div class="card-tilt">
          <article class="pcard" ref=${cardRef} onPointerEnter=${() => cardRef.current.classList.add('live')} onPointerMove=${tilt} onPointerLeave=${untilt}>
            <div class="pcard-in">
              <img class="photo" src=${photoUrl || 'assets/foto-exemplo.jpg'} alt="Foto do jogador" style=${photoUrl ? 'object-position:50% 50%' : 'opacity:.25;filter:grayscale(1)'} />
              <div class="ovr"><div class="num">—</div><small>NOVO</small><div class="sep"></div><img src="assets/logo-branco.png" alt="" /></div>
              <div class="tier">ESTREANTE</div>
              <div class="nameplate">
                <h3>${me.nick || me.display_name}</h3>
                <div class="sub">${league ? league.name : 'Sem liga'} · ${new Date().getFullYear()}</div>
                <div class="stats">
                  <div><b>—</b><span>Vitórias</span></div><div><b>—</b><span>Gols/j</span></div>
                  <div><b>—</b><span>Assist/j</span></div><div><b>—</b><span>Presença</span></div>
                </div>
              </div>
            </div>
            <div class="shine"></div>
          </article>
          <button type="button" class="photo-btn" onClick=${() => setPhotoOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>
            <span>${me.photo_path ? 'Trocar minha foto' : 'Colocar minha foto'}</span>
          </button>
        </div>
        <div class="card-info">
          <span class="chip">★ Estreante · ${new Date().getFullYear()}</span>
          <h3>Raridade pelo Overall, evolução pelo XP</h3>
          <p>O Overall sobe e desce com o resultado coletivo, então o goleiro que segura o placar cresce como o artilheiro. O XP vem de presença e regularidade e só sobe.</p>
          <div class="tiers"><span class="t-b">BRONZE</span><span class="t-p">PRATA</span><span class="t-o">OURO</span><span class="t-e">ELITE</span></div>
          <p class="small muted">Seu card ganha raridade depois de 10 jogos (Overall provisório até lá).</p>
        </div>
      </div>
    </section>

    <section class="section" id="conquistas">
      <div class="section-head"><h2>Conquistas</h2><p>Toda conquista tem critério verificável nos dados e data de desbloqueio.</p></div>
      <div class="achv" ref=${achvRef}>
        <div class="trophy-stage" ref=${trophyRef}></div>
        <div class="achv-body">
          <div class="tag">Ainda bloqueada</div>
          <h3>Sua primeira conquista</h3>
          <p>Jogue a primeira partida registrada para desbloquear "Estreia". Títulos, artilharia e MVP vêm depois.</p>
          <button class="btn-ghost" onClick=${() => trophyCtl.current?.replay()}>Ver animação</button>
        </div>
      </div>
    </section>
    <${PhotoDialog} open=${photoOpen} onClose=${() => setPhotoOpen(false)} />
  `;
}
