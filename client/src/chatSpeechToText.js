/** BCP 47 codes for Web Speech API (free, browser-built-in). */
const SPEECH_LANG = {
  en: "en-IN",
  hi: "hi-IN",
  mr: "mr-IN",
};

export function speechRecognitionLangCode(uiLang) {
  return SPEECH_LANG[uiLang] || SPEECH_LANG.en;
}

export function isSpeechRecognitionSupported() {
  if (typeof window === "undefined") return false;
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * @param {{
 *   getLang: () => string,
 *   onListeningChange?: (listening: boolean) => void,
 *   onError?: (code: string) => void,
 * }} options
 */
export function createChatSpeechInput(options) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;

  /** @type {SpeechRecognition | null} */
  let recognition = null;
  let listening = false;
  let baseText = "";

  function setListening(active) {
    listening = active;
    options.onListeningChange?.(active);
  }

  function stop() {
    setListening(false);
    if (!recognition) return;
    try {
      recognition.onend = null;
      recognition.stop();
    } catch {
      /* ignore */
    }
    recognition = null;
  }

  function appendToInput(text) {
    const input = document.getElementById("team-chat-input");
    if (!input) return;
    const next = text.slice(0, Number(input.maxLength) || 4000);
    input.value = next;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }

  function start() {
    if (listening) return;

    const input = document.getElementById("team-chat-input");
    baseText = input?.value?.trimEnd() || "";
    if (baseText) baseText += " ";

    recognition = new SpeechRecognition();
    recognition.lang = options.getLang();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let finalPart = "";
      let interimPart = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = String(result[0]?.transcript || "");
        if (result.isFinal) finalPart += transcript;
        else interimPart += transcript;
      }
      if (finalPart) {
        baseText += finalPart.replace(/\s+/g, " ").trim();
        if (!baseText.endsWith(" ")) baseText += " ";
      }
      const display = (baseText + interimPart).trimStart();
      appendToInput(display);
    };

    recognition.onerror = (event) => {
      const code = event?.error || "unknown";
      if (code === "aborted") return;
      if (code === "no-speech") return;
      options.onError?.(code);
      stop();
    };

    recognition.onend = () => {
      if (!listening) {
        recognition = null;
        return;
      }
      try {
        recognition?.start();
      } catch {
        stop();
      }
    };

    try {
      recognition.start();
      setListening(true);
    } catch {
      options.onError?.("not-allowed");
      stop();
    }
  }

  return {
    toggle() {
      if (listening) stop();
      else start();
    },
    stop,
    isListening: () => listening,
  };
}
