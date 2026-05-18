-- ============================================================
-- AgroLink BF — Schéma de base de données Supabase
-- Copiez-collez ce code dans l'éditeur SQL de Supabase
-- Dashboard > SQL Editor > New Query > Coller > Run
-- ============================================================


-- ─── 1. TABLE DES AGRICULTEURS ───────────────────────────────
-- Chaque agriculteur est identifié par son numéro WhatsApp
CREATE TABLE IF NOT EXISTS agriculteurs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telephone   TEXT UNIQUE NOT NULL,       -- ex: "22670123456"
  nom         TEXT,                        -- optionnel, rempli plus tard
  ville       TEXT,                        -- ville principale
  nb_offres   INT DEFAULT 0,              -- nombre total d'offres publiées
  cree_le     TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 2. TABLE DES OFFRES ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS offres (
  id              TEXT PRIMARY KEY,         -- ex: "OFFER-1234567890"
  agriculteur_id  UUID REFERENCES agriculteurs(id) ON DELETE CASCADE,
  telephone       TEXT NOT NULL,            -- copie directe pour requêtes rapides
  produit         TEXT NOT NULL,            -- ex: "100kg de maïs"
  prix_fcfa       INT NOT NULL,             -- ex: 150
  localisation    TEXT NOT NULL,            -- ex: "Koudougou"
  statut          TEXT DEFAULT 'actif'      -- actif | vendu | expiré | supprimé
                  CHECK (statut IN ('actif','vendu','expire','supprime')),
  fb_post_id      TEXT,                     -- ID du post Facebook (après publication)
  fb_publie       BOOLEAN DEFAULT FALSE,
  fb_publie_le    TIMESTAMPTZ,
  cree_le         TIMESTAMPTZ DEFAULT NOW(),
  expire_le       TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days'
);

-- ─── 3. TABLE DES PAIEMENTS ──────────────────────────────────
-- Suivi des frais de publication (Orange Money / Moov)
CREATE TABLE IF NOT EXISTS paiements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agriculteur_id  UUID REFERENCES agriculteurs(id),
  offre_id        TEXT REFERENCES offres(id),
  montant_fcfa    INT NOT NULL,             -- ex: 300
  methode         TEXT DEFAULT 'orange'     -- orange | moov | especes
                  CHECK (methode IN ('orange','moov','especes')),
  reference       TEXT,                     -- numéro de transaction Orange Money
  statut          TEXT DEFAULT 'en_attente' -- en_attente | confirme | rembourse
                  CHECK (statut IN ('en_attente','confirme','rembourse')),
  cree_le         TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 4. TABLE DES SESSIONS BOT ───────────────────────────────
-- Remplace le sessionStore en mémoire du bot (persistant au redémarrage)
CREATE TABLE IF NOT EXISTS sessions_bot (
  telephone   TEXT PRIMARY KEY,
  etape       TEXT NOT NULL DEFAULT 'MENU',  -- MENU | PRODUIT | PRIX | LIEU | CONFIRMER
  produit     TEXT,
  prix        INT,
  localisation TEXT,
  mis_a_jour  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 5. INDEX POUR LES PERFORMANCES ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_offres_telephone   ON offres(telephone);
CREATE INDEX IF NOT EXISTS idx_offres_statut      ON offres(statut);
CREATE INDEX IF NOT EXISTS idx_offres_localisation ON offres(localisation);
CREATE INDEX IF NOT EXISTS idx_offres_cree_le     ON offres(cree_le DESC);

-- ─── 6. VUE : OFFRES ACTIVES (pour le dashboard) ─────────────
CREATE OR REPLACE VIEW offres_actives AS
  SELECT
    o.*,
    a.nom       AS agriculteur_nom
  FROM offres o
  LEFT JOIN agriculteurs a ON a.id = o.agriculteur_id
  WHERE o.statut = 'actif'
    AND o.expire_le > NOW()
  ORDER BY o.cree_le DESC;

-- ─── 7. EXPIRATION AUTOMATIQUE (optionnel, avec pg_cron) ─────
-- Active pg_cron dans Supabase > Extensions, puis :
-- SELECT cron.schedule('expirer-offres', '0 2 * * *',
--   $$UPDATE offres SET statut='expire' WHERE expire_le < NOW() AND statut='actif'$$
-- );

-- ─── 8. SÉCURITÉ ROW LEVEL (RLS) ─────────────────────────────
-- Activez RLS pour protéger les données
ALTER TABLE agriculteurs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE offres          ENABLE ROW LEVEL SECURITY;
ALTER TABLE paiements       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions_bot    ENABLE ROW LEVEL SECURITY;

-- Le bot accède via service_role (clé secrète) — accès total
-- Le dashboard peut utiliser une clé anon limitée en lecture seule
CREATE POLICY "service_role_full_access_agriculteurs"
  ON agriculteurs FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access_offres"
  ON offres FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access_paiements"
  ON paiements FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access_sessions"
  ON sessions_bot FOR ALL USING (auth.role() = 'service_role');

-- Lecture publique des offres actives (pour le dashboard public)
CREATE POLICY "lecture_publique_offres_actives"
  ON offres FOR SELECT USING (statut = 'actif');
