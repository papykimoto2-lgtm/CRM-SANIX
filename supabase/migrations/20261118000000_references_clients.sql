-- ═════════════════════════════════════════════════════════════════════════════
--  SANIX AI — Références clients par logiciel (citables seulement sur feu vert de la direction)
--  Les agents n'ont le droit de nommer à un prospect QUE les références marquées « citables » (accord du client à citer). Par défaut : internes.
--  1. ai_product_references : un client par logiciel, citable = false tant que la direction n'a pas donné son feu vert (date et auteur conservés).
--  2. ai_cfg_save_reference / ai_cfg_delete_reference : direction seule, journalisées.
--  3. Références de départ fournies par la direction (non citables) : ImmoSuite = Zahara Multiservices, Menko Holding ; AluExpert = 100% INOX, Beda Alu ;
--     AvicoSuite = Ferme Jolan. Ce sont des clients réels du CRM ; aucune performance ni témoignage n'est inventé.
--  Additif et relançable.
-- ═════════════════════════════════════════════════════════════════════════════

do $$ begin
  if to_regprocedure('public.ai_cfg_check()') is null then
    raise exception 'Appliquer d''abord la migration 20261114 (paramétrage)' using errcode = '55000';
  end if;
end $$;

create table if not exists public.ai_product_references (
  id         uuid primary key default gen_random_uuid(),
  product_id text not null references public.ai_products(id) on delete cascade,
  client     text not null check (char_length(btrim(client)) between 2 and 120),
  note       text check (note is null or char_length(note) <= 300),
  citable    boolean not null default false,
  citable_le timestamptz,
  citable_par uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists ai_product_references_uniq on public.ai_product_references(product_id, lower(btrim(client)));
alter table public.ai_product_references enable row level security;
drop policy if exists ref_read on public.ai_product_references;
create policy ref_read on public.ai_product_references for select to authenticated using (public.ai_is_operator());
revoke all on public.ai_product_references from anon;
revoke insert, update, delete, truncate on public.ai_product_references from authenticated;
grant select on public.ai_product_references to authenticated;

-- Création ou modification (p : id optionnel, product_id, client, note, citable). Le feu vert (citable) est daté et signé.
create or replace function public.ai_cfg_save_reference(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_cit boolean; r public.ai_product_references;
begin
  perform public.ai_cfg_check();
  if v_id is null then
    if not exists (select 1 from public.ai_products where id = p->>'product_id') then raise exception 'Logiciel inconnu' using errcode = '22023'; end if;
    v_cit := coalesce((p->>'citable')::boolean, false);
    insert into public.ai_product_references(product_id, client, note, citable, citable_le, citable_par)
    values (p->>'product_id', btrim(p->>'client'), nullif(left(p->>'note', 300), ''), v_cit, case when v_cit then now() end, case when v_cit then auth.uid() end)
    returning * into r;
  else
    select * into r from public.ai_product_references where id = v_id;
    if r.id is null then raise exception 'Référence introuvable' using errcode = 'P0002'; end if;
    v_cit := coalesce((p->>'citable')::boolean, r.citable);
    update public.ai_product_references set
      client = case when p ? 'client' then btrim(p->>'client') else client end,
      note = case when p ? 'note' then nullif(left(p->>'note', 300), '') else note end,
      citable = v_cit,
      citable_le = case when v_cit and not r.citable then now() when not v_cit then null else citable_le end,
      citable_par = case when v_cit and not r.citable then auth.uid() when not v_cit then null else citable_par end
     where id = v_id returning * into r;
  end if;
  perform public.ai_cfg_audit('cfg_reference', jsonb_build_object('id', r.id, 'produit', r.product_id, 'client', r.client, 'citable', r.citable));
  return jsonb_build_object('ok', true, 'id', r.id, 'citable', r.citable);
end $$;

create or replace function public.ai_cfg_delete_reference(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.ai_product_references;
begin
  perform public.ai_cfg_check();
  delete from public.ai_product_references where id = p_id returning * into r;
  if r.id is null then raise exception 'Référence introuvable' using errcode = 'P0002'; end if;
  perform public.ai_cfg_audit('cfg_reference_supprimee', jsonb_build_object('produit', r.product_id, 'client', r.client));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.ai_cfg_save_reference(jsonb), public.ai_cfg_delete_reference(uuid) from public, anon;
grant execute on function public.ai_cfg_save_reference(jsonb), public.ai_cfg_delete_reference(uuid) to authenticated;

-- Références de départ (internes : citable = false)
insert into public.ai_product_references(product_id, client, note)
select v.product_id, v.client, v.note
  from (values
    ('immosuite', 'Zahara Multiservices', 'Client actuel d''ImmoSuite ERP'),
    ('immosuite', 'Menko Holding', 'Client actuel d''ImmoSuite ERP'),
    ('aluexpert', '100% INOX', 'Client actuel de Sanix AluExpert ERP'),
    ('aluexpert', 'Beda Alu', 'Client actuel de Sanix AluExpert ERP'),
    ('avicosuite', 'Ferme Jolan', 'Client actuel d''AvicoSuite (ex-AviNest Pro)')
  ) v(product_id, client, note)
 where exists (select 1 from public.ai_products p where p.id = v.product_id)
on conflict do nothing;
