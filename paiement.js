// AgroLink BF — Module Paiement Orange Money & Moov Money
// Utilise CinetPay (disponible au Burkina Faso, supporte Orange Money + Moov)
// Inscription gratuite : https://cinetpay.com
// npm install node-fetch

import fetch from "node-fetch";

// ─── CONFIG (dans votre .env) ─────────────────────────────────────────────────
const CINETPAY_API_KEY  = process.env.CINETPAY_API_KEY;   // depuis dashboard CinetPay
const CINETPAY_SITE_ID  = process.env.CINETPAY_SITE_ID;   // depuis dashboard CinetPay
const APP_BASE_URL      = process.env.APP_BASE_URL;        // ex: https://agrolink.up.railway.app

// ─── MONTANT FIXE DE PUBLICATION ─────────────────────────────────────────────
export const FRAIS_PUBLICATION_FCFA = 300; // 300 FCFA par offre publiée


// ══════════════════════════════════════════════════════════════════════════════
// ÉTAPE 1 : Initialiser un paiement → retourne un lien de paiement
// L'agriculteur reçoit ce lien par WhatsApp et paie avec son téléphone
// ══════════════════════════════════════════════════════════════════════════════
export async function initialiserPaiement({ telephone, offre_id, montant = FRAIS_PUBLICATION_FCFA }) {
  const transaction_id = `PAY-${offre_id}-${Date.now()}`;

  const response = await fetch("https://api-checkout.cinetpay.com/v2/payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey:          CINETPAY_API_KEY,
      site_id:         CINETPAY_SITE_ID,
      transaction_id,
      amount:          montant,
      currency:        "XOF",                          // Franc CFA UEMOA
      description:     `Publication offre AgroLink BF - ${offre_id}`,
      notify_url:      `${APP_BASE_URL}/paiement/notification`,   // webhook
      return_url:      `${APP_BASE_URL}/paiement/retour`,
      customer_phone_number: telephone.replace(/^226/, ""),       // sans indicatif
      customer_name:   "Agriculteur",
      customer_email:  `${telephone}@agrolink.bf`,                // email fictif accepté
      channels:        "MOBILE_MONEY",                            // Orange + Moov uniquement
      lang:            "fr",
      metadata:        JSON.stringify({ offre_id, telephone }),
    }),
  });

  const data = await response.json();

  if (data.code !== "201") {
    throw new Error(`CinetPay erreur: ${data.message}`);
  }

  return {
    transaction_id,
    lien_paiement: data.data.payment_url,   // lien à envoyer par WhatsApp
    token:         data.data.payment_token,
  };
}


// ══════════════════════════════════════════════════════════════════════════════
// ÉTAPE 2 : Vérifier le statut d'un paiement (après notification)
// Appelé depuis le webhook /paiement/notification
// ══════════════════════════════════════════════════════════════════════════════
export async function verifierPaiement(transaction_id) {
  const response = await fetch("https://api-checkout.cinetpay.com/v2/payment/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey:         CINETPAY_API_KEY,
      site_id:        CINETPAY_SITE_ID,
      transaction_id,
    }),
  });

  const data = await response.json();

  // Codes de statut CinetPay :
  // "00" = paiement réussi
  // "600" = en attente
  // autre = échec

  return {
    succes:         data.data?.status === "ACCEPTED",
    statut:         data.data?.status,          // ACCEPTED | REFUSED | CANCELLED
    montant:        data.data?.amount,
    operateur:      data.data?.payment_method,  // ORANGE_MONEY | MOOV_MONEY
    reference:      data.data?.operator_id,     // référence de l'opérateur
  };
}


// ══════════════════════════════════════════════════════════════════════════════
// ROUTES EXPRESS pour les webhooks CinetPay
// À ajouter dans agrolink_bot_final.js
// ══════════════════════════════════════════════════════════════════════════════
export function ajouterRoutesP aiement(app, { sendMessage, sauvegarderOffre, enregistrerPaiement, marquerOffrePubliee, postOfferToFacebook }) {

  // CinetPay appelle cette URL après chaque paiement (succès ou échec)
  app.post("/paiement/notification", async (req, res) => {
    res.sendStatus(200); // répondre vite à CinetPay

    try {
      const { cpm_trans_id } = req.body;
      if (!cpm_trans_id) return;

      // 1. Vérifier le paiement auprès de CinetPay
      const paiement = await verifierPaiement(cpm_trans_id);

      // 2. Extraire offre_id et telephone depuis transaction_id
      // Format: "PAY-OFFER-1234567890-1234567890"
      const parts     = cpm_trans_id.split("-");
      const offre_id  = `OFFER-${parts[2]}`;
      const telephone = req.body.metadata ? JSON.parse(req.body.metadata).telephone : null;

      if (paiement.succes) {
        // 3. Enregistrer le paiement dans Supabase
        await enregistrerPaiement({
          telephone,
          offre_id,
          montant_fcfa: paiement.montant,
          methode:      paiement.operateur === "ORANGE_MONEY" ? "orange" : "moov",
          reference:    paiement.reference,
        });

        // 4. Publier l'offre sur Facebook maintenant que c'est payé
        const offre = await sauvegarderOffre({ telephone, offre_id }); // récupère depuis DB
        const fb_id = await postOfferToFacebook(offre);
        await marquerOffrePubliee(offre_id, fb_id);

        // 5. Confirmer à l'agriculteur par WhatsApp
        if (telephone) {
          await sendMessage(telephone,
            `✅ *Paiement reçu !* Merci 🙏\n\n` +
            `💰 ${paiement.montant} FCFA via ${paiement.operateur === "ORANGE_MONEY" ? "Orange Money" : "Moov Money"}\n` +
            `🆔 Référence: ${paiement.reference}\n\n` +
            `📘 Votre offre est maintenant publiée sur la page Facebook AgroLink BF.\n` +
            `Les acheteurs vous contacteront directement.\n\n` +
            `Tapez *Bonjour* pour publier une autre offre.`
          );
        }

      } else {
        // Paiement échoué — avertir l'agriculteur
        if (telephone) {
          await sendMessage(telephone,
            `❌ *Paiement non reçu* (${paiement.statut})\n\n` +
            `Votre offre n'a pas été publiée.\n\n` +
            `Tapez *Bonjour* pour réessayer.`
          );
        }
      }

    } catch (err) {
      console.error("Erreur notification paiement:", err);
    }
  });

  // Page de retour après paiement (vue dans le navigateur)
  app.get("/paiement/retour", (req, res) => {
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>✅ Merci pour votre paiement !</h2>
        <p>Votre offre sera publiée sur AgroLink BF sous quelques minutes.</p>
        <p>Revenez sur WhatsApp pour confirmer.</p>
      </body></html>
    `);
  });
}
