import { useEffect, useRef, useState } from "react";
import { QUICK_REPLIES, assistantReply } from "../lib/assistant";
import { useStore } from "../lib/store";

const LS_CHAT = "animalid.chat";

function loadChat() {
  try {
    return JSON.parse(localStorage.getItem(LS_CHAT) || "null");
  } catch {
    return null;
  }
}

export default function Assistant() {
  const { pets, currentUser, navigate } = useStore();
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState(() => loadChat() || []);
  const [chips, setChips] = useState(QUICK_REPLIES);
  const bottomRef = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(LS_CHAT, JSON.stringify(messages.slice(-40)));
    } catch {
      /* chat history simply won't persist */
    }
  }, [messages]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, typing, open]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const greet = () => {
    if (messages.length) return;
    setTyping(true);
    timer.current = setTimeout(() => {
      setTyping(false);
      setMessages([
        {
          from: "bot",
          text: `Hi${currentUser ? `, ${currentUser.name.split(" ")[0]}` : ""}! I'm Ash — I can search the registry, walk you through lost & found reports, or explain registration and photo scanning.`,
        },
      ]);
    }, 500);
  };

  const send = (raw) => {
    const text = raw.trim();
    if (!text || typing) return;
    setMessages((m) => [...m, { from: "user", text }]);
    setInput("");
    setChips([]);
    setTyping(true);
    timer.current = setTimeout(() => {
      const res = assistantReply(text, { pets, currentUser });
      setTyping(false);
      setMessages((m) => [...m, { from: "bot", text: res.text, petIds: res.petIds }]);
      setChips(res.replies || []);
    }, 650);
  };

  const openPet = (id) => {
    setOpen(false);
    navigate("pet", id);
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => {
            setOpen(true);
            greet();
          }}
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
            <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-400">
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-pine-950" aria-hidden="true">
                <circle cx="7.2" cy="9.4" r="2.1" />
                <circle cx="12" cy="7.4" r="2.1" />
                <circle cx="16.8" cy="9.4" r="2.1" />
                <path d="M12 11.6c-3.1 0-5.6 2.3-5.6 4.7 0 1.5 1.1 2.5 2.7 2.5 1 0 1.9-.4 2.9-.4s1.9.4 2.9.4c1.6 0 2.7-1 2.7-2.5 0-2.4-2.5-4.7-5.6-4.7z" />
              </svg>
            </span>
            <div className="flex-1">
              <p className="text-sm font-bold">Ash · Animal Assistant</p>
              <p className="flex items-center gap-1.5 text-[11px] text-stone-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Online — replies instantly
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="cursor-pointer rounded-lg px-2 py-1 text-xl leading-none text-stone-300 hover:bg-white/10"
              aria-label="Close chat"
            >
              ×
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto bg-stone-100 p-4">
            {messages.map((m, i) => (
              <div key={i} className={m.from === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line ${
                    m.from === "user"
                      ? "rounded-br-md bg-pine-900 text-white"
                      : "rounded-bl-md border border-stone-200 bg-white text-stone-800"
                  }`}
                >
                  {m.text}
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

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex gap-2 border-t border-stone-200 bg-white p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about pets, lost & found…"
              className="min-w-0 flex-1 rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm focus:border-pine-700 focus:outline-none"
              aria-label="Message Ash"
            />
            <button
              type="submit"
              disabled={!input.trim()}
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
