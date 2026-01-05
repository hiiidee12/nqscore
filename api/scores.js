export default async function handler(req, res) {
  try {
    // --- input: fid or username ---
    const q = req.query || {};
    const input = (q.fid || q.username || q.user || "").toString().trim();

    if (!input) {
      return res.status(400).json({ error: "Missing query: fid or username" });
    }

    const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
    const QUOTIENT_API_KEY = process.env.QUOTIENT_API_KEY; // optional

    if (!NEYNAR_API_KEY) {
      return res.status(500).json({ error: "Missing env: NEYNAR_API_KEY" });
    }

    // --- resolve fid + username via Neynar ---
    // If input is numeric => treat as fid, else username (without @)
    const isFid = /^\d+$/.test(input);
    const fid = isFid ? Number(input) : null;
    const username = isFid ? null : input.replace(/^@/, "");

    // Neynar: resolve user
    const neynarUserUrl = fid
      ? `https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`
      : `https://api.neynar.com/v2/farcaster/user/search?q=${encodeURIComponent(username)}&limit=1`;

    const neynarUserResp = await fetch(neynarUserUrl, {
      headers: { api_key: NEYNAR_API_KEY },
    });

    if (!neynarUserResp.ok) {
      const t = await neynarUserResp.text();
      return res.status(502).json({ error: "Neynar user lookup failed", detail: t });
    }

    const neynarUserJson = await neynarUserResp.json();

    // Extract user
    let user = null;
    if (fid) {
      // bulk returns { users: [...] }
      user = (neynarUserJson.users && neynarUserJson.users[0]) || null;
    } else {
      // search returns { result: { users: [...] } } (can vary) - handle common shapes
      user =
        (neynarUserJson.result && neynarUserJson.result.users && neynarUserJson.result.users[0]) ||
        (neynarUserJson.users && neynarUserJson.users[0]) ||
        null;
    }

    if (!user || !user.fid) {
      return res.status(404).json({ error: "User not found" });
    }

    const resolved = {
      fid: user.fid,
      username: user.username || null,
      displayName: user.display_name || null,
      pfpUrl: user.pfp_url || null,
    };

    // --- Neynar score ---
    // (contoh endpoint; sesuaikan dengan yang kamu pakai sebelumnya kalau beda)
    const neynarScoreUrl = `https://api.neynar.com/v2/farcaster/user/score?fid=${resolved.fid}`;
    const neynarScoreResp = await fetch(neynarScoreUrl, {
      headers: { api_key: NEYNAR_API_KEY },
    });

    let neynarUserScore = null;
    if (neynarScoreResp.ok) {
      const j = await neynarScoreResp.json();
      neynarUserScore =
        j?.score ??
        j?.user_score ??
        j?.result?.score ??
        null;
    }

    // --- Quotient score (OPTIONAL) ---
    let quotientScore = null;
    let quotientRank = null;
    let quotientError = null;

    if (QUOTIENT_API_KEY) {
      const quotientResp = await fetch("https://api.quotient.social/v1/user-reputation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fids: [resolved.fid],
          api_key: QUOTIENT_API_KEY,
        }),
      });

      if (quotientResp.ok) {
        const qj = await quotientResp.json();
        const row = qj?.data?.[0] || null;
        quotientScore = row?.quotientScore ?? null;
        quotientRank = row?.quotientRank ?? null;
      } else {
        quotientError = await quotientResp.text();
      }
    } else {
      quotientError = "Missing env: QUOTIENT_API_KEY (optional)";
    }

    return res.status(200).json({
      ok: true,
      resolved,
      scores: {
        neynarUserScore,
        quotientScore,
        quotientRank,
      },
      meta: {
        quotientEnabled: Boolean(QUOTIENT_API_KEY),
        quotientError: quotientError || null,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e?.message || e) });
  }
}
