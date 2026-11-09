// Valeurs publiques par défaut de SANIX AI VIRTUAL COMPANY. Aucun secret ici : l'accès aux données est protégé par la sécurité par lignes
// (RLS) et par la connexion d'un opérateur, jamais par le secret de ces valeurs. La clé « publishable » (sb_publishable_…) est publique par conception.
export const SUPABASE_DEFAULT = {
  url: "https://izgpvhwhbrgeagjfhfli.supabase.co",
  key: "",   // clé publique du projet (Project Settings → API Keys → Publishable) ; vide : saisie demandée une fois, partagée avec le CRM
};
// Identifiants du CRM → e-mail du compte opérateur (Supabase Auth). Le mot de passe n'est jamais stocké : il se saisit à la connexion.
// Le CRM publie aussi l'annuaire de ses utilisateurs (sanix_crm_directory) : il prime sur cette table.
export const LOGIN_ALIASES = { kessie: "cyrille@sanix-africa.ci" };
