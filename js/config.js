// Nome do produto num lugar só: trocar aqui quando a marca nova existir (decisão de 10/11/2026).
export const PRODUCT = {
  name: 'Tutory Football League',
  short: 'Football League',
};

// Ambientes do Supabase. A chave publishable é pública por natureza; quem protege os dados são as
// regras do banco (supabase/migrations). Nunca coloque aqui a chave secret/service_role.
export const ENVIRONMENTS = {
  prod: { label: 'Produção', url: 'https://kfifjbkcdzkpagkdehkk.supabase.co', anonKey: 'sb_publishable_dclnTT_YQHoRujVtqoSrYw_IYMpkKco' },
  // Projeto de testes na organização pwdfigma-sketch (a conta PauloWolf22 já usa as 2 vagas gratuitas).
  dev: { label: 'Testes', url: 'https://jokqpozlquglujppeugl.supabase.co', anonKey: 'sb_publishable_lhgOjbNvbd5NRBEOQLmT-A_W7KGyTn3' },
};

// Liga padrão para quem entra sem escolher (a Tutory é a empresa piloto).
export const DEFAULT_ORG = 'tutory';

// Qual ambiente usar: ?mock=1 (banco simulado), ?env=dev (testes) ou produção.
export function currentEnv() {
  const q = new URLSearchParams(location.search);
  if (q.has('mock')) return 'mock';
  const env = q.get('env');
  return env === 'dev' ? 'dev' : 'prod';
}
