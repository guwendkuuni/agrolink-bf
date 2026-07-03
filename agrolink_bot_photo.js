// AgroLink BF — Bot WhatsApp avec photos
// Nouveau flux : produit → prix → lieu → PHOTO (optionnelle) → confirmer → payer

import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { getSession, saveSession, deleteSession, sauvegarderOffre } from "./database.js";
import { postOfferToFacebook } from "./facebook_poster_photo.js";
import { initialiserPaiement } from "./paiement.js";
//Import for policy file
import { fileURLToPath } from "url";


const app = express();
app.use(express.json());

//Route add for policy file - START
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.get('/privacy-policy', (req, res) => {
  res.sendFile(path.join(__dirname, 'privacy-policy-full.html'));
});
//Route add for policy file - END

const WA_TOKEN   = process.env.WA_TOKEN;
const PHONE_ID   = process.env.WA_PHONE_ID;
const VERIFY_TOK = process.env.WA_VERIFY_TOKEN;

// ─── ENVOI DE MESSAGE TEXTE ───────────────────────────────────────────────────
async function sendMessage(to, text) {
  await fetch(`https://graph.facebook.com/v18.0/${PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });
}

// ─── TÉLÉCHARGER LA PHOTO ENVOYÉE PAR L'AGRICULTEUR ──────────────────────────
// WhatsApp envoie un media_id — on récupère l'URL puis on télécharge la photo
async function downloadPhoto(media_id) {
  // 1. Récupérer l'URL temporaire de la photo
  const infoRes = await fetch(`https://graph.facebook.com/v18.0/${media_id}`, {
    headers: { Authorization: `Bearer ${WA_TOKEN}` },
  });
  const info = await infoRes.json();

  if (!info.url) throw new Error("URL photo introuvable");

  // 2. Télécharger la photo en bytes
  const photoRes = await fetch(info.url, {
    headers: { Authorization: `Bearer ${WA_TOKEN}` },
  });

  // 3. Retourner le buffer + le type MIME (image/jpeg, image/png…)
  const buffer   = Buffer.from(await photoRes.arrayBuffer());
  const mimeType = info.mime_type || "image/jpeg";

  return { buffer, mimeType };
}

// ─── UPLOADER LA PHOTO VERS FACEBOOK (pour la publier ensuite) ───────────────
// On uploade d'abord la photo sur la page Facebook, puis on l'attache au post
async function uploadPhotoToFacebook(buffer, mimeType, FB_PAGE_ID, FB_PAGE_TOKEN) {
  const { FormData, Blob } = await import("node-fetch");

  const form = new FormData();
  form.append("source", new Blob([buffer], { type: mimeType }), "photo.jpg");
  form.append("published", "false");           // pas encore publié — juste uploadé
  form.append("access_token", FB_PAGE_TOKEN);

  const res = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/photos`, {
    method: "POST",
    body: form,
  });

  const data = await res.json();
  if (data.error) throw new Error(`Upload photo Facebook: ${data.error.message}`);

  return data.id; // photo_id à attacher au post
}

// ─── LOGIQUE DE CONVERSATION ──────────────────────────────────────────────────
async function handleMessage(telephone, message) {
  const session = await getSession(telephone);

  // ── message texte ──
  const texte = message.type === "text" ? message.text.body.trim() : null;

  // ── message image ──
  const media_id   = message.type === "image" ? message.image?.id : null;
  const media_mime = message.type === "image" ? message.image?.mime_type : null;

  switch (session.etape) {

    case "MENU": {
      if (texte === "1") {
        await saveSession(telephone, { etape: "PRODUIT" });
        await sendMessage(telephone,
          "📦 Quel produit vendez-vous ?\n" +
          "Tapez le nom et la quantite.\n\n" +
          "Exemple: _100kg de mais_"
        );
      } else if (texte === "2") {
        const { getOffresActives } = await import("./database.js");
        const offres = await getOffresActives({ limite: 5 });
        if (offres.length === 0) {
          await sendMessage(telephone, "Aucune offre disponible.\n\nTapez *Bonjour* pour recommencer.");
        } else {
          let liste = "📋 *Offres disponibles:*\n\n";
          offres.forEach(o => {
            const photo = o.photo_url ? "📷 " : "";
            liste += `${photo}🌱 ${o.produit} — ${o.prix_fcfa} FCFA — ${o.localisation}\n📞 +226 ${o.telephone.replace(/^226/, "")}\n\n`;
          });
          await sendMessage(telephone, liste);
        }
        await deleteSession(telephone);
      } else {
        await sendMessage(telephone,
          "👋 Bienvenue sur *AgroLink BF* !\n\n" +
          "Repondez avec un chiffre:\n" +
          "1️⃣  Vendre un produit\n" +
          "2️⃣  Voir les offres du marche\n" +
          "3️⃣  Aide"
        );
      }
      break;
    }

    case "PRODUIT": {
      if (!texte) {
        await sendMessage(telephone, "Veuillez taper le nom de votre produit.\nEx: _100kg de mais_");
        return;
      }
      await saveSession(telephone, { etape: "PRIX", produit: texte });
      await sendMessage(telephone,
        `✅ Produit: *${texte}*\n\n` +
        "💰 Quel est votre prix en FCFA ?\nEx: _150_"
      );
      break;
    }

    case "PRIX": {
      if (!texte) {
        await sendMessage(telephone, "Veuillez taper le prix en FCFA.\nEx: _150_");
        return;
      }
      const prix = parseInt(texte.replace(/\D/g, ""), 10);
      if (isNaN(prix) || prix <= 0) {
        await sendMessage(telephone, "❌ Prix invalide. Entrez un nombre.\nEx: _150_");
        return;
      }
      await saveSession(telephone, { etape: "LIEU", prix });
      await sendMessage(telephone,
        `✅ Prix: *${prix} FCFA*\n\n` +
        "📍 Dans quelle ville ou village ?\nEx: _Koudougou_, _Ouahigouya_…"
      );
      break;
    }

    case "LIEU": {
      if (!texte) {
        await sendMessage(telephone, "Veuillez taper votre ville ou village.");
        return;
      }
      await saveSession(telephone, { etape: "PHOTO", localisation: texte });
      await sendMessage(telephone,
        `✅ Lieu: *${texte}*\n\n` +
        "📷 *Envoyez une photo de votre produit* (optionnel)\n\n" +
        "Une belle photo attire plus d'acheteurs !\n\n" +
        "👉 Envoyez la photo maintenant\n" +
        "👉 Ou tapez *SANS* pour continuer sans photo"
      );
      break;
    }

    // ── NOUVEAU : étape PHOTO ─────────────────────────────────────────────────
    case "PHOTO": {

      if (media_id) {
        // L'agriculteur a envoyé une photo
        await sendMessage(telephone, "⏳ Photo reçue, traitement en cours...");

        try {
          // Télécharger la photo depuis WhatsApp
          const { buffer, mimeType } = await downloadPhoto(media_id);

          // Sauvegarder en session (comme base64 compact)
          const photoB64 = buffer.toString("base64");
          await saveSession(telephone, {
            etape:      "CONFIRMER",
            photo_b64:  photoB64,
            photo_mime: mimeType,
          });

          await sendMessage(telephone,
            "✅ *Photo enregistrée !*\n\n" +
            "📋 *Verifiez votre offre:*\n\n" +
            `🌾 Produit  : ${session.produit}\n` +
            `💰 Prix     : ${session.prix} FCFA\n` +
            `📍 Lieu     : ${session.localisation}\n` +
            `📷 Photo    : Oui\n\n` +
            "Confirmez-vous ? Tapez *OUI* ou *NON*"
          );
        } catch (err) {
          console.error("Erreur téléchargement photo:", err);
          await sendMessage(telephone,
            "❌ Problème avec la photo. Réessayez ou tapez *SANS* pour continuer sans photo."
          );
        }

      } else if (texte && texte.toUpperCase() === "SANS") {
        // L'agriculteur ne veut pas de photo
        await saveSession(telephone, { etape: "CONFIRMER", photo_b64: null });
        await sendMessage(telephone,
          "📋 *Verifiez votre offre:*\n\n" +
          `🌾 Produit  : ${session.produit}\n` +
          `💰 Prix     : ${session.prix} FCFA\n` +
          `📍 Lieu     : ${session.localisation}\n` +
          `📷 Photo    : Non\n\n` +
          "Confirmez-vous ? Tapez *OUI* ou *NON*"
        );

      } else {
        // Rappel si l'agriculteur envoie autre chose
        await sendMessage(telephone,
          "📷 Envoyez une *photo* de votre produit\n" +
          "ou tapez *SANS* pour continuer sans photo."
        );
      }
      break;
    }

    case "CONFIRMER": {
      if (!texte) {
        await sendMessage(telephone, "Tapez *OUI* pour confirmer ou *NON* pour corriger.");
        return;
      }

      if (texte.toUpperCase() === "OUI") {
        try {
          // Préparer le buffer photo si présent
          const photoBuffer = session.photo_b64
            ? Buffer.from(session.photo_b64, "base64")
            : null;

          // Sauvegarder l'offre dans Supabase
          const offre = await sauvegarderOffre({
            telephone,
            produit:      session.produit,
            prix:         session.prix,
            localisation: session.localisation,
            photo_buffer: photoBuffer,
            photo_mime:   session.photo_mime || null,
          });

          // Générer le lien de paiement Orange Money / Moov
          const paiement = await initialiserPaiement({
            telephone,
            offre_id: offre.id,
          });

          await sendMessage(telephone,
            `📋 *Derniere etape — Paiement*\n\n` +
            `Pour publier votre offre, payez les frais :\n` +
            `💰 *300 FCFA* (Orange Money ou Moov Money)\n\n` +
            `👉 Cliquez ici pour payer :\n${paiement.lien_paiement}\n\n` +
            `Votre offre sera publiee sur Facebook apres paiement.\n` +
            `${session.photo_b64 ? "📷 La photo sera incluse dans l'annonce." : ""}`
          );

        } catch (err) {
          console.error("Erreur confirmation:", err);
          await sendMessage(telephone,
            "❌ Une erreur s'est produite. Tapez *Bonjour* pour reessayer."
          );
        }
        await deleteSession(telephone);

      } else if (texte.toUpperCase() === "NON") {
        await saveSession(telephone, { etape: "PRODUIT", produit: null, prix: null, localisation: null, photo_b64: null });
        await sendMessage(telephone, "🔄 Ok, recommençons.\n\n📦 Quel produit vendez-vous ?");
      } else {
        await sendMessage(telephone, "Tapez *OUI* pour confirmer ou *NON* pour corriger.");
      }
      break;
    }

    default:
      await deleteSession(telephone);
      await handleMessage(telephone, message);
  }
}

// ─── WEBHOOK ─────────────────────────────────────────────────────────────────
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOK) {
    res.status(200).send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return;

    // Accepter texte ET images (ignorer autres types)
    if (message.type !== "text" && message.type !== "image") return;

    console.log(`📱 ${message.from} [${message.type}]`);
    await handleMessage(message.from, message);
  } catch (err) {
    console.error("Erreur webhook:", err);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 AgroLink BF actif sur port ${PORT}`));
