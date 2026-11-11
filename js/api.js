// Acesso ao Supabase (real ou simulado). Toda autorização acontece no banco: aqui só chamamos
// as funções tfl_* e traduzimos os erros para português.
import { ENVIRONMENTS, currentEnv } from './config.js';

const BUCKET = 'player-photos';
const SIGNED_TTL = 60 * 60;

export function friendly(error) {
  const m = (error && (error.message || error.error || String(error))) || 'Algo deu errado. Tente de novo.';
  if (/invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/already registered|already exists/i.test(m)) return 'Já existe uma conta com esse e-mail. Use Entrar.';
  if (/password.*(at least|short)/i.test(m)) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (/email not confirmed/i.test(m)) return 'Confirme o e-mail antes de entrar.';
  if (/failed to fetch|network/i.test(m)) return 'Sem conexão com o servidor. Verifique a internet.';
  if (/permission denied|42501/i.test(m)) return 'Você não tem permissão para isso.';
  if (/rate limit/i.test(m)) return 'Muitas tentativas seguidas. Espere um minuto e tente de novo.';
  return m;
}

export async function createApi() {
  const env = currentEnv();
  let client;
  if (env === 'mock') {
    const { createMockClient } = await import('./mock.js');
    client = createMockClient();
  } else {
    const cfg = ENVIRONMENTS[env];
    if (!cfg?.url || !cfg?.anonKey) throw new Error(`O ambiente "${env}" ainda não está configurado em js/config.js.`);
    client = self.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  }
  const urlCache = new Map(); // caminho → { url, until }

  const api = {
    env,
    client,

    async rpc(name, args = {}) {
      const { data, error } = await client.rpc(name, args);
      if (error) throw new Error(friendly(error));
      if (data && typeof data === 'object' && !Array.isArray(data) && data.error) throw new Error(data.error);
      return data;
    },

    // ------------------------------------------------------------ conta
    async session() { return (await client.auth.getSession()).data.session?.user || null; },
    // O Supabase dispara este aviso segurando uma trava interna; chamar o Supabase dentro dele trava tudo
    // (a página fica em "Carregando…" ao abrir com sessão salva). Por isso a resposta vai para depois.
    onAuth(fn) { return client.auth.onAuthStateChange((_e, s) => { setTimeout(() => fn(s?.user || null), 0); }); },
    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) throw new Error(friendly(error));
      return data.user;
    },
    async signUp(email, password, name) {
      const { data, error } = await client.auth.signUp({ email: email.trim().toLowerCase(), password, options: { data: { name } } });
      if (error) throw new Error(friendly(error));
      if (!data.session) throw new Error('Conta criada. Confirme o e-mail recebido e depois use Entrar.');
      return data.user;
    },
    async signOut() { await client.auth.signOut(); urlCache.clear(); },

    // ------------------------------------------------------------ tempo real
    // Avisa quando uma tabela muda (o Supabase Realtime só entrega o que as regras deixam a pessoa ver).
    // Devolve a função que cancela a inscrição.
    subscribe(name, table, filter, onChange) {
      const cfg = { event: '*', schema: 'public', table };
      if (filter) cfg.filter = filter;
      const ch = client.channel(`${name}:${Math.random().toString(36).slice(2, 8)}`).on('postgres_changes', cfg, () => onChange()).subscribe();
      return () => { try { client.removeChannel(ch); } catch {} };
    },

    // ------------------------------------------------------------ fotos
    async photoUrl(path) {
      if (!path) return null;
      const hit = urlCache.get(path);
      if (hit && hit.until > Date.now()) return hit.url;
      const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL);
      if (error) return null;
      urlCache.set(path, { url: data.signedUrl, until: Date.now() + (SIGNED_TTL - 120) * 1000 });
      return data.signedUrl;
    },
    // Envia um arquivo novo, aponta o perfil para ele e só então apaga o anterior.
    async savePhoto(userId, blob) {
      const path = `${userId}/${Date.now()}.jpg`;
      const up = await client.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (up.error) throw new Error(friendly(up.error));
      let res;
      try { res = await api.rpc('tfl_profile_set_photo', { p_path: path, p_consent: true }); }
      catch (e) { await client.storage.from(BUCKET).remove([path]); throw e; }
      if (res.old_path) client.storage.from(BUCKET).remove([res.old_path]);
      return path;
    },
    async removePhoto() {
      const res = await api.rpc('tfl_profile_set_photo', { p_path: null, p_consent: false });
      if (res.old_path) await client.storage.from(BUCKET).remove([res.old_path]);
    },
  };
  return api;
}
