const UI_LANGS = new Set(["en", "hi", "mr", "ta"]);
const MAX_TEXT_LEN = 500;
const MAX_BATCH = 40;
const cache = new Map();
const MAX_CACHE = 12_000;

const LANG_CODES = { en: "en", hi: "hi", mr: "mr", ta: "ta" };

function cacheKey(text, toLang) {
  return `${toLang}\0${text}`;
}

function hasDevanagari(text) {
  return /[\u0900-\u097F]/.test(text);
}

function hasTamil(text) {
  return /[\u0B80-\u0BFF]/.test(text);
}

function hasLatin(text) {
  return /[a-zA-Z]/.test(text);
}

function normalizeComparable(text) {
  return String(text).trim().replace(/\s+/g, " ").toLowerCase();
}

/** @returns {"en" | "inc" | "tam" | "mixed"} */
function detectSourceLang(text) {
  const s = String(text).trim();
  if (!s) return "en";
  const devanagari = (s.match(/[\u0900-\u097F]/g) || []).length;
  const tamil = (s.match(/[\u0B80-\u0BFF]/g) || []).length;
  const latin = (s.match(/[a-zA-Z]/g) || []).length;
  const scripts = [devanagari > 0, tamil > 0, latin > 0].filter(Boolean).length;
  if (scripts > 1) return "mixed";
  if (tamil > 0) return "tam";
  if (devanagari > 0) return "inc";
  return "en";
}

function translationLooksValid(text, translated, toLang) {
  if (!translated || /MYMEMORY\s+WARNING/i.test(translated)) return false;
  if (normalizeComparable(translated) === normalizeComparable(text)) return false;
  if (toLang === "hi" || toLang === "mr") {
    return hasDevanagari(translated) || normalizeComparable(translated) !== normalizeComparable(text);
  }
  if (toLang === "ta") {
    return hasTamil(translated) || normalizeComparable(translated) !== normalizeComparable(text);
  }
  if (toLang === "en") return hasLatin(translated);
  return true;
}

function langPairsFor(text, toLang) {
  const src = detectSourceLang(text);
  if (toLang === "en") {
    if (src === "en") return [];
    if (src === "inc") return ["hi|en", "mr|en", "Autodetect|en"];
    if (src === "tam") return ["ta|en", "Autodetect|en"];
    if (src === "mixed") return ["Autodetect|en", "hi|en", "mr|en", "ta|en"];
  }
  if (toLang === "hi") {
    if (src === "en") return ["en|hi", "Autodetect|hi"];
    if (src === "inc") return ["Autodetect|hi", "mr|hi"];
    if (src === "tam") return ["ta|hi", "Autodetect|hi"];
    if (src === "mixed") return ["Autodetect|hi", "en|hi", "mr|hi", "ta|hi"];
  }
  if (toLang === "mr") {
    if (src === "en") return ["en|mr", "Autodetect|mr"];
    if (src === "inc") return ["Autodetect|mr", "hi|mr"];
    if (src === "tam") return ["ta|mr", "Autodetect|mr"];
    if (src === "mixed") return ["Autodetect|mr", "en|mr", "hi|mr", "ta|mr"];
  }
  if (toLang === "ta") {
    if (src === "en") return ["en|ta", "Autodetect|ta"];
    if (src === "inc") return ["Autodetect|ta", "hi|ta", "mr|ta"];
    if (src === "tam") return [];
    if (src === "mixed") return ["Autodetect|ta", "en|ta", "hi|ta", "mr|ta"];
  }
  return [];
}

async function fetchMyMemory(text, langpair) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langpair}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;

  const data = await res.json();
  const status = data?.responseStatus;
  if (status && Number(status) !== 200) return null;

  const translated = String(data?.responseData?.translatedText || "").trim();
  return translated || null;
}

async function fetchGoogleTranslate(text, toLang) {
  const tl = LANG_CODES[toLang];
  if (!tl) return null;
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "Mozilla/5.0 TaskManager/1.0" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const parts = Array.isArray(data?.[0]) ? data[0] : [];
    const translated = parts
      .map((chunk) => chunk?.[0])
      .filter(Boolean)
      .join("")
      .trim();
    return translated || null;
  } catch {
    return null;
  }
}

async function translateText(text, toLang) {
  const pairs = langPairsFor(text, toLang);
  for (const pair of pairs) {
    const attempt = await fetchMyMemory(text, pair);
    if (attempt && translationLooksValid(text, attempt, toLang)) return attempt;
  }

  const google = await fetchGoogleTranslate(text, toLang);
  if (google && translationLooksValid(text, google, toLang)) return google;

  return text;
}

async function translateWithPair(text, toLang) {
  const key = cacheKey(text, toLang);
  if (cache.has(key)) return cache.get(key);

  const pairs = langPairsFor(text, toLang);
  if (!pairs.length) {
    cache.set(key, text);
    return text;
  }

  const translated = await translateText(text, toLang);
  if (translated !== text) {
    if (cache.size >= MAX_CACHE) {
      const drop = Math.floor(MAX_CACHE / 4);
      for (const k of [...cache.keys()].slice(0, drop)) cache.delete(k);
    }
    cache.set(key, translated);
  }
  return translated;
}

export async function translateTexts(texts, toLang) {
  if (!UI_LANGS.has(toLang)) {
    return Object.fromEntries(texts.map((t) => [t, t]));
  }

  const unique = [...new Set(texts.filter((t) => typeof t === "string" && t.trim()))].slice(0, MAX_BATCH);
  const translations = {};

  for (const text of unique) {
    const trimmed = text.trim();
    if (trimmed.length > MAX_TEXT_LEN) {
      translations[text] = text;
      continue;
    }

    const key = cacheKey(trimmed, toLang);
    if (cache.has(key)) {
      translations[text] = cache.get(key);
      continue;
    }

    translations[text] = await translateWithPair(trimmed, toLang);
  }

  return translations;
}
