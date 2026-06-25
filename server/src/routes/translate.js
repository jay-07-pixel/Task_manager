import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { translateTexts } from "../lib/contentTranslate.js";

const router = Router();

const bodySchema = z.object({
  texts: z.array(z.string().max(500)).max(40),
  to: z.enum(["hi", "mr"]),
});

router.post("/", requireAuth, async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid translate request" });
  }

  const { texts, to } = parsed.data;
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
