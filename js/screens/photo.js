// Troca de foto: escolher, enquadrar (arrastar + zoom), autorizar e salvar no perfil global.
// Mesmo fluxo aprovado no protótipo, agora como componente.
import { html, useState, useEffect, useRef, useApp, Dialog, toast } from '../ui.js';

const OUT_W = 720, MAX_BYTES = 10 * 1024 * 1024;

export function PhotoDialog({ open, onClose }) {
  const { api, me, refreshMe } = useApp();
  const crop = useRef(), imgRef = useRef();
  const st = useRef(null);
  const [src, setSrc] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { st.current = null; setSrc(null); setZoom(1); setConsent(false); setErr(''); } }, [open]);
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);

  const box = () => crop.current.getBoundingClientRect();
  const layout = () => {
    const s = st.current; if (!s || !imgRef.current) return;
    const { width: W, height: H } = box();
    const k = s.base * s.z, dw = s.iw * k, dh = s.ih * k;
    s.x = Math.min(0, Math.max(W - dw, s.x)); s.y = Math.min(0, Math.max(H - dh, s.y));
    imgRef.current.style.transform = `translate(${s.x}px, ${s.y}px) scale(${k})`;
  };

  const pick = (f) => {
    setErr('');
    if (!f) return;
    if (!/^image\//.test(f.type)) { setErr('Esse arquivo não é uma imagem. Envie JPG, PNG ou WEBP.'); return; }
    if (f.size > MAX_BYTES) { setErr(`A foto tem ${(f.size / 1048576).toFixed(1)} MB. O limite é 10 MB.`); return; }
    const url = URL.createObjectURL(f);
    const probe = new Image();
    probe.onload = () => {
      const { width: W, height: H } = box();
      st.current = { iw: probe.naturalWidth, ih: probe.naturalHeight, z: 1, base: Math.max(W / probe.naturalWidth, H / probe.naturalHeight) };
      st.current.x = (W - st.current.iw * st.current.base) / 2;
      st.current.y = (H - st.current.ih * st.current.base) * 0.2;
      setSrc(url); setZoom(1);
      requestAnimationFrame(layout);
    };
    probe.onerror = () => { URL.revokeObjectURL(url); setErr('Não consegui abrir essa imagem. Se for HEIC do iPhone, envie em JPG.'); };
    probe.src = url;
  };

  const setZ = (z) => {
    const s = st.current; if (!s) return;
    const { width: W, height: H } = box();
    z = Math.min(3, Math.max(1, z));
    const old = s.base * s.z, nu = s.base * z;
    s.x = W / 2 - (W / 2 - s.x) * nu / old; s.y = H / 2 - (H / 2 - s.y) * nu / old; s.z = z;
    setZoom(z); layout();
  };

  const drag = useRef(null);
  const down = (e) => { drag.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); };
  const move = (e) => { if (!drag.current || !st.current) return; st.current.x += e.clientX - drag.current.x; st.current.y += e.clientY - drag.current.y; drag.current = { x: e.clientX, y: e.clientY }; layout(); };
  const up = () => { drag.current = null; };

  const save = async () => {
    const s = st.current; if (!s || !consent) return;
    const { width: W, height: H } = box();
    const k = OUT_W / W, sc = s.base * s.z;
    const c = document.createElement('canvas'); c.width = OUT_W; c.height = Math.round(H * k);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#070c1f'; ctx.fillRect(0, 0, c.width, c.height); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imgRef.current, s.x * k, s.y * k, s.iw * sc * k, s.ih * sc * k);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.86));
    if (!blob) { setErr('Não foi possível gerar a foto.'); return; }
    setBusy(true); setErr('');
    try { await api.savePhoto(me.id, blob); await refreshMe(); toast('Foto salva na sua conta'); onClose(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try { await api.removePhoto(); await refreshMe(); toast('Foto removida'); onClose(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return html`<${Dialog} open=${open} onClose=${onClose} label="Sua foto no card">
    <div>
      <h3>Sua foto no card</h3>
      <p class="muted small">Escolha uma foto sua. Arraste para enquadrar e ajuste o zoom.</p>
    </div>
    <input type="file" id="ph-file" accept="image/jpeg,image/png,image/webp" hidden onChange=${(e) => { pick(e.target.files[0]); e.target.value = ''; }} />
    <div class="crop" ref=${crop} onWheel=${(e) => { if (st.current) { e.preventDefault(); setZ(zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06)); } }}>
      ${!src && html`<div class="empty"><label for="ph-file">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4"/></svg>
        Escolher foto<span>JPG, PNG ou WEBP, até 10 MB</span></label></div>`}
      ${src && html`<img ref=${imgRef} src=${src} alt="Prévia do enquadramento" draggable="false" width=${st.current?.iw} height=${st.current?.ih}
        onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} />`}
      ${src && html`<div class="guide"></div>`}
    </div>
    ${src && html`<label class="dlg-swap" for="ph-file">Escolher outra foto</label>`}
    <div class="zoom"><span>Zoom</span><input type="range" min="1" max="3" step="0.01" value=${zoom} disabled=${!src} onInput=${(e) => setZ(+e.target.value)} aria-label="Zoom da foto" /></div>
    <label class="check"><input type="checkbox" checked=${consent} onChange=${(e) => setConsent(e.target.checked)} />
      <span>Autorizo que esta foto apareça no meu card para os colegas das minhas ligas. Posso trocar ou remover quando quiser.</span></label>
    <div class="form-error" role="alert">${err}</div>
    <div class="form-actions">
      ${me.photo_path && html`<button class="btn danger" style="margin-right:auto" onClick=${remove} aria-busy=${busy ? 'true' : 'false'}>Remover foto</button>`}
      <button class="btn" onClick=${onClose}>Cancelar</button>
      <button class="btn primary" disabled=${!src || !consent} aria-busy=${busy ? 'true' : 'false'} onClick=${save}>${busy ? 'Enviando…' : 'Usar esta foto'}</button>
    </div>
  <//>`;
}
