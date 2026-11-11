-- Rodar UMA VEZ, e só no projeto de TESTES (tutory-football-dev).
-- Marca o banco como ambiente de desenvolvimento. Os testes recusam rodar sem esta marca,
-- para nunca criarem usuários de teste no projeto de produção.
-- (Um comando só: a CLI "db query" não aceita vários comandos num arquivo.)
do $$
begin
  create table if not exists private.env (key text primary key, value text not null);
  insert into private.env (key, value) values ('ambiente', 'dev')
  on conflict (key) do update set value = excluded.value;
end $$;
