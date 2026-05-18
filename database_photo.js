// AgroLink BF — database.js MIS A JOUR avec stockage photo
// Ajout de la fonction uploadPhotoToSupabase()
// Remplace la fonction sauvegarderOffre() dans database.js

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Uploader la photo vers Supabase Storage ───────────────────────────────────
// Retourne l'URL publique de la photo
export async function uploadPhotoToSupabase(offre_id, photoBuffer, mimeType) {
  const extension = mimeType.includes("png") ? "png" : "jpg";
  const filePath  = `${offre_id}.${extension}`;

  const { error } = await supabase.storage
    .from("photos-offres")
    .upload(filePath, photoBuffer, {
      contentType:  mimeType,
      upsert:       true,
    });

  if (error) throw new Error(`Upload Supabase Storage: ${error.message}`);

  // Générer l'URL publique
  const { data } = supabase.storage
    .from("photos-offres")
    .getPublicUrl(filePath);

  console.log(`📷 Photo stockée : ${data.publicUrl}`);
  return data.publicUrl;
}

// ── sauvegarderOffre() MIS À JOUR (remplace l'ancienne version) ───────────────
export async function sauvegarderOffre({ telephone, produit, prix, localisation, photo_buffer, photo_mime }) {
  // 1. Récupérer ou créer l'agriculteur
  let { data: agriculteur } = await supabase
    .from("agriculteurs")
    .select("*")
    .eq("telephone", telephone)
    .single();

  if (!agriculteur) {
    const { data: nouveau } = await supabase
      .from("agriculteurs")
      .insert({ telephone })
      .select()
      .single();
    agriculteur = nouveau;
  }

  const offre_id = `OFFER-${Date.now()}`;

  // 2. Uploader la photo si présente
  let photo_url = null;
  if (photo_buffer && photo_mime) {
    photo_url = await uploadPhotoToSupabase(offre_id, photo_buffer, photo_mime);
  }

  // 3. Insérer l'offre avec l'URL photo
  const { data: offre, error } = await supabase
    .from("offres")
    .insert({
      id:             offre_id,
      agriculteur_id: agriculteur.id,
      telephone,
      produit,
      prix_fcfa:      prix,
      localisation,
      photo_url,           // null si pas de photo
    })
    .select()
    .single();

  if (error) throw new Error(`Supabase insert: ${error.message}`);

  // 4. Incrémenter le compteur d'offres
  await supabase
    .from("agriculteurs")
    .update({ nb_offres: agriculteur.nb_offres + 1 })
    .eq("id", agriculteur.id);

  console.log(`💾 Offre ${offre_id} sauvegardée${photo_url ? " avec photo" : " sans photo"}`);
  return offre;
}

// ── Toutes les autres fonctions restent identiques à database.js ──────────────
// (getSession, saveSession, deleteSession, getOffresActives, etc.)
// Importez-les depuis database.js et réexportez-les ici si nécessaire
export { getSession, saveSession, deleteSession, getOffresActives,
         marquerOffrePubliee, enregistrerPaiement, getStats }
  from "./database.js";
