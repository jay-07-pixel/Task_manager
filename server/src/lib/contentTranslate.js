const UI_LANGS = new Set(["en", "hi", "mr"]);
const MAX_TEXT_LEN = 500;
const MAX_BATCH = 40;
const cache = new Map();
const MAX_CACHE = 12_000;

function cacheKey(text, toLang) {
  return `${toLang}\0${text}`;
}

/** @returns {"en" | "inc"} */
function detectSourceLang(text) {
  const s = String(text).trim();
  if (!s) return "en";
  const devanagari = (s.match(/[\u0900-\u097F]/g) || []).length;
  const latin = (s.match(/[a-zA-Z]/g) || []).length;
  if (devanagari > 0 && devanagari >= latin) return "inc";
  return "en";
}

/**
 * Langpairs to try when translating `text` into the UI language.
 * Empty array = no translation needed.
 */
function langPairsFor(text, toLang) {
  const src = detectSourceLang(text);
  if (src === "en" && toLang === "en") return [];
  if (src === "inc" && toLang === "hi") return [];
  if (src === "inc" && toLang === "mr") return [];
  if (src === "en" && toLang === "hi") return ["en|hi"];
  if (src === "en" && toLang === "mr") return ["en|mr"];
  if (src === "inc" && toLang === "en") return ["Autodetect|en", "mr|en", "hi|en"];
  return [];
}

async function fetchTranslation(text, langpair) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langpair}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) return text;

  const data = await res.json();
  const status = data?.responseStatus;
  if (status && Number(status) !== 200) return text;

  const translated = String(data?.responseData?.translatedText || text).trim();
  if (!translated || translated.toUpperCase() === text.toUpperCase()) return text;
  return translated;
}

async function translateWithPair(text, toLang) {
  const key = cacheKey(text, toLang);
  if (cache.has(key)) return cache.get(key);

  const pairs = langPairsFor(text, toLang);
  if (!pairs.length) {
    cache.set(key, text);
    return text;
  }

  let translated = text;
  for (const pair of pairs) {
    const attempt = await fetchTranslation(text, pair);
    if (attempt !== text) {
      translated = attempt;
      break;
    }
  }

  if (cache.size >= MAX_CACHE) {
    const drop = Math.floor(MAX_CACHE / 4);
    for (const k of [...cache.keys()].slice(0, drop)) cache.delete(k);
  }
  cache.set(key, translated);
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
