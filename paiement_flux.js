// AgroLink BF — Mise à jour du flux de conversation avec paiement
// Remplace le case "CONFIRMER" dans agrolink_bot_final.js
// Le paiement s'insère ENTRE la confirmation et la publication Facebook

// ─── NOUVEAU CAS "CONFIRMER" ────────────────────────────────────────────────
// Remplacez le case "CONFIRMER" existant par ce code :

/*
  case "CONFIRMER": {
    if (msg.toUpperCase() === "OUI") {

      // 1. Sauvegarder l'offre en attente de paiement dans Supabase
      const offre = await sauvegarderOffre({
        telephone,
        produit:      session.produit,
        prix:         session.prix,
        localisation: session.localisation,
        statut:       "en_attente_paiement",   // nouveau statut
      });

      // 2. Générer le lien de paiement Orange Money / Moov
      const paiement = await initialiserPaiement({
        telephone,
        offre_id: offre.id,
      });

      // 3. Envoyer le lien de paiement à l'agriculteur
      await sendMessage(telephone,
        `📋 *Dernière étape — Paiement des frais*\n\n` +
        `Pour publier votre offre, réglez les frais de publication :\n` +
        `💰 *300 FCFA* (Orange Money ou Moov Money)\n\n` +
        `👉 Cliquez sur ce lien pour payer :\n${paiement.lien_paiement}\n\n` +
        `⏱ Ce lien est valable 30 minutes.\n` +
        `Votre offre sera publiée automatiquement après paiement.`
      );

      await deleteSession(telephone);

    } else if (msg.toUpperCase() === "NON") {
      await saveSession(telephone, { etape: "PRODUIT" });
      await sendMessage(telephone, "🔄 Ok, recommençons.\n\n📦 Quel produit vendez-vous ?");
    } else {
      await sendMessage(telephone, "Répondez *OUI* pour confirmer ou *NON* pour corriger.");
    }
    break;
  }
*/


// ─── NOUVEAU FLUX COMPLET AVEC PAIEMENT ──────────────────────────────────────
//
//   Farmer: "Bonjour"
//       ↓
//   Bot: Menu (1/2/3)
//       ↓ (choisit 1)
//   Bot: Quel produit ?
//       ↓
//   Farmer: "100kg de maïs"
//       ↓
//   Bot: Quel prix ?
//       ↓
//   Farmer: "150"
//       ↓
//   Bot: Quelle ville ?
//       ↓
//   Farmer: "Koudougou"
//       ↓
//   Bot: Confirmer ? (OUI/NON)
//       ↓ (OUI)
//   Bot: 📲 Lien paiement 300 FCFA (Orange Money / Moov)
//       ↓ (Farmer paie sur son téléphone)
//   CinetPay → webhook /paiement/notification
//       ↓
//   Offre sauvegardée dans Supabase
//       ↓
//   Post publié sur Facebook automatiquement
//       ↓
//   Bot: ✅ "Paiement reçu ! Offre publiée !"
//
// ─────────────────────────────────────────────────────────────────────────────


// ─── GESTION DES OFFRES GRATUITES (promotions) ───────────────────────────────
// Pour les premiers agriculteurs ou partenaires coopératives,
// vous pouvez offrir des publications gratuites :

export async function publierSansPaiement(offre, { sendMessage, marquerOffrePubliee, postOfferToFacebook }) {
  const fb_id = await postOfferToFacebook(offre);
  await marquerOffrePubliee(offre.id, fb_id);

  await sendMessage(offre.telephone,
    `✅ *Offre publiée gratuitement !* 🎉\n\n` +
    `🆔 Référence: ${offre.id}\n` +
    `📘 Visible sur notre page Facebook AgroLink BF\n\n` +
    `Tapez *Bonjour* pour publier une autre offre.`
  );
}


// ─── RAPPEL DE PAIEMENT (optionnel) ──────────────────────────────────────────
// Si un agriculteur n'a pas payé après 2h, envoyez un rappel
// Planifiez cette fonction avec node-cron (npm install node-cron)

import cron from "node-cron";

export function demarrerRappelsPaiement(sendMessage, getOffresEnAttente) {
  // Toutes les heures, vérifier les offres non payées depuis plus de 2h
  cron.schedule("0 * * * *", async () => {
    const offres = await getOffresEnAttente({ depuisHeures: 2 });

    for (const offre of offres) {
      const paiement = await initialiserPaiement({
        telephone: offre.telephone,
        offre_id:  offre.id,
      });

      await sendMessage(offre.telephone,
        `⏰ *Rappel AgroLink BF*\n\n` +
        `Votre offre *${offre.produit}* attend le paiement des frais.\n\n` +
        `👉 Payez 300 FCFA ici :\n${paiement.lien_paiement}\n\n` +
        `L'offre sera supprimée si non payée dans 24h.`
      );
    }
  });
}
