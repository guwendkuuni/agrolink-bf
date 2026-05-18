-- ============================================================
-- AgroLink BF — Migration : ajout des photos
-- Collez ce code dans Supabase > SQL Editor > Run
-- (en plus du schema initial supabase_schema.sql)
-- ============================================================

-- 1. Ajouter la colonne photo_url dans la table offres
ALTER TABLE offres ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- 2. Créer le bucket de stockage pour les photos
-- (Supabase Storage — à faire aussi dans Dashboard > Storage > New Bucket)
-- Nom du bucket : "photos-offres"
-- Public : OUI (pour que Facebook puisse accéder aux photos)

-- 3. Politique d'accès public en lecture au bucket photos-offres
-- (à configurer dans Dashboard > Storage > photos-offres > Policies)
-- Ou via SQL :
INSERT INTO storage.buckets (id, name, public)
VALUES ('photos-offres', 'photos-offres', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "lecture_publique_photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'photos-offres');

CREATE POLICY "upload_service_role_photos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'photos-offres' AND auth.role() = 'service_role');
