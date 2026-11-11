-- ═════════════════════════════════════════════════════════════════════════════
--  SANIX AI — Correction des règles de segmentation après relecture des 504 prospects
--  1. AvicoSuite : le motif « avic » attrapait « Polyclinique Avicennes » (clinique, secteur Santé) : remplacé par des mots entiers (avico…, avicole, aviculture, avinest).
--  2. AluExpert : « \malu » (début de mot) manquait les noms où « alu » ou « alux » termine un mot (AFLOALU, TECHNALUX, OBJECTIFALU, SIMALU…) ; « alu » au milieu d'un mot (Salut, Salubrité, Évaluation) reste exclu et « vitrier / vitre / vitra »
--     (SAM LE VITRIER, KAVI, ÉCO-VITRA…) ; « menui » ajouté (MENUI'DEAL). « vitrine » (devanture de magasin) reste volontairement exclue.
--  Les règles sont de la donnée (ai_segment_rules) : cette migration ne change que des motifs, sans toucher aux fiches (la segmentation se rejoue ensuite).
--  Additive et relançable.
-- ═════════════════════════════════════════════════════════════════════════════
do $$ begin
  if to_regclass('public.ai_segment_rules') is null then
    raise exception 'Appliquer d''abord la migration 20261115 (Phase 3)' using errcode = '55000';
  end if;
end $$;

update public.ai_segment_rules set
  motif = '\malu|alu\M|alux\M|menuis|menui|vitre|vitrier|vitrage|vitra|miroiter|facade|fenetre|baie vitree|charpente metal|metallerie',
  note = 'Nom évoquant l''aluminium, la menuiserie, la vitrerie ou la métallerie (« alu » reconnu à l''intérieur du nom)'
 where champ = 'entreprise' and segment = 'aluexpert'
   and motif = '\malu|menuiser|vitr(erie|age)|miroiter|facade|fenetre|baie vitree|charpente metal|metallerie';

update public.ai_segment_rules set
  motif = '\mavico|avicole|avicult|\mavinest|poulet|poule|pondeuse|volaille|couvoir|provende|oeuf',
  note = 'Nom évoquant l''aviculture (mots entiers : « Avicennes » n''est pas avicole)'
 where champ = 'entreprise' and segment = 'avicosuite'
   and motif = 'avic|poulet|poule|pondeuse|volaille|couvoir|provende|oeuf';
