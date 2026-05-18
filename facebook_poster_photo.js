// AgroLink BF — Publication Facebook AVEC photo
// Deux cas : post avec photo jointe, ou post texte simple

import fetch from "node-fetch";

const FB_PAGE_ID    = process.env.FB_PAGE_ID;
const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;

// Emojis par produit
const PRODUCT_EMOJIS = {
  "mais": "🌽", "maïs": "🌽", "mil": "🌾", "sorgho": "🌾",
  "haricot": "🫘", "tomate": "🍅", "oignon": "🧅", "mangue": "🥭",
  "arachide": "🥜", "coton": "🪡", "riz": "🍚", "igname": "🍠",
  "patate": "🍠", "volaille": "🐔", "poulet": "🐔", "boeuf": "🐄", "mouton": "🐑",
};

function getEmoji(product) {
  const lower = product.toLowerCase();
  for (const [key, emoji] of Object.entries(PRODUCT_EMOJIS)) {
    if (lower.includes(key)) return emoji;
  }
  return "🌱";
}

function formatPhone(phone) {
  const local = phone.replace(/^226/, "");
  return local.replace(/(\d{2})(\d{2})(\d{2})(\d{2})/, "$1 $2 $3 $4");
}

function buildMessage(offer) {
  const emoji = getEmoji(offer.product);
  const date  = new Date().toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric"
  });
  return (
    `${emoji} NOUVELLE OFFRE — AgroLink BF\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📦 Produit  : ${offer.product}\n` +
    `💰 Prix     : ${offer.price.toLocaleString("fr-FR")} FCFA\n` +
    `📍 Lieu     : ${offer.location}\n` +
    `📞 Contact  : +226 ${formatPhone(offer.phone)}\n` +
    `🆔 Offre    : #${offer.id}\n` +
    `📅 Date     : ${date}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👉 Interesse(e) ? Contactez directement le vendeur.\n\n` +
    `#AgroLinkBF #Agriculture #BurkinaFaso #${offer.location.replace(/\s/g, "")}`
  );
}

// ── ÉTAPE 1 : Uploader la photo sur la page (non publiée) ─────────────────────
async function uploadPhoto(photoBuffer, mimeType) {
  // node-fetch v3 supporte FormData natif
  const { FormData, Blob } = await import("node-fetch");

  const form = new FormData();
  form.append("source", new Blob([photoBuffer], { type: mimeType }), "offre.jpg");
  form.append("published",     "false");          // on la publiera avec le post
  form.append("access_token",  FB_PAGE_TOKEN);

  const res  = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/photos`, {
    method: "POST",
    body: form,
  });
  const data = await res.json();

  if (data.error) throw new Error(`Upload photo: ${data.error.message}`);
  console.log(`📷 Photo uploadée. ID: ${data.id}`);
  return data.id; // photo_id
}

// ── ÉTAPE 2 : Publier le post (avec ou sans photo) ────────────────────────────
export async function postOfferToFacebook(offer) {
  const message = buildMessage(offer);

  let body;

  if (offer.photo_buffer && offer.photo_mime) {
    // ── CAS AVEC PHOTO ──
    // On uploade la photo d'abord, puis on crée le post en l'attachant
    const photo_id = await uploadPhoto(offer.photo_buffer, offer.photo_mime);

    body = JSON.stringify({
      message,
      attached_media: [{ media_fbid: photo_id }],
      access_token: FB_PAGE_TOKEN,
    });

  } else {
    // ── CAS SANS PHOTO ──
    body = JSON.stringify({
      message,
      access_token: FB_PAGE_TOKEN,
    });
  }

  const res  = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const data = await res.json();

  if (data.error) throw new Error(`Post Facebook: ${data.error.message}`);

  const type = offer.photo_buffer ? "avec photo 📷" : "sans photo";
  console.log(`✅ Post Facebook publié (${type}). ID: ${data.id}`);
  return data.id;
}
