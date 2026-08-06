/* ============================================================
   CM Program App — Proxy Claude (Fonction Vercel)
   ------------------------------------------------------------
   Ce petit service se place ENTRE l'app des élèves et l'API Anthropic.
   Il garde ta clé API secrète (côté serveur) : les élèves ne la voient
   jamais et ne peuvent donc pas l'utiliser à ta place.

   Il est hébergé sur le MÊME domaine que l'app (Vercel), donc l'app
   l'appelle simplement via "/api/claude" — pas de CORS à gérer.

   Ce qu'il fait :
   - reçoit la requête de l'app (les messages, éventuellement un system) ;
   - impose LE modèle et plafonne max_tokens (tu contrôles le coût ici) ;
   - ajoute ta clé et appelle l'API Anthropic ;
   - renvoie la réponse à l'app.

   La clé se règle en variable d'environnement ANTHROPIC_API_KEY dans
   Vercel (jamais dans ce fichier). Voir HEBERGEMENT-VERCEL.md.
   ============================================================ */

// Le modèle utilisé pour TOUTES les fonctions IA. Tu peux le changer ici,
// à un seul endroit. "claude-sonnet-4-6" = bon rapport qualité/prix.
const MODEL = "claude-sonnet-4-6";

// Plafond de tokens en sortie par appel (garde-fou anti-dérapage de coût).
// 4096 laisse passer l'extraction de fiche client depuis un PDF (JSON plus long)
// sans être tronquée, tout en gardant un coût maîtrisé.
const MAX_TOKENS_CAP = 4096;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée" });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "Clé API non configurée sur le serveur" });
    return;
  }

  // Vercel remplit req.body automatiquement quand le Content-Type est JSON.
  // Filet de sécurité si ce n'est pas le cas (chaîne à parser, ou flux brut).
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

  // On reconstruit le corps : le modèle et le plafond sont imposés ici,
  // on ne fait confiance qu'aux messages et au system envoyés par l'app.
  const body = {
    model: MODEL,
    max_tokens: Math.min(Number(incoming.max_tokens) || 1000, MAX_TOKENS_CAP),
    messages: incoming.messages,
  };
  if (typeof incoming.system === "string" && incoming.system.trim()) {
    body.system = incoming.system;
  }

  let upstream, text;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    text = await upstream.text();
  } catch (e) {
    res.status(502).json({ error: "Service indisponible" });
    return;
  }

  res.status(upstream.status);
  res.setHeader("Content-Type", "application/json");
  res.send(text);
};
