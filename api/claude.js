/* ============================================================
   CM Program App — Proxy Claude (Fonction Vercel)
   ------------------------------------------------------------
   Se place ENTRE l'app des élèves et l'API Anthropic et garde
   la clé API secrète (côté serveur). Hébergé sur le même domaine
   que l'app, donc appelé via "/api/claude" (pas de CORS).

   Utilise le module https natif de Node (disponible sur toutes
   les versions), plutôt que le fetch global (absent sur les
   anciennes versions de Node → provoquait une erreur 502).

   La clé se règle en variable d'environnement ANTHROPIC_API_KEY
   dans Vercel (jamais dans ce fichier). Voir HEBERGEMENT-VERCEL.md.
   ============================================================ */

const https = require("https");

// Le modèle utilisé pour TOUTES les fonctions IA (un seul endroit).
const MODEL = "claude-sonnet-4-6";

// Plafond de tokens en sortie par appel (garde-fou anti-dérapage de coût).
const MAX_TOKENS_CAP = 4096;

// Appel à l'API Anthropic via le module https natif.
function callAnthropic(payload, apiKey) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
      },
      (r) => {
        let body = "";
        r.on("data", (c) => (body += c));
        r.on("end", () => resolve({ status: r.statusCode || 502, text: body }));
      }
    );
    req.on("error", reject);
    req.setTimeout(55000, () => req.destroy(new Error("Délai dépassé côté Anthropic")));
    req.write(data);
    req.end();
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée" });
    return;
  }
  // On retire tout caractère invalide dans un en-tête HTTP (espaces, retours à la
  // ligne, caractères invisibles collés par erreur). Une clé Anthropic ne contient
  // que des caractères ASCII imprimables : on ne garde donc que ceux-là.
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").replace(/[^\x21-\x7e]/g, "");
  if (!apiKey) {
    res.status(500).json({ error: "Clé API non configurée sur le serveur" });
    return;
  }

  // Vercel remplit req.body automatiquement quand le Content-Type est JSON.
  let incoming = req.body;
  if (typeof incoming === "string") {
    try { incoming = JSON.parse(incoming); } catch (e) { incoming = null; }
  }
  if (!incoming) {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      incoming = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (e) {
      res.status(400).json({ error: "Requête illisible" });
      return;
    }
  }
  if (!incoming || !Array.isArray(incoming.messages)) {
    res.status(400).json({ error: "Champ 'messages' manquant" });
    return;
  }

  const body = {
    model: MODEL,
    max_tokens: Math.min(Number(incoming.max_tokens) || 1000, MAX_TOKENS_CAP),
    messages: incoming.messages,
  };
  if (typeof incoming.system === "string" && incoming.system.trim()) {
    body.system = incoming.system;
  }

  try {
    const out = await callAnthropic(body, apiKey);
    res.status(out.status);
    res.setHeader("Content-Type", "application/json");
    res.send(out.text);
  } catch (e) {
    res.status(502).json({ error: "Service indisponible", detail: String((e && e.message) || e) });
  }
};
