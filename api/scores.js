export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed. Use GET." });
    }

    const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
    const QUOTIENT_API_KEY = process.env.QUOTIENT_API_KEY; // optional

    if (!NEYNAR_API_KEY) {
      return res.status(500).json({ error: "Missing env: NEYNAR_API_KEY" });
    }

    const { fid, username } = req.query;

    if ((!fid || String(fid).trim() === "") && (!username || String(username).trim() === "")) {
      return res.status(400).json({ error: "Provide fid or username" });
    }

    const neynarHeaders = {
      "x-api-key": NEYNAR_API_KEY,
      "x-neynar-experimental": "true",
      accept: "application/json",
    };

    // 1) Resolve user (and get neynar_user_score from user object)
    let user = null;

    if (fid && String(fid).trim() !== "") {
      const f = String(fid).trim();
      if (!/^\d+$/.test(f)) return res.status(400).json({ error: "fid must be a number" });

      const url = `https://api.neynar.com/v2/farcaster/user/bulk?fids=${encodeURIComponent(f)}`;
      const r = await fetch(url, { headers: neynarHeaders });
      const j = await r.json().catch(() => ({}));

      if (!r.ok) return res.status(r.status).json({ error: "Neynar API error", details: j });

      user = Array.isArray(j?.users) ? j.users[0] : null;
    } else {
      const u = String(username).trim().replace(/^@/, "");
      const url = `https://api.neynar.com/v2/farcaster/user/by_username?username=${encodeURIComponent(u)}`;
      const r = await fetch(url, { headers: neynarHeaders });
      const j = await r.json().catch(() => ({}));

      if (!r.ok) return res.status(r.status).json({ error: "Neynar API error", details: j });

      user = j?.user ?? null;
    }

    if (!user?.fid) {
      return res.status(404).json({ error: "User not found" });
    }

    const resolved = {
      fid: user.fid,
      username: user.username ?? null,
    };

    // Neynar score lives here (per docs)
    let neynarUserScore = user?.experimental?.neynar_user_score ?? null; // number 0..1 2
    if (neynarUserScore != null) {
      const n = Number(neynarUserScore);
      neynarUserScore = Number.isFinite(n) ? n : null;
    }

    // 2) Quotient (optional) — skip if no key
    let quotientScore = null;
    let quotientRank = null;
    let quotientError = null;

    if (QUOTIENT_API_KEY) {
      const qRes = await fetch("https://api.quotient.social/v1/user-reputation", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ fids: [Number(resolved.fid)], api_key: QUOTIENT_API_KEY }),
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
      } else {
        quotientError = { status: qRes.status, details: qJson };
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
        quotientError,
      },
      raw: {
        neynar: user, // biar kamu bisa cek field experimental di "Show raw JSON"
      },
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: String(err?.message || err) });
  }
}
