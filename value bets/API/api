// Función serverless (Vercel). La clave vive en la variable de entorno ODDS_API_KEY.
const BASE = "https://api.the-odds-api.com/v4";

// Ligas que se consultan. Cada una gasta 1 crédito por actualización.
// Quita las que no quieras para ahorrar créditos.
const SPORTS = [
  "soccer_spain_la_liga",
  "soccer_epl",
  "soccer_germany_bundesliga",
  "soccer_italy_serie_a",
  "soccer_france_ligue_one",
  "soccer_uefa_champs_league",
  "basketball_nba",
  "basketball_euroleague",
];
// El tenis cambia según el torneo activo: se detecta solo.
const TENNIS_PREFIXES = ["tennis_atp_", "tennis_wta_"];
const MAX_TENNIS = 2;

// Segundos que se reutilizan los datos antes de volver a gastar créditos.
const CACHE = parseInt(process.env.CACHE_SECONDS || "21600", 10); // 6 horas

module.exports = async (req, res) => {
  const key = process.env.ODDS_API_KEY;
  if (!key) return res.status(500).json({ error: "Falta la variable ODDS_API_KEY" });
  try {
    // Esta llamada es gratuita (no gasta créditos)
    const all = await (await fetch(`${BASE}/sports/?apiKey=${key}`)).json();
    if (!Array.isArray(all)) throw new Error(all.message || "Error al listar deportes");
    const active = new Set(all.filter((s) => s.active).map((s) => s.key));
    const tennis = [...active]
      .filter((k) => TENNIS_PREFIXES.some((p) => k.startsWith(p)))
      .slice(0, MAX_TENNIS);
    const keys = SPORTS.filter((k) => active.has(k)).concat(tennis);

    let remaining = null;
    const results = await Promise.all(
      keys.map(async (k) => {
        const r = await fetch(
          `${BASE}/sports/${k}/odds/?apiKey=${key}&regions=eu&markets=h2h&oddsFormat=decimal`
        );
        remaining = r.headers.get("x-requests-remaining") ?? remaining;
        const d = await r.json();
        return Array.isArray(d) ? d.map((e) => ({ ...e, sport_key: k })) : [];
      })
    );
    res.setHeader("Cache-Control", `s-maxage=${CACHE}, stale-while-revalidate`);
    res.status(200).json({
      updated: new Date().toISOString(),
      remaining,
      requests: keys.length,
      events: results.flat(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
