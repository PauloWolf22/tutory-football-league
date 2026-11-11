// Motor do sorteio (sem IA: matemática). Recebe os primeiros 2×N confirmados, na ordem de confirmação.
//   random   → embaralha (crypto) e divide
//   order    → A = 1º..Nº confirmados, B = os seguintes
//   balanced → até 16 jogadores testa TODAS as divisões e sorteia entre as de menor diferença de nível;
//              acima disso, distribuição em serpente + trocas enquanto melhorar
// O banco confere de novo quem pode estar em campo (tfl_draw_save).

const rand = (n) => { // inteiro uniforme em [0, n) sem viés de módulo
  const max = Math.floor(0x100000000 / n) * n; const a = new Uint32Array(1);
  do { crypto.getRandomValues(a); } while (a[0] >= max);
  return a[0] % n;
};
export const shuffle = (list) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const lvl = (p) => p.level ?? 3;
const sum = (list) => list.reduce((s, p) => s + lvl(p), 0);

export function drawTeams(players, n, mode) {
  const pool = players.slice(0, 2 * n);
  if (pool.length < 2 * n) throw new Error(`São precisos ${2 * n} confirmados para dois times de ${n}.`);
  let A, B;
  if (mode === 'order') { A = pool.slice(0, n); B = pool.slice(n); }
  else if (mode === 'random') { const s = shuffle(pool); A = s.slice(0, n); B = s.slice(n); }
  else if (pool.length <= 16) {
    // Enumera as divisões que contêm o 1º jogador (evita contar A/B e B/A duas vezes).
    const total = sum(pool); let best = Infinity; let options = [];
    const rest = pool.slice(1);
    const walk = (start, chosen) => {
      if (chosen.length === n - 1) {
        const team = [pool[0], ...chosen.map((i) => rest[i])];
        const diff = Math.abs(total - 2 * sum(team));
        if (diff < best) { best = diff; options = [chosen.slice()]; } else if (diff === best) options.push(chosen.slice());
        return;
      }
      for (let i = start; i <= rest.length - (n - 1 - chosen.length); i++) { chosen.push(i); walk(i + 1, chosen); chosen.pop(); }
    };
    walk(0, []);
    const pick = options[rand(options.length)];
    const inA = new Set(pick.map((i) => rest[i].user_id)); inA.add(pool[0].user_id);
    A = pool.filter((p) => inA.has(p.user_id)); B = pool.filter((p) => !inA.has(p.user_id));
    if (rand(2)) [A, B] = [B, A];
  } else {
    const sorted = shuffle(pool).sort((x, y) => lvl(y) - lvl(x));
    A = []; B = [];
    sorted.forEach((p, i) => ((Math.floor(i / 2) % 2 === 0) === (i % 2 === 0) ? A : B).push(p));
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < A.length && !improved; i++) for (let j = 0; j < B.length && !improved; j++) {
        const d0 = Math.abs(sum(A) - sum(B)), d1 = Math.abs(sum(A) - lvl(A[i]) + lvl(B[j]) - (sum(B) - lvl(B[j]) + lvl(A[i])));
        if (d1 < d0) { [A[i], B[j]] = [B[j], A[i]]; improved = true; }
      }
    }
  }
  const a = sum(A), b = sum(B);
  return { A, B, balance: { a, b, pct_a: Math.round((100 * a) / Math.max(a + b, 1)) }, seed: `${mode}-${Date.now().toString(36)}` };
}
