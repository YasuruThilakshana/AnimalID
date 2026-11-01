/** Browser voice helpers for the Ask Ash chat.
 *  Uses the built-in Web Speech APIs — no extra key or service needed.
 *  Speech recognition works in Chromium browsers; synthesis is widely supported.
 */

/** Chat languages shared by the language picker, voice I/O, and the API. */
export const VOICE_LANGUAGES = [
  { code: "auto", label: "Auto", bcp47: null },
  { code: "en", label: "English", bcp47: "en-US" },
  { code: "si", label: "Sinhala", bcp47: "si-LK" },
  { code: "ta", label: "Tamil", bcp47: "ta-LK" },
  { code: "es", label: "Spanish", bcp47: "es-ES" },
  { code: "fr", label: "French", bcp47: "fr-FR" },
  { code: "ar", label: "Arabic", bcp47: "ar-SA" },
  { code: "hi", label: "Hindi", bcp47: "hi-IN" },
];

/** Resolve a chat language code to a BCP-47 tag (auto → browser locale). */
export function bcp47For(code) {
  const found = VOICE_LANGUAGES.find((l) => l.code === code);
  if (found?.bcp47) return found.bcp47;
  if (typeof navigator !== "undefined" && navigator.language) return navigator.language;
  return "en-US";
}

export function recognitionSupported() {
  return typeof window !== "undefined" && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function synthesisSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Strip Markdown so spoken replies sound natural. */
export function stripMarkdown(text) {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)\s]+\)/g, "$1")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(^|\W)\*([^*\n]+)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[☐☑]\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/\n+/g, ". ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

export function stopSpeaking() {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* speech unavailable — chat still works */
  }
}

/** Pick a synthesis voice matching the chat language, when one exists. */
function voiceFor(langCode) {
  try {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    if (!voices.length) return null;
    const want = bcp47For(langCode).toLowerCase();
    const prefix = want.split("-")[0];
    return (
      voices.find((v) => v.lang?.toLowerCase() === want) ||
      voices.find((v) => v.lang?.toLowerCase().startsWith(prefix)) ||
      null
    );
  } catch {
    return null;
  }
}

/** Read a reply aloud in the chat language. Returns false when unavailable. */
export function speak(text, langCode = "auto") {
  if (!synthesisSupported()) return false;
  const clean = stripMarkdown(text);
  if (!clean) return false;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(clean);
    utter.rate = 1;
    const voice = voiceFor(langCode);
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang;
    } else {
      utter.lang = bcp47For(langCode);
    }
    window.speechSynthesis.speak(utter);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start one listening session in the chat language. Returns a stop function.
 * onText(transcript, isFinal) fires for interim + final results.
 */
export function listen({ lang = "auto", onText, onError, onEnd }) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recog = new Ctor();
  recog.lang = bcp47For(lang);
  recog.interimResults = true;
  recog.maxAlternatives = 1;
  recog.onresult = (e) => {
    let interim = "";
    let final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (final) onText?.(final.trim(), true);
    else if (interim) onText?.(interim.trim(), false);
  };
  recog.onerror = (e) => onError?.(e?.error || "mic-error");
  recog.onend = () => onEnd?.();
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      recog.stop();
    } catch {
      /* already stopped */
    }
  };
  try {
    recog.start();
  } catch {
    onError?.("mic-busy");
    onEnd?.();
    return () => {};
  }
  return stop;
}
