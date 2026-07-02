import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { translateTexts } from "../lib/contentTranslate.js";

const router = Router();

const UI_LANGS = new Set(["en", "hi", "mr", "ta"]);
const MAX_TEXT_LEN = 500;
const MAX_BATCH = 40;

function normalizeTranslateTexts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_BATCH)
    .map((value) => String(value ?? "").trim().replace(/\s+/g, " "))
    .filter((value) => value && value.length <= MAX_TEXT_LEN);
}

router.post("/", requireAuth, async (req, res) => {
  const to = String(req.body?.to || "");
  if (!UI_LANGS.has(to)) {
    return res.status(400).json({ error: "Invalid target language" });
  }

  const texts = normalizeTranslateTexts(req.body?.texts);
  if (!texts.length) {
    return res.json({ translations: {} });
  }

  try {
    const translations = await translateTexts(texts, to);
    res.json({ translations });
  } catch (err) {
    console.error("translate error:", err);
    res.status(502).json({ error: "Translation service unavailable" });
  }
});

export default router;
