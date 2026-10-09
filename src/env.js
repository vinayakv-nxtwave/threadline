import dotenv from "dotenv";

dotenv.config();

// "production" (default) or "beta". Beta runs against its own database and
// never sends anything out over WhatsApp -- see whapiClient.js and
// docs/ENVIRONMENTS.md. Anything other than exactly "beta" is treated as
// production, so a missing/typo'd value can never silently disable sending.
export const APP_ENV = process.env.APP_ENV === "beta" ? "beta" : "production";
export const IS_BETA = APP_ENV === "beta";
