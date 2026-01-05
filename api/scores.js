export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed. Use GET." });
    }

    const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
    const QUOTIENT_API_KEY = process.env.QUOTIENT_API_KEY;

    if (!NEYNAR_API_KEY) {
      return res.status(500).json({ error: "Missing env: NEYNAR_API_KEY" });
    }
    if (!QUOTIENT_API_KEY) {
      return res.status(500).json({ error: "Missing env: QUOTIENT_API_KEY" });
    }

    const { fid, username } = req.query;

    if ((!fid || String(fid).trim() === "") && (!username || String(username).trim() === "")) {
      return res.status(400).json({ error: "Provide fid or username" });
    }

    // ---------- Resolve user via Neynar ----------
    let resolvedFid = null;
    let resolvedUsername = null;
    let neynarUserScore = null;
    let neynarUserRaw = null;

    const neynarHeaders = {
      accept: "application/json",
      "x-api-key": NEYNAR_API_KEY,
      "x-neynar-experimental": "true" // ensures experimental.neynar_user_score is included
    };

    if (fid && String(fid).trim() !== "") {
      const f = String(fid).trim();
      if (!/^\d+$/.test(f)) {
        return res.status(400).json({ error: "fid must be a number" });
      }

      const url =
        "https://api.neynar.com/v2/farcaster/user/bulk/?fids=" +
        encodeURIComponent(f);

      const r = await fetch(url, { headers: neynarHeaders });
      const j = await r.json().catch(() => ({}));

      if (!r.ok) {
        return res.status(r.status).json({ error: "Neynar API error", details: j });
      }

      const user = Array.isArray(j?.users) ? j.users[0] : null;
      if (!user) {
        return res.status(404).json({ error: "User not found by fid" });
      }

      resolvedFid = user.fid ?? Number(f);
      resolvedUsername = user.username ?? null;
      neynarUserScore =
        user?.experimental?.neynar_user_score ??
        user?.experimental?.neynar_user_score?.score ??
        user?.neynar_user_score ??
        null;

      neynarUserRaw = user;
    } else {
      const u = String(username).trim().replace(/^@/, "");
      if (!u) return res.status(400).json({ error: "username is empty" });

      const url =
        "https://api.neynar.com/v2/farcaster/user/by_username/?username=" +
        encodeURIComponent(u);

      const r = await fetch(url, { headers: neynarHeaders });
      const j = await r.json().catch(() => ({}));

      if (!r.ok) {
        return res.status(r.status).json({ error: "Neynar API error", details: j });
      }

      const user = j?.user ?? null;
      if (!user) {
        return res.status(404).json({ error: "User not found by username" });
      }

      resolvedFid = user.fid ?? null;
      resolvedUsername = user.username ?? u;
      neynarUserScore =
        user?.experimental?.neynar_user_score ??
        user?.experimental?.neynar_user_score?.score ??
        user?.neynar_user_score ??
        null;

      neynarUserRaw = user;
    }

    if (!resolvedFid) {
      return res.status(400).json({ error: "Could not resolve fid from Neynar response" });
    }

    // normalize score to number if possible
    if (neynarUserScore != null) {
      const n = Number(neynarUserScore);
      neynarUserScore = Number.isFinite(n) ? n : null;
    }

    // ---------- Quotient score ----------
    let quotientScore = null;
    let quotientRank = null;
    let quotientRaw = null;

    const qRes = await fetch("https://api.quotient.social/v1/user-reputation", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        fids: [Number(resolvedFid)],
        api_key: QUOTIENT_API_KEY
      })
    });

    const qJson = await qRes.json().catch(() => ({}));
    if (qRes.ok) {
      const row = Array.isArray(qJson?.data) ? qJson.data[0] : null;
      if (row) {
        const qs = Number(row.quotientScore);
        quotientScore = Number.isFinite(qs) ? qs : null;

        const qr = Number(row.quotientRank);
        quotientRank = Number.isFinite(qr) ? qr : null;
      }
      quotientRaw = qJson;
    } else {
      // Don't fail whole request if Quotient fails; return partial results
      quotientRaw = { error: "Quotient API error", status: qRes.status, details: qJson };
    }

    // ---------- Response (matches your index.html expectation) ----------
    return res.status(200).json({
      ok: true,
      resolved: {
        fid: resolvedFid,
        username: resolvedUsername
      },
      scores: {
        neynarUserScore,
        quotientScore,
        quotientRank
      },
      raw: {
        neynar: neynarUserRaw,
        quotient: quotientRaw
      }
    });
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: String(err?.message || err)
    });
  }
}
