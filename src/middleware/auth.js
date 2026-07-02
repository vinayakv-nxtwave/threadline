import crypto from "crypto";

const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_TTL_MS = 30 * DAY_MS;

function sign(payload) {
  return crypto.createHmac("sha256", process.env.DASHBOARD_PASSWORD).update(payload).digest("hex");
}

export function issueToken() {
  const exp = String(Date.now() + TOKEN_TTL_MS);
  return `${exp}.${sign(exp)}`;
}

export function verifyToken(token) {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig) return false;

  const expectedSig = Buffer.from(sign(exp), "hex");
  const providedSig = Buffer.from(sig, "hex");
  if (expectedSig.length !== providedSig.length) return false;
  if (!crypto.timingSafeEqual(expectedSig, providedSig)) return false;

  return Number(exp) > Date.now();
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!verifyToken(token)) return res.status(401).json({ error: "unauthorized" });
  next();
}
