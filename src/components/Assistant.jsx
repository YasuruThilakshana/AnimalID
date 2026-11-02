import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../lib/api.js";
import { AI_MODULES, assistantReply } from "../lib/assistant";
import Markdown from "../lib/markdown.jsx";
import { petPhoto, speciesGradient, toAssistantAnimal, useStore } from "../lib/store";
import { chatKeyFor, clearChatFor, loadChatFrom, purgeLegacyChat, saveChatTo } from "../lib/chatStore.js";
import { createPortal } from "react-dom";
import { detectLangCode, listen, recognitionSupported, speak, stopSpeaking, synthesisSupported, VOICE_LANGUAGES } from "../lib/voice.js";

const LS_VOICE = "animalid.voice";
const LS_LANG = "animalid.lang";
const DEFAULT_PHOTO_QUESTION = "Please look at this photo and tell me about this animal.";
const GENERAL_MODULE = "general";
// Frontend safety net so a dead link can never hang the typing indicator:
// the backend answers within ~90s worst case, then we fall back locally.
const CHAT_REQUEST_TIMEOUT_MS = 120000;

/** Downscale an uploaded photo to a small JPEG data URL for the chat API. */
function fileToChatImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("not-image"));
    if (file.size > 8 * 1024 * 1024) return reject(new Error("too-big"));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unreadable"));
    };
    img.src = url;
  });
}

/** Placeholder hint per care module. */
const MODULE_PLACEHOLDERS = {
  nutrition: "Ask about diets, portions, safe foods…",
  health: "Describe symptoms or ask first-aid…",
  behavior: "Ask about training or behavior…",
  planner: "Ask for schedules, routines, reminders…",
  "vet-report": "Ask for a vet-visit summary…",
  budget: "Ask about care costs…",
};

/** Care-log entries (timeline + sightings) sent with chat for vet reports. */
function careLogsFor(pet) {
  if (!pet) return undefined;
  const logs = [];
  for (const e of (pet.timeline || []).slice(-8)) {
    if (e?.text) logs.push({ t: e.t, text: e.text, type: "timeline" });
  }
  for (const s of (pet.sightings || []).slice(-4)) {
    if (s?.place) logs.push({ t: s.t, text: `Sighting at ${s.place}${s.note ? ` — ${s.note}` : ""}`, type: "sighting" });
  }
  return logs.length ? logs : undefined;
}

/** Match an attached assistant context back to a registry pet (for the selector). */
function matchPet(context, list) {
  if (!context?.name) return null;
  const name = String(context.name).toLowerCase();
  const species = String(context.species || "").toLowerCase();
  return (
    list.find(
      (p) =>
        String(p.name || "").toLowerCase() === name &&
        (!species || String(p.species || "").toLowerCase() === species),
    ) || null
  );
}

const STATUS_META = {
  safe: { dot: "bg-emerald-500", label: "Safe", pill: "bg-pine-100 text-pine-900" },
  lost: { dot: "bg-ember-500", label: "Lost", pill: "bg-ember-100 text-ember-700" },
  found: { dot: "bg-amber-500", label: "Found", pill: "bg-brass-100 text-yellow-900" },
};

const MODULE_ICONS = {
  all: (
    <>
      <path d="M12 4l1.7 4.3L18 10l-4.3 1.7L12 16l-1.7-4.3L6 10l4.3-1.7L12 4z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
    </>
  ),
  nutrition: (
    <>
      <path d="M4 13h16c0 3.9-3.6 7-8 7s-8-3.1-8-7z" />
      <path d="M9.5 9.5c-1.2-1.2.8-2.3-.4-3.5M14.5 9.5c-1.2-1.2.8-2.3-.4-3.5" />
    </>
  ),
  health: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </>
  ),
  behavior: (
    <>
      <path d="M4 6.5h16v9H9.5L4 19.5v-13z" />
      <path d="M8 10.5h8M8 13h5" />
    </>
  ),
  planner: (
    <>
      <rect x="4.5" y="5.5" width="15" height="14" rx="2.5" />
      <path d="M4.5 10h15M9 3.5v3.5M15 3.5v3.5" />
    </>
  ),
  "vet-report": (
    <>
      <rect x="6" y="5" width="12" height="15.5" rx="2" />
      <path d="M9.5 5V3.5h5V5M9.5 11h5M9.5 14h5" />
    </>
  ),
  budget: (
    <>
      <ellipse cx="12" cy="7" rx="6.5" ry="2.5" />
      <path d="M5.5 7v10c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V7" />
      <path d="M5.5 12c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5" />
    </>
  ),
};

function ModuleIcon({ id, className = "h-3.5 w-3.5" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {MODULE_ICONS[id] || MODULE_ICONS.all}
    </svg>
  );
}

/** Round pet thumbnail: uploaded photo, else a species-gradient initial. */
function PetAvatarMini({ pet, className = "h-7 w-7" }) {
  const photo = petPhoto(pet);
  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        className={`${className} shrink-0 rounded-full object-cover ring-1 ring-black/10`}
      />
    );
  }
  const [c1, c2] = speciesGradient(pet?.species);
  return (
    <span
      className={`${className} grid shrink-0 place-items-center rounded-full text-[11px] font-black text-white ring-1 ring-black/10`}
      style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
      aria-hidden="true"
    >
      {(pet?.name || "?").charAt(0).toUpperCase()}
    </span>
  );
}

/** Header badge showing which engine answered last: Live, Local, or nothing yet. */
function ModeBadge({ mode }) {
  if (mode === "live") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-black tracking-wide text-emerald-300 uppercase">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden="true" />
        Live
      </span>
    );
  }
  if (mode === "local") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-black tracking-wide text-amber-300 uppercase">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />
        Local
      </span>
    );
  }
  return null;
}

export default function Assistant() {
  const { pets, currentUser, authReady, navigate, route, toast, fetchNotifications, markNotificationsRead } = useStore();
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  // History loads per identity once auth resolves — never a guessed key.
  const [messages, setMessages] = useState([]);
  const [lastContext, setLastContext] = useState(null); // "pet" | "general" per last reply
  const [animal, setAnimal] = useState(null);
  const [module, setModule] = useState(GENERAL_MODULE);
  // petId: "" = general advice, a registry id = selected pet, "context" = an
  // attached animal from the scanner/pet page that isn't in the dropdown.
  const [petId, setPetId] = useState("");
  const [petMenuOpen, setPetMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 });
  const [mode, setMode] = useState(null); // last assistant engine: "live" | "local" | null
  const [voiceOn, setVoiceOn] = useState(() => {
    try {
      return localStorage.getItem(LS_VOICE) === "1" && synthesisSupported();
    } catch {
      return false;
    }
  });
  const [listening, setListening] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [language, setLanguage] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_LANG);
      return VOICE_LANGUAGES.some((l) => l.code === saved) ? saved : "auto";
    } catch {
      return "auto";
    }
  });
  const bottomRef = useRef(null);
  const fileRef = useRef(null);
  const petBtnRef = useRef(null);

  const myPets = useMemo(
    () => (currentUser ? pets.filter((p) => p.ownerEmail === currentUser.email) : []),
    [pets, currentUser],
  );
  const fullPet = useMemo(
    () => pets.find((p) => String(p.id) === String(petId)) || null,
    [pets, petId],
  );

  const messagesRef = useRef(messages);
  const animalRef = useRef(animal);
  const moduleRef = useRef(module);
  const typingRef = useRef(false);
  const voiceRef = useRef(false);
  const langRef = useRef(language);
  const photoRef = useRef(null);
  const petsRef = useRef(pets);
  const userRef = useRef(currentUser);
  const fullPetRef = useRef(fullPet);
  const stopListenRef = useRef(null);
  const spokenRef = useRef(-1);
  const chatKeyRef = useRef(null);
  const convoRef = useRef(0);
  const injectedNotifsRef = useRef(new Set());
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    animalRef.current = animal;
  }, [animal]);
  useEffect(() => {
    moduleRef.current = module;
  }, [module]);
  useEffect(() => {
    petsRef.current = pets;
  }, [pets]);
  useEffect(() => {
    userRef.current = currentUser;
  }, [currentUser]);
  useEffect(() => {
    fullPetRef.current = fullPet;
  }, [fullPet]);

  useEffect(() => {
    photoRef.current = photo;
  }, [photo]);

  useEffect(() => {
    langRef.current = language;
    try {
      localStorage.setItem(LS_LANG, language);
    } catch {
      /* language preference simply won't persist */
    }
  }, [language]);

  // One-time reset: drop the pre-isolation shared log; per-user keys replace it.
  useEffect(() => {
    purgeLegacyChat(localStorage);
  }, []);

  // Per-user isolation: whenever the session identity resolves or changes,
  // swap to that identity's own history — never another user's.
  useEffect(() => {
    if (!authReady) return;
    const key = chatKeyFor(currentUser);
    if (chatKeyRef.current === key) return;
    const isFirstLoad = chatKeyRef.current === null;
    convoRef.current += 1; // discard any in-flight reply for the old identity
    typingRef.current = false;
    setTyping(false);
    stopListenRef.current?.();
    setListening(false);
    stopSpeaking();
    setPhoto(null);
    photoRef.current = null;
    setInput("");
    chatKeyRef.current = key;
    const stored = loadChatFrom(localStorage, key);
    // First load with unsent pre-auth messages: adopt them into this identity.
    const adopted = isFirstLoad && !stored && messagesRef.current.length ? messagesRef.current : null;
    if (adopted) saveChatTo(localStorage, key, adopted);
    const next = adopted || stored || [];
    messagesRef.current = next;
    spokenRef.current = next.length - 1;
    setMessages(next);
  }, [authReady, currentUser]);

  useEffect(() => {
    const key = chatKeyRef.current;
    if (!key) return; // nothing loaded yet — never write to a guessed key
    saveChatTo(localStorage, key, messages);
  }, [messages]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, typing, open]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_VOICE, voiceOn ? "1" : "0");
    } catch {
      /* voice preference simply won't persist */
    }
    voiceRef.current = voiceOn;
    if (!voiceOn) stopSpeaking();
  }, [voiceOn]);

  // Read new bot replies aloud when voice mode is on.
  useEffect(() => {
    if (!voiceOn || !open) return;
    const idx = messages.length - 1;
    if (idx > spokenRef.current && messages[idx]?.from === "bot") {
      spokenRef.current = idx;
      // In Auto mode the reply's own script picks the voice (a Sinhala reply
      // gets a Sinhala voice); an explicit picker choice always wins.
      const detected = langRef.current === "auto" ? detectLangCode(messages[idx].text) : null;
      speak(messages[idx].text, detected || langRef.current);
    }
  }, [messages, voiceOn, open]);

  useEffect(
    () => () => {
      stopSpeaking();
      stopListenRef.current?.();
    },
    [],
  );

  const buildGreeting = useCallback(
    (forAnimal) => {
      const name = currentUser ? `, ${currentUser.name.split(" ")[0]}` : "";
      const about = forAnimal?.name
        ? ` I'll personalize every answer for **${forAnimal.name}**${forAnimal.species ? ` (${forAnimal.species}${forAnimal.breed ? ` · ${forAnimal.breed}` : ""})` : ""} using their full profile — switch pets or care modules above anytime, or ask in any language.`
        : " Select one of your pets above for personalized advice, pick a care module (nutrition, health, training, schedules, vet reports, budgets), or just ask — I cover dogs, cats, birds, reptiles, fish, farm, and exotic pets, in any language.";
      return { from: "bot", text: `Hi${name}! I'm Ash — your Universal AI Pet Care Assistant, powered by Meta AI.${about}` };
    },
    [currentUser],
  );

  const greet = useCallback(
    (forAnimal) => {
      if (messagesRef.current.length) return;
      setMessages([buildGreeting(forAnimal)]);
    },
    [buildGreeting],
  );

  const send = useCallback(
    async (raw, animalOverride) => {
      const shot = photoRef.current;
      const text = raw.trim() || (shot ? DEFAULT_PHOTO_QUESTION : "");
      if (!text || typingRef.current) return;
      const convo = convoRef.current;
      typingRef.current = true;
      setTyping(true);
      setMessages((m) => [...m, shot ? { from: "user", text, image: shot } : { from: "user", text }]);
      setInput("");
      setPhoto(null);
      photoRef.current = null;
      const context = animalOverride !== undefined ? animalOverride : animalRef.current;
      const activeModule = moduleRef.current;
      // Carry the recent photo along so follow-ups ("what about its skin?")
      // keep their visual context; the server keeps only the latest one.
      const history = messagesRef.current
        .slice(-10)
        .map((m) => (m.image ? { role: "user", text: m.text, image: m.image } : { role: m.from === "bot" ? "assistant" : "user", text: m.text }));
      try {
        const { data } = await api.post(
          "/assistant/chat",
          {
            message: text,
            history,
            animal: context,
            // General mode lets the server detect the module from the message.
            module: activeModule === GENERAL_MODULE ? undefined : activeModule,
            careLogs: careLogsFor(fullPetRef.current),
            image: shot,
            language: langRef.current,
          },
          { timeout: CHAT_REQUEST_TIMEOUT_MS },
        );
        if (convo !== convoRef.current) return; // cleared or user switched meanwhile
        setMessages((m) => [...m, { from: "bot", text: data.reply, offline: Boolean(data.fallback) }]);
        setMode(data.fallback ? "local" : "live");
        setLastContext(data.context === "pet" || data.context === "general" ? data.context : null);
      } catch (err) {
        if (convo !== convoRef.current) return; // cleared or user switched meanwhile
        const body = err?.response?.data || {};
        if (typeof body.fallback === "string" && body.fallback) {
          // The API call failed server-side: show its helpful fallback message.
          setMessages((m) => [...m, { from: "bot", text: body.fallback, offline: true }]);
          setMode("local");
          setLastContext(body.context === "pet" || body.context === "general" ? body.context : null);
        } else {
          // Backend unreachable: answer from the local module-aware brain so the chat never dead-ends.
          const res = assistantReply(text, {
            pets: petsRef.current,
            currentUser: userRef.current,
            activePet: fullPetRef.current || context,
            module: activeModule,
          });
          const note = shot ? "\n\n(You attached a photo — reconnect and I'll examine it, or identify them on the **Scanner** page.)" : "";
          setMessages((m) => [...m, { from: "bot", text: res.text + note, petIds: res.petIds, offline: true }]);
          setMode("local");
          setLastContext(null);
        }
      } finally {
        if (convo === convoRef.current) {
          typingRef.current = false;
          setTyping(false);
        }
      }
    },
    [],
  );

  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // Escape or a viewport resize closes the pet dropdown (outside clicks are
  // caught by its overlay). The menu lives in a document.body portal, so it
  // can never clip into the panel's message list.
  useEffect(() => {
    if (!petMenuOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setPetMenuOpen(false);
    };
    const onResize = () => setPetMenuOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [petMenuOpen]);

  const togglePetMenu = useCallback(() => {
    if (!petMenuOpen && petBtnRef.current) {
      const r = petBtnRef.current.getBoundingClientRect();
      const width = Math.min(r.width, window.innerWidth - 16);
      setMenuPos({
        top: r.bottom + 4,
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        width,
      });
    }
    setPetMenuOpen(!petMenuOpen);
  }, [petMenuOpen]);

  const selectModule = useCallback((id) => {
    setModule(id);
    moduleRef.current = id;
  }, []);

  const clearAnimal = useCallback(() => {
    setAnimal(null);
    animalRef.current = null;
    setPetId("");
    setLastContext(null);
  }, []);

  const selectPet = useCallback(
    (value) => {
      setPetMenuOpen(false);
      if (!value) {
        clearAnimal();
        return;
      }
      if (value === "context") return; // attached context stays as-is
      const pet = petsRef.current.find((p) => String(p.id) === String(value));
      if (!pet) return;
      const next = toAssistantAnimal(pet);
      setAnimal(next);
      animalRef.current = next;
      setPetId(String(pet.id));
    },
    [clearAnimal],
  );

  // Open-with-context requests from the Scanner and Pet Profile pages.
  useEffect(() => {
    const onAsk = (e) => {
      const detail = e.detail || {};
      const next = detail.animal || null;
      setAnimal(next);
      animalRef.current = next;
      const matched = matchPet(next, petsRef.current);
      setPetId(next ? (matched ? String(matched.id) : "context") : "");
      setOpen(true);
      if (!messagesRef.current.length) {
        greet(next);
      }
      if (detail.prompt) {
        // Let the panel paint before the auto-sent message lands.
        window.setTimeout(() => sendRef.current(detail.prompt, next), 350);
      }
    };
    window.addEventListener("animalid:ask-ash", onAsk);
    return () => window.removeEventListener("animalid:ask-ash", onAsk);
  }, [greet]);

  // When a pet profile is open, its full context attaches automatically.
  useEffect(() => {
    if (route.name !== "pet") return;
    const pet = pets.find((p) => String(p.id) === String(route.param) || p.tagNumber === route.param);
    const next = toAssistantAnimal(pet);
    setAnimal(next);
    animalRef.current = next;
    setPetId(pet ? String(pet.id) : "");
  }, [route.name, route.param, pets]);

  // Urgent owner notifications (e.g. a 100% found-scan match) surface as Ash
  // system messages the moment the owner opens the chat. Showing them here
  // marks them read, same as opening the notification bell.
  useEffect(() => {
    if (!open || !currentUser) return;
    let cancelled = false;
    (async () => {
      const list = await fetchNotifications();
      if (cancelled || !Array.isArray(list)) return;
      const have = new Set(messagesRef.current.map((m) => m.notificationId).filter(Boolean));
      const fresh = list.filter(
        (n) => n && !n.read && n.type === "found_scan" && !injectedNotifsRef.current.has(n.id) && !have.has(n.id),
      );
      if (!fresh.length) return;
      fresh.forEach((n) => injectedNotifsRef.current.add(n.id));
      setMessages((m) => [
        ...m,
        ...fresh.map((n) => ({
          from: "bot",
          text: n.message,
          urgent: true,
          petIds: n.petId ? [n.petId] : [],
          notificationId: n.id,
        })),
      ]);
      markNotificationsRead();
    })();
    return () => {
      cancelled = true;
    };
  }, [open, currentUser, fetchNotifications, markNotificationsRead]);

  const openChat = () => {
    setOpen(true);
    greet(animalRef.current);
  };

  // "New chat": wipe only this identity's history and restart the welcome state.
  const clearChat = () => {
    convoRef.current += 1; // discard any in-flight reply
    typingRef.current = false;
    setTyping(false);
    stopListenRef.current?.();
    setListening(false);
    stopSpeaking();
    setPhoto(null);
    photoRef.current = null;
    setInput("");
    const key = chatKeyFor(currentUser);
    chatKeyRef.current = key;
    clearChatFor(localStorage, key);
    const greeting = buildGreeting(animalRef.current);
    messagesRef.current = [greeting];
    spokenRef.current = -1;
    setMessages([greeting]);
    setMode(null);
    setLastContext(null);
  };

  const closeChat = () => {
    stopListenRef.current?.();
    setListening(false);
    stopSpeaking();
    setOpen(false);
  };

  const toggleListen = () => {
    if (listening) {
      stopListenRef.current?.();
      return;
    }
    if (!recognitionSupported()) return;
    stopSpeaking();
    setListening(true);
    stopListenRef.current = listen({
      lang: langRef.current,
      onText: (transcript, isFinal) => {
        setInput(transcript);
        // In voice mode the conversation stays hands-free: send final transcripts.
        if (isFinal && voiceRef.current && transcript) sendRef.current(transcript);
      },
      onError: () => setListening(false),
      onEnd: () => setListening(false),
    });
  };

  const onPickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setPhoto(await fileToChatImage(file));
    } catch {
      toast("Please choose an image file under 8 MB.", "warn");
    }
  };

  const openPet = (id) => {
    closeChat();
    navigate("pet", id);
  };

  const placeholder =
    MODULE_PLACEHOLDERS[module] ||
    (animal ? `Ask about ${animal.name || animal.species || "this pet"}…` : "Ask about any pet…");

  return (
    <>
      {!open && (
        <button
          onClick={openChat}
          className="fixed right-5 bottom-5 z-40 flex cursor-pointer items-center gap-2 rounded-full bg-pine-900/95 py-3 pr-5 pl-4 text-sm font-bold text-white shadow-xl ring-1 ring-white/25 backdrop-blur-md transition-colors hover:bg-pine-800 focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none"
          aria-label="Open AnimalID assistant chat"
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-amber-400">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-pine-950" aria-hidden="true">
              <circle cx="7.2" cy="9.4" r="2.1" />
              <circle cx="12" cy="7.4" r="2.1" />
              <circle cx="16.8" cy="9.4" r="2.1" />
              <path d="M12 11.6c-3.1 0-5.6 2.3-5.6 4.7 0 1.5 1.1 2.5 2.7 2.5 1 0 1.9-.4 2.9-.4s1.9.4 2.9.4c1.6 0 2.7-1 2.7-2.5 0-2.4-2.5-4.7-5.6-4.7z" />
            </svg>
          </span>
          Ask Ash
        </button>
      )}

      {open && (
        <section
          className="fixed right-4 bottom-4 z-50 flex h-[min(600px,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-md flex-col overflow-hidden rounded-2xl border border-white/50 bg-white/85 shadow-2xl backdrop-blur-xl"
          aria-label="AnimalID assistant chat"
        >
          <header className="flex items-center gap-3 border-b border-white/10 bg-pine-950/90 px-4 py-3 text-white backdrop-blur-md">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-400">
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-pine-950" aria-hidden="true">
                <circle cx="7.2" cy="9.4" r="2.1" />
                <circle cx="12" cy="7.4" r="2.1" />
                <circle cx="16.8" cy="9.4" r="2.1" />
                <path d="M12 11.6c-3.1 0-5.6 2.3-5.6 4.7 0 1.5 1.1 2.5 2.7 2.5 1 0 1.9-.4 2.9-.4s1.9.4 2.9.4c1.6 0 2.7-1 2.7-2.5 0-2.4-2.5-4.7-5.6-4.7z" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">Ask Ash</p>
              <p className="flex items-center gap-1.5 text-[11px] text-stone-300">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden="true" />
                <span className="shrink-0">Meta AI</span>
                <ModeBadge mode={mode} />
              </p>
            </div>
            <button
              onClick={clearChat}
              className="shrink-0 cursor-pointer rounded-lg bg-white/10 px-2 py-1.5 text-xs font-bold whitespace-nowrap text-white hover:bg-white/20"
              aria-label="Start a new chat (clears your history)"
              title="Clear your chat history and start over"
            >
              + New chat
            </button>
            <select
              value={language}
              onChange={(e) => {
                stopSpeaking();
                setLanguage(e.target.value);
              }}
              className="max-w-24 cursor-pointer rounded-lg bg-white/10 px-1.5 py-1.5 text-xs font-bold text-white hover:bg-white/20 focus:outline-none"
              aria-label="Reply language"
              title="Ash replies, listens, and reads aloud in this language (Auto follows what you type)"
            >
              {VOICE_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code} className="text-stone-900">
                  {l.code === "auto" ? "🌐 Auto" : l.label}
                </option>
              ))}
            </select>
            {synthesisSupported() && (
              <button
                onClick={() => setVoiceOn((v) => !v)}
                className={`cursor-pointer rounded-lg p-2 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none ${voiceOn ? "text-amber-400" : "text-stone-300"}`}
                aria-label={voiceOn ? "Turn voice replies off" : "Turn voice replies on"}
                aria-pressed={voiceOn}
                title={voiceOn ? "Voice replies on — Ash reads answers aloud" : "Voice replies off"}
              >
                {voiceOn ? (
                  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.59 3 2.7-2.7-1.41-1.41-2.7 2.7-2.7-2.7-1.41 1.41 2.7 2.7-2.7 2.7 1.41 1.41 2.7-2.7 2.7 2.7 1.41-1.41-2.7-2.7z" />
                  </svg>
                )}
              </button>
            )}
            <button
              onClick={closeChat}
              className="cursor-pointer rounded-lg px-2 py-1 text-xl leading-none text-stone-300 hover:bg-white/10"
              aria-label="Close chat"
            >
              ×
            </button>
          </header>

          <div className="border-b border-white/40 bg-white/70 px-3 pt-2 pb-2 backdrop-blur-md">
            <div className="relative flex items-stretch gap-1.5">
              <button
                type="button"
                ref={petBtnRef}
                onClick={togglePetMenu}
                aria-haspopup="listbox"
                aria-expanded={petMenuOpen}
                aria-label="Select a pet for personalized advice"
                title="Switch pets — the full profile is sent with every message"
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl border border-stone-300/80 bg-white/90 px-2.5 py-1.5 text-left shadow-sm transition-colors hover:border-pine-700/50 focus-visible:ring-2 focus-visible:ring-pine-700 focus-visible:outline-none"
              >
                {fullPet ? (
                  <PetAvatarMini pet={fullPet} />
                ) : (
                  <span
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-pine-900 text-amber-400 ring-1 ring-black/10"
                    aria-hidden="true"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                      <circle cx="7.2" cy="9.4" r="2.1" />
                      <circle cx="12" cy="7.4" r="2.1" />
                      <circle cx="16.8" cy="9.4" r="2.1" />
                      <path d="M12 11.6c-3.1 0-5.6 2.3-5.6 4.7 0 1.5 1.1 2.5 2.7 2.5 1 0 1.9-.4 2.9-.4s1.9.4 2.9.4c1.6 0 2.7-1 2.7-2.5 0-2.4-2.5-4.7-5.6-4.7z" />
                    </svg>
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold text-pine-950">
                    {fullPet
                      ? fullPet.name
                      : petId === "context" && animal
                        ? `Context: ${animal.name || animal.species || "this pet"}`
                        : "General advice"}
                  </span>
                  <span className="block truncate text-[10px] font-semibold text-stone-500">
                    {fullPet ? `${fullPet.species}${fullPet.breed ? ` · ${fullPet.breed}` : ""}` : "No pet selected"}
                  </span>
                </span>
                {fullPet && (
                  <span
                    className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black tracking-wide uppercase ${(STATUS_META[fullPet.status] || STATUS_META.safe).pill}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${(STATUS_META[fullPet.status] || STATUS_META.safe).dot}`}
                      aria-hidden="true"
                    />
                    {(STATUS_META[fullPet.status] || STATUS_META.safe).label}
                  </span>
                )}
                <svg
                  viewBox="0 0 24 24"
                  className={`h-4 w-4 shrink-0 fill-stone-400 transition-transform duration-150 ${petMenuOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                >
                  <path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z" />
                </svg>
              </button>
              {animal && (
                <button
                  onClick={clearAnimal}
                  className="shrink-0 cursor-pointer rounded-xl border border-stone-300/80 bg-white/90 px-3 text-lg font-bold text-stone-500 shadow-sm transition-colors hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-pine-700 focus-visible:outline-none"
                  aria-label="Clear pet context"
                  title="Clear the selected pet"
                >
                  ×
                </button>
              )}
              {petMenuOpen &&
                createPortal(
                  <>
                    <button
                      type="button"
                      aria-hidden="true"
                      tabIndex={-1}
                      onClick={() => setPetMenuOpen(false)}
                      className="fixed inset-0 z-[60] cursor-default"
                    />
                    <ul
                      role="listbox"
                      aria-label="Your pets"
                      style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
                      className="fixed z-[70] max-h-60 overflow-y-auto rounded-xl border border-stone-200 bg-white py-1 shadow-2xl"
                    >
                    <li role="option" aria-selected={petId === ""}>
                      <button
                        type="button"
                        onClick={() => selectPet("")}
                        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-pine-50 focus-visible:bg-pine-50 focus-visible:outline-none"
                      >
                        <span
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-pine-900 text-amber-400"
                          aria-hidden="true"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                            <circle cx="7.2" cy="9.4" r="2.1" />
                            <circle cx="12" cy="7.4" r="2.1" />
                            <circle cx="16.8" cy="9.4" r="2.1" />
                            <path d="M12 11.6c-3.1 0-5.6 2.3-5.6 4.7 0 1.5 1.1 2.5 2.7 2.5 1 0 1.9-.4 2.9-.4s1.9.4 2.9.4c1.6 0 2.7-1 2.7-2.5 0-2.4-2.5-4.7-5.6-4.7z" />
                          </svg>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-bold text-pine-950">General advice</span>
                          <span className="block truncate text-[10px] font-semibold text-stone-500">No pet selected</span>
                        </span>
                        {petId === "" && (
                          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-pine-700" aria-hidden="true">
                            <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
                          </svg>
                        )}
                      </button>
                    </li>
                    {myPets.length === 0 && (
                      <li className="px-3 py-1.5 text-[11px] font-semibold text-stone-400" aria-hidden="true">
                        {currentUser
                          ? "No registered pets yet — register one to personalize answers."
                          : "Sign in to see your pets here."}
                      </li>
                    )}
                    {myPets.map((p) => {
                      const selected = String(p.id) === String(petId);
                      const meta = STATUS_META[p.status] || STATUS_META.safe;
                      return (
                        <li key={p.id} role="option" aria-selected={selected}>
                          <button
                            type="button"
                            onClick={() => selectPet(String(p.id))}
                            className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors focus-visible:outline-none ${
                              selected ? "bg-pine-50" : "hover:bg-pine-50 focus-visible:bg-pine-50"
                            }`}
                          >
                            <PetAvatarMini pet={p} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-bold text-pine-950">{p.name}</span>
                              <span className="block truncate text-[10px] font-semibold text-stone-500">
                                {p.species}
                                {p.breed ? ` · ${p.breed}` : ""}
                              </span>
                            </span>
                            <span
                              className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black tracking-wide uppercase ${meta.pill}`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
                              {meta.label}
                            </span>
                            {selected && (
                              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-pine-700" aria-hidden="true">
                                <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
                              </svg>
                            )}
                          </button>
                        </li>
                      );
                    })}
                    {fullPet && !myPets.some((p) => String(p.id) === String(fullPet.id)) && (
                      <li role="option" aria-selected="true">
                        <button
                          type="button"
                          onClick={() => setPetMenuOpen(false)}
                          className="flex w-full cursor-pointer items-center gap-2 bg-pine-50 px-3 py-2 text-left focus-visible:outline-none"
                        >
                          <PetAvatarMini pet={fullPet} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-bold text-pine-950">{fullPet.name}</span>
                            <span className="block truncate text-[10px] font-semibold text-stone-500">
                              Attached from the open profile
                            </span>
                          </span>
                          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-pine-700" aria-hidden="true">
                            <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
                          </svg>
                        </button>
                      </li>
                    )}
                    {petId === "context" && animal && !fullPet && (
                      <li role="option" aria-selected="true">
                        <button
                          type="button"
                          onClick={() => setPetMenuOpen(false)}
                          className="flex w-full cursor-pointer items-center gap-2 bg-pine-50 px-3 py-2 text-left focus-visible:outline-none"
                        >
                          <span
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ember-500 text-white"
                            aria-hidden="true"
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                              <circle cx="7.2" cy="9.4" r="2.1" />
                              <circle cx="12" cy="7.4" r="2.1" />
                              <circle cx="16.8" cy="9.4" r="2.1" />
                              <path d="M12 11.6c-3.1 0-5.6 2.3-5.6 4.7 0 1.5 1.1 2.5 2.7 2.5 1 0 1.9-.4 2.9-.4s1.9.4 2.9.4c1.6 0 2.7-1 2.7-2.5 0-2.4-2.5-4.7-5.6-4.7z" />
                            </svg>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-bold text-pine-950">
                              Context: {animal.name || animal.species || "this pet"}
                            </span>
                            <span className="block truncate text-[10px] font-semibold text-stone-500">
                              Attached from scanner / profile
                            </span>
                          </span>
                          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-pine-700" aria-hidden="true">
                            <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
                          </svg>
                        </button>
                      </li>
                    )}
                    </ul>
                  </>,
                  document.body,
                )}
            </div>
            <div className="scroll-slim mt-1.5 flex gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label="Care modules">
              {[{ id: GENERAL_MODULE, label: "All" }, ...AI_MODULES].map((m) => {
                const active = module === m.id;
                return (
                  <button
                    key={m.id}
                    role="tab"
                    aria-selected={active}
                    onClick={() => selectModule(m.id)}
                    title={m.blurb || "All care modules"}
                    className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold whitespace-nowrap transition-all duration-150 focus-visible:ring-2 focus-visible:ring-pine-700 focus-visible:outline-none ${
                      active
                        ? "bg-pine-900 text-white shadow-md"
                        : "border border-stone-200 bg-white/80 text-stone-600 hover:border-pine-700/40 hover:text-pine-900"
                    }`}
                  >
                    <ModuleIcon id={m.id === GENERAL_MODULE ? "all" : m.id} />
                    {m.label}
                    {active && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>

          {lastContext === "general" && animal && (
            <div className="flex items-center gap-2 border-b border-white/40 bg-amber-50/90 px-3 py-1.5 backdrop-blur-md">
              <p className="min-w-0 flex-1 truncate text-[11px] font-bold text-amber-900">
                General mode — not specific to {animal.name || "your pet"}.
              </p>
              <button
                type="button"
                onClick={() => setLastContext(null)}
                className="shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 text-xs font-bold text-amber-700 transition-colors hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none"
                aria-label="Dismiss general-mode notice"
              >
                ×
              </button>
            </div>
          )}

          <div className="flex-1 min-h-0 space-y-3 overflow-y-auto bg-stone-100/90 p-4">
            {messages.map((m, i) => (
              <div key={i} className={`msg-in ${m.from === "user" ? "flex justify-end" : "flex justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    m.from === "user"
                      ? "rounded-br-md bg-pine-900 whitespace-pre-line text-white shadow-md"
                      : m.urgent
                        ? "rounded-bl-md border border-ember-300 bg-ember-50 text-stone-800 shadow-sm"
                        : "rounded-bl-md border border-stone-200/70 bg-white/95 text-stone-800 shadow-sm backdrop-blur-sm"
                  }`}
                >
                  {m.from !== "user" && m.urgent && (
                    <p className="mb-1 text-[10px] font-black tracking-wide text-ember-700 uppercase">
                      Urgent missing-pet update
                    </p>
                  )}
                  {m.image && (
                    <img
                      src={m.image}
                      alt="Uploaded animal"
                      className="mb-1.5 max-h-56 w-full rounded-xl object-cover ring-1 ring-black/10"
                    />
                  )}
                  {m.from === "user" ? m.text : <Markdown text={m.text} />}
                  {m.offline && m.from === "bot" && (
                    <p className="mt-1.5">
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100/90 px-2 py-0.5 text-[10px] font-black tracking-wide text-amber-800 uppercase">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                        Local fallback
                      </span>
                    </p>
                  )}
                  {!!m.petIds?.length && (
                    <span className="mt-2 flex flex-col gap-1.5">
                      {m.petIds
                        .map((id) => pets.find((p) => p.id === id))
                        .filter(Boolean)
                        .map((p) => (
                          <button
                            key={p.id}
                            onClick={() => openPet(p.id)}
                            className="cursor-pointer rounded-lg bg-pine-50 px-2.5 py-2 text-left text-xs font-bold text-pine-900 transition-colors hover:bg-pine-100 focus-visible:ring-2 focus-visible:ring-pine-700 focus-visible:outline-none"
                          >
                            {p.name} · {p.breed} · {p.location} →
                          </button>
                        ))}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {typing && (
              <div className="flex justify-start">
                <div className="flex gap-1 rounded-2xl rounded-bl-md border border-stone-200/70 bg-white/90 px-4 py-3 shadow-sm backdrop-blur-sm" aria-label="Ash is typing">
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-pine-800" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-pine-800" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-pine-800" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {photo && (
            <div className="flex items-center gap-2 border-t border-stone-200 bg-white px-3 pt-2">
              <img src={photo} alt="Attached pet photo" className="h-16 w-16 rounded-xl object-cover ring-1 ring-black/10" />
              <p className="min-w-0 flex-1 text-xs font-semibold text-stone-500">
                Photo attached — ask anything about it
              </p>
              <button
                type="button"
                onClick={() => setPhoto(null)}
                className="shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 text-xs font-bold text-stone-500 hover:bg-stone-200"
                aria-label="Remove attached photo"
              >
                ×
              </button>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 border-t border-white/40 bg-white/70 p-3 backdrop-blur-md"
          >
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-stone-300/80 bg-white/90 shadow-sm transition-colors hover:bg-stone-50 focus-visible:ring-2 focus-visible:ring-pine-700 focus-visible:outline-none"
              aria-label="Attach a photo"
              title="Attach a photo — then ask anything about it"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-pine-900" aria-hidden="true">
                <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
              </svg>
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickPhoto} aria-hidden="true" tabIndex={-1} />
            {recognitionSupported() && (
              <button
                type="button"
                onClick={toggleListen}
                className={`relative grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl border shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-pine-700 focus-visible:outline-none ${
                  listening ? "border-ember-500 bg-ember-50" : "border-stone-300/80 bg-white/90 hover:bg-stone-50"
                }`}
                aria-label={listening ? "Stop listening" : "Speak your message"}
                aria-pressed={listening}
                title={listening ? "Listening… tap to stop" : "Voice input"}
              >
                <svg viewBox="0 0 24 24" className={`h-5 w-5 ${listening ? "fill-ember-600" : "fill-pine-900"}`} aria-hidden="true">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.34 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.44 5.42-2.78 5.91-5.78.09-.6-.39-1.14-1-1.14z" />
                </svg>
                {listening && (
                  <span className="absolute top-1.5 right-1.5 h-2 w-2 animate-pulse rounded-full bg-ember-500" aria-hidden="true" />
                )}
              </button>
            )}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={placeholder}
              className="h-11 min-w-0 flex-1 rounded-xl border border-stone-300/80 bg-white/90 px-3.5 text-sm shadow-sm transition-colors placeholder:text-stone-400 focus:border-pine-700 focus:outline-none"
              aria-label="Message Ash"
            />
            <button
              type="submit"
              disabled={!input.trim() && !photo}
              className="h-11 shrink-0 cursor-pointer rounded-xl bg-ember-500 px-4 text-sm font-bold text-white shadow-md transition-colors hover:bg-ember-600 focus-visible:ring-2 focus-visible:ring-ember-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-40"
              aria-label="Send message"
            >
              ↑
            </button>
          </form>
        </section>
      )}
    </>
  );
}
