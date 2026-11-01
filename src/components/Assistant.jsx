import { useCallback, useEffect, useRef, useState } from "react";
import api from "../lib/api.js";
import { CARE_QUICK_PROMPTS, QUICK_REPLIES, assistantReply } from "../lib/assistant";
import Markdown from "../lib/markdown.jsx";
import { toAssistantAnimal, useStore } from "../lib/store";
import { chatKeyFor, clearChatFor, loadChatFrom, purgeLegacyChat, saveChatTo } from "../lib/chatStore.js";
import { listen, recognitionSupported, speak, stopSpeaking, synthesisSupported, VOICE_LANGUAGES } from "../lib/voice.js";

const LS_VOICE = "animalid.voice";
const LS_LANG = "animalid.lang";
const DEFAULT_PHOTO_QUESTION = "Please look at this photo and tell me about this animal.";

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

export default function Assistant() {
  const { pets, currentUser, authReady, navigate, route, toast, fetchNotifications, markNotificationsRead } = useStore();
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  // History loads per identity once auth resolves — never a guessed key.
  const [messages, setMessages] = useState([]);
  const [chips, setChips] = useState(QUICK_REPLIES);
  const [animal, setAnimal] = useState(null);
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

  const messagesRef = useRef(messages);
  const animalRef = useRef(animal);
  const typingRef = useRef(false);
  const voiceRef = useRef(false);
  const langRef = useRef(language);
  const photoRef = useRef(null);
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
    setChips(animalRef.current ? CARE_QUICK_PROMPTS : QUICK_REPLIES);
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
      speak(messages[idx].text, langRef.current);
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
        ? ` I see you're asking about **${forAnimal.name}**${forAnimal.species ? ` (${forAnimal.species})` : ""} — tap a suggestion below or ask me anything about their care, in any language.`
        : " I can search the registry, walk you through lost & found reports, explain registration and photo scanning, answer any animal care question in your language (English, Sinhala, Tamil and more — switch above), or examine a photo you upload — just ask.";
      return { from: "bot", text: `Hi${name}! I'm Ash — your animal specialist assistant.${about}` };
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
      setChips([]);
      setMessages((m) => [...m, shot ? { from: "user", text, image: shot } : { from: "user", text }]);
      setInput("");
      setPhoto(null);
      photoRef.current = null;
      const context = animalOverride !== undefined ? animalOverride : animalRef.current;
      // Carry the recent photo along so follow-ups ("what about its skin?")
      // keep their visual context; the server keeps only the latest one.
      const history = messagesRef.current
        .slice(-10)
        .map((m) => (m.image ? { role: "user", text: m.text, image: m.image } : { role: m.from === "bot" ? "assistant" : "user", text: m.text }));
      const fallbackChips = context ? CARE_QUICK_PROMPTS : QUICK_REPLIES;
      try {
        const { data } = await api.post("/assistant/chat", { message: text, history, animal: context, image: shot, language: langRef.current });
        if (convo !== convoRef.current) return; // cleared or user switched meanwhile
        setMessages((m) => [...m, { from: "bot", text: data.reply, offline: Boolean(data.fallback) }]);
        setChips(data.suggestions?.length ? data.suggestions : fallbackChips);
      } catch (err) {
        if (convo !== convoRef.current) return; // cleared or user switched meanwhile
        const body = err?.response?.data || {};
        if (typeof body.fallback === "string" && body.fallback) {
          // The API call failed server-side: show its helpful fallback message.
          setMessages((m) => [...m, { from: "bot", text: body.fallback, offline: true }]);
          setChips(body.suggestions?.length ? body.suggestions : fallbackChips);
        } else {
          // Backend unreachable: answer from the local registry brain so the chat never dead-ends.
          const res = assistantReply(text, { pets, currentUser });
          const note = shot ? "\n\n(You attached a photo — reconnect and I'll examine it, or identify them on the **Scanner** page.)" : "";
          setMessages((m) => [...m, { from: "bot", text: res.text + note, petIds: res.petIds, offline: true }]);
          setChips(res.replies?.length ? res.replies : context ? CARE_QUICK_PROMPTS : QUICK_REPLIES);
        }
      } finally {
        if (convo === convoRef.current) {
          typingRef.current = false;
          setTyping(false);
        }
      }
    },
    [pets, currentUser],
  );

  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // Open-with-context requests from the Scanner and Pet Profile pages.
  useEffect(() => {
    const onAsk = (e) => {
      const detail = e.detail || {};
      const next = detail.animal || null;
      setAnimal(next);
      animalRef.current = next;
      setOpen(true);
      if (!messagesRef.current.length) {
        greet(next);
        setChips(next ? CARE_QUICK_PROMPTS : QUICK_REPLIES);
      } else if (next) {
        setChips(CARE_QUICK_PROMPTS);
      }
      if (detail.prompt) {
        // Let the panel paint before the auto-sent message lands.
        window.setTimeout(() => sendRef.current(detail.prompt, next), 350);
      }
    };
    window.addEventListener("animalid:ask-ash", onAsk);
    return () => window.removeEventListener("animalid:ask-ash", onAsk);
  }, [greet]);

  // When a pet profile is open, its species/category context attaches automatically.
  useEffect(() => {
    if (route.name !== "pet") return;
    const pet = pets.find((p) => String(p.id) === String(route.param) || p.tagNumber === route.param);
    const next = toAssistantAnimal(pet);
    setAnimal(next);
    animalRef.current = next;
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
    if (!messagesRef.current.length && animalRef.current) setChips(CARE_QUICK_PROMPTS);
  };

  const clearAnimal = () => {
    setAnimal(null);
    animalRef.current = null;
    setChips(QUICK_REPLIES);
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
    setChips(animalRef.current ? CARE_QUICK_PROMPTS : QUICK_REPLIES);
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

  return (
    <>
      {!open && (
        <button
          onClick={openChat}
          className="fixed right-5 bottom-5 z-40 flex cursor-pointer items-center gap-2 rounded-full bg-pine-900 py-3 pr-5 pl-4 text-sm font-bold text-white shadow-xl hover:bg-pine-800"
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
          className="fixed right-4 bottom-4 z-50 flex h-[520px] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl"
          aria-label="AnimalID assistant chat"
        >
          <header className="flex items-center gap-3 bg-pine-950 px-4 py-3 text-white">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-400">
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-pine-950" aria-hidden="true">
                <circle cx="7.2" cy="9.4" r="2.1" />
                <circle cx="12" cy="7.4" r="2.1" />
                <circle cx="16.8" cy="9.4" r="2.1" />
                <path d="M12 11.6c-3.1 0-5.6 2.3-5.6 4.7 0 1.5 1.1 2.5 2.7 2.5 1 0 1.9-.4 2.9-.4s1.9.4 2.9.4c1.6 0 2.7-1 2.7-2.5 0-2.4-2.5-4.7-5.6-4.7z" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">Ash · Animal Assistant</p>
              <p className="flex items-center gap-1.5 text-[11px] text-stone-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Online — replies instantly
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
                className={`cursor-pointer rounded-lg p-2 hover:bg-white/10 ${voiceOn ? "text-amber-400" : "text-stone-300"}`}
                aria-label={voiceOn ? "Turn voice replies off" : "Turn voice replies on"}
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

          {animal && (
            <div className="flex items-center gap-2 border-b border-stone-200 bg-amber-50 px-4 py-2">
              <p className="min-w-0 flex-1 truncate text-xs font-bold text-pine-950">
                Chatting about {animal.name || "this pet"}
                {animal.species ? ` · ${animal.species}` : ""}
                {animal.breed ? ` · ${animal.breed}` : ""}
              </p>
              <button
                onClick={clearAnimal}
                className="shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 text-xs font-bold text-stone-500 hover:bg-stone-200"
                aria-label="Clear animal context"
              >
                ×
              </button>
            </div>
          )}

          <div className="flex-1 space-y-3 overflow-y-auto bg-stone-100 p-4">
            {messages.map((m, i) => (
              <div key={i} className={m.from === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    m.from === "user"
                      ? "rounded-br-md bg-pine-900 whitespace-pre-line text-white"
                      : m.urgent
                        ? "rounded-bl-md border border-ember-300 bg-ember-50 text-stone-800"
                        : "rounded-bl-md border border-stone-200 bg-white text-stone-800"
                  }`}
                >
                  {m.from !== "user" && m.urgent && (
                    <p className="mb-1 text-[10px] font-black tracking-wide text-ember-700 uppercase">
                      Urgent missing-pet update
                    </p>
                  )}
                  {m.image && (
                    <img src={m.image} alt="Uploaded animal" className="mb-1.5 max-h-40 w-full rounded-lg object-cover" />
                  )}
                  {m.from === "user" ? m.text : <Markdown text={m.text} />}
                  {m.offline && m.from === "bot" && (
                    <p className="mt-1.5 text-[10px] font-semibold text-stone-400">Offline reply</p>
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
                            className="cursor-pointer rounded-lg bg-pine-50 px-2.5 py-2 text-left text-xs font-bold text-pine-900 hover:bg-pine-100"
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
                <div className="flex gap-1 rounded-2xl rounded-bl-md border border-stone-200 bg-white px-4 py-3" aria-label="Ash is typing">
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-pine-800" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-pine-800" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-pine-800" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {!!chips.length && !typing && (
            <div className="flex gap-1.5 overflow-x-auto border-t border-stone-200 bg-white px-3 pt-2 pb-1">
              {chips.map((c) => (
                <button
                  key={c}
                  onClick={() => send(c)}
                  className="shrink-0 cursor-pointer rounded-full border border-pine-700/30 bg-pine-50 px-3 py-1.5 text-xs font-bold text-pine-900 hover:bg-pine-100"
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {photo && (
            <div className="flex items-center gap-2 border-t border-stone-200 bg-white px-3 pt-2">
              <img src={photo} alt="Attached pet photo" className="h-12 w-12 rounded-lg object-cover" />
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
            className="flex gap-2 border-t border-stone-200 bg-white p-3"
          >
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="grid w-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-stone-300 bg-white hover:bg-stone-50"
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
                className={`relative grid w-11 shrink-0 cursor-pointer place-items-center rounded-xl border ${
                  listening ? "border-ember-500 bg-ember-50" : "border-stone-300 bg-white hover:bg-stone-50"
                }`}
                aria-label={listening ? "Stop listening" : "Speak your message"}
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
              placeholder={listening ? "Listening… speak now" : animal ? `Ask about ${animal.name || animal.species || "this pet"}…` : "Ask about pets, lost & found…"}
              className="min-w-0 flex-1 rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm focus:border-pine-700 focus:outline-none"
              aria-label="Message Ash"
            />
            <button
              type="submit"
              disabled={!input.trim() && !photo}
              className="cursor-pointer rounded-xl bg-ember-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-ember-600 disabled:opacity-40"
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
