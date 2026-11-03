import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api, { apiError } from "../lib/api.js";
import { EmptyState } from "../components/ui";
import { petPhoto, timeAgo, useStore } from "../lib/store";

function threadKey(t) {
  return String(t.user.id);
}

// Mirrors the server upload limit so oversized picks fail fast on-device.
const MAX_CHAT_PHOTO_BYTES = 8 * 1024 * 1024;

function CameraIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

export default function Messages() {
  const { currentUser, authReady, navigate, route, pets, toast, fetchMessagesUnread } = useStore();
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [peer, setPeer] = useState(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [petContext, setPetContext] = useState(null); // pet id attached to the next message
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const fileRef = useRef(null);
  const bottomRef = useRef(null);
  const activeRef = useRef(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (authReady && !currentUser) navigate("auth", null, { mode: "in" });
  }, [authReady, currentUser, navigate]);

  const refreshThreads = useCallback(async () => {
    try {
      const { data } = await api.get("/messages/threads");
      setThreads(Array.isArray(data.threads) ? data.threads : []);
    } catch {
      /* offline — keep the last known list */
    }
  }, []);

  const openThread = useCallback(
    async (userId, { markRead = true } = {}) => {
      const id = Number(userId);
      if (!id) return;
      activeRef.current = id;
      setActiveId(id);
      try {
        const { data } = await api.get(`/messages/thread/${id}`);
        if (activeRef.current !== id) return; // user moved on meanwhile
        setPeer(data.user);
        setMessages(Array.isArray(data.messages) ? data.messages : []);
        if (markRead) {
          api.post(`/messages/thread/${id}/read`).catch(() => {});
          fetchMessagesUnread();
          setThreads((prev) => prev.map((t) => (t.user.id === id ? { ...t, unreadCount: 0 } : t)));
        }
      } catch (err) {
        toast(apiError(err, "Could not open that conversation."), "warn");
      }
    },
    [fetchMessagesUnread, toast],
  );

  // Deep link (?user= from sightings / scan notifications), handled once
  // per query change so repeat taps while on the page still switch threads.
  const deepLinkRef = useRef(null);
  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      loadingRef.current = true;
      await refreshThreads();
      if (cancelled) return;
      const key = `${route.query?.user || ""}|${route.query?.pet || ""}`;
      deepLinkRef.current = key;
      const target = Number(route.query?.user) || null;
      if (target && target !== currentUser.id) {
        await openThread(target);
        const petId = Number(route.query?.pet) || null;
        if (petId) setPetContext(petId);
      }
      if (!cancelled) {
        setLoading(false);
        loadingRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || loadingRef.current) return;
    const key = `${route.query?.user || ""}|${route.query?.pet || ""}`;
    if (key === deepLinkRef.current) return;
    deepLinkRef.current = key;
    const target = Number(route.query?.user) || null;
    if (target && target !== currentUser.id) {
      openThread(target);
      const petId = Number(route.query?.pet) || null;
      setPetContext(petId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.query, currentUser]);

  // Live refresh while the page is open.
  useEffect(() => {
    if (!currentUser) return undefined;
    const id = window.setInterval(() => {
      refreshThreads();
      if (activeRef.current) openThread(activeRef.current, { markRead: true });
    }, 15000);
    return () => window.clearInterval(id);
  }, [currentUser, refreshThreads, openThread]);

  const scrollToBottom = useCallback((smooth = false) => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, activeId, scrollToBottom]);

  useEffect(() => {
    if (!lightbox) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const activePet = useMemo(() => {
    const pid = petContext || [...messages].reverse().find((m) => m.petId)?.petId;
    return pets.find((p) => String(p.id) === String(pid)) || null;
  }, [petContext, messages, pets]);

  // A deep-linked user with no history yet still gets a selectable thread row.
  const visibleThreads = useMemo(() => {
    if (!peer || peer.id === currentUser?.id || threads.some((t) => t.user.id === peer.id)) return threads;
    if (String(activeId) !== String(peer.id)) return threads;
    return [{ user: peer, lastMessage: null, unreadCount: 0 }, ...threads];
  }, [threads, peer, activeId, currentUser]);

  const pickPhoto = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("Choose a photo file (JPG, PNG, WebP, GIF).", "warn");
      return;
    }
    if (file.size > MAX_CHAT_PHOTO_BYTES) {
      toast("Photos must be under 8MB.", "warn");
      return;
    }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result);
    reader.readAsDataURL(file);
  };

  const clearPhoto = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
  };

  const send = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if ((!text && !photoFile) || !activeId || sending || uploading) return;
    setSending(true);
    try {
      let imageUrl = null;
      if (photoFile) {
        setUploading(true);
        try {
          const form = new FormData();
          form.append("image", photoFile);
          const { data } = await api.post("/messages/image", form);
          imageUrl = data.imageUrl;
        } finally {
          setUploading(false);
        }
      }
      const { data } = await api.post("/messages", {
        receiverId: activeId,
        text,
        petId: petContext,
        imageUrl,
      });
      setMessages((m) => [...m, data.message]);
      setInput("");
      clearPhoto();
      setPetContext(null);
      refreshThreads();
      scrollToBottom(true);
    } catch (err) {
      toast(apiError(err, "Could not send the message."), "warn");
    } finally {
      setSending(false);
    }
  };

  const backToList = () => {
    activeRef.current = null;
    setActiveId(null);
    setPeer(null);
    setMessages([]);
    setPetContext(null);
    clearPhoto();
    refreshThreads();
  };

  if (!authReady || !currentUser) return null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight text-pine-950">Messages</h1>
          <p className="mt-1 text-sm text-stone-500">
            Direct chats with finders, reporters, and fellow owners.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Thread list */}
        <section
          className={`overflow-hidden rounded-2xl border border-white/50 bg-white/85 shadow-xl backdrop-blur-xl ${
            activeId ? "hidden lg:block" : ""
          }`}
          aria-label="Conversations"
        >
          <p className="border-b border-stone-200/70 px-4 py-3 text-xs font-black tracking-widest text-stone-500 uppercase">
            Conversations
          </p>
          {loading ? (
            <p className="px-4 py-8 text-center text-sm text-stone-500">Loading conversations…</p>
          ) : visibleThreads.length === 0 ? (
            <div className="px-4 py-6">
              <EmptyState
                title="No messages yet"
                body="When someone reports a sighting or scans your pet, you can message them straight from here."
              />
            </div>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-stone-100 overflow-y-auto lg:max-h-[65vh]">
              {visibleThreads.map((t) => {
                const selected = String(activeId) === threadKey(t);
                const pet = pets.find((p) => String(p.id) === String(t.lastMessage?.petId));
                return (
                  <li key={threadKey(t)}>
                    <button
                      onClick={() => openThread(t.user.id)}
                      className={`flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors ${
                        selected ? "bg-pine-50" : "hover:bg-stone-50"
                      }`}
                      aria-current={selected}
                    >
                      <span
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-pine-900 text-sm font-black text-amber-400"
                        aria-hidden="true"
                      >
                        {(t.user.name || "?").charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-bold text-pine-950">{t.user.name}</span>
                          {t.lastMessage && (
                            <span className="shrink-0 text-[10px] font-semibold text-stone-400">
                              {timeAgo(t.lastMessage.createdAt)}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-stone-500">
                          {t.lastMessage
                            ? t.lastMessage.text || (t.lastMessage.imageUrl ? "Sent a photo" : "")
                            : "Start the conversation…"}
                        </span>
                        {pet && (
                          <span className="mt-0.5 block truncate text-[11px] font-bold text-pine-700">
                            About {pet.name}
                          </span>
                        )}
                      </span>
                      {t.unreadCount > 0 && (
                        <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-ember-500 px-1 text-[10px] font-black text-white">
                          {t.unreadCount > 9 ? "9+" : t.unreadCount}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Conversation */}
        <section
          className={`flex min-h-[60vh] flex-col overflow-hidden rounded-2xl border border-white/50 bg-white/85 shadow-xl backdrop-blur-xl lg:min-h-[65vh] ${
            activeId ? "" : "hidden lg:flex"
          }`}
          aria-label="Conversation"
        >
          {!activeId || !peer ? (
            <div className="grid flex-1 place-items-center p-8">
              <EmptyState
                title="Pick a conversation"
                body="Choose someone on the left — or tap Message on a sighting or scan alert to start chatting."
              />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-stone-200/70 bg-white/70 px-4 py-3">
                <button
                  onClick={backToList}
                  className="cursor-pointer rounded-lg px-2 py-1 text-sm font-bold text-pine-800 hover:bg-stone-100 lg:hidden"
                  aria-label="Back to conversations"
                >
                  ←
                </button>
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-pine-900 text-sm font-black text-amber-400"
                  aria-hidden="true"
                >
                  {(peer.name || "?").charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-pine-950">{peer.name}</p>
                  {activePet ? (
                    <button
                      onClick={() => navigate("pet", activePet.id)}
                      className="cursor-pointer truncate text-xs font-bold text-pine-700 hover:underline"
                    >
                      About {activePet.name} · view pet →
                    </button>
                  ) : (
                    <p className="truncate text-xs text-stone-500">{peer.email}</p>
                  )}
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-stone-100/80 p-4">
                {messages.length === 0 && (
                  <p className="py-8 text-center text-sm text-stone-500">
                    No messages yet — say hello below.
                  </p>
                )}
                {messages.map((m) => {
                  const mine = m.senderId === currentUser.id;
                  return (
                    <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                          mine
                            ? "rounded-br-md bg-pine-900 text-white shadow-md"
                            : "rounded-bl-md border border-stone-200/70 bg-white/95 text-stone-800 shadow-sm"
                        }`}
                      >
                        {m.imageUrl && (
                          <button
                            type="button"
                            onClick={() => setLightbox(m.imageUrl)}
                            className="mb-1 block cursor-zoom-in"
                            aria-label="View photo full screen"
                          >
                            <img
                              src={m.imageUrl}
                              alt="Shared photo"
                              loading="lazy"
                              onLoad={() => scrollToBottom()}
                              className="max-h-56 w-full rounded-xl object-cover"
                            />
                          </button>
                        )}
                        {m.text ? <p className="whitespace-pre-line">{m.text}</p> : null}
                        <p className={`mt-1 text-right text-[10px] font-semibold ${mine ? "text-stone-300" : "text-stone-400"}`}>
                          {timeAgo(m.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {petContext && activePet && (
                <div className="flex items-center gap-2 border-t border-stone-200/70 bg-amber-50/80 px-4 py-2">
                  {petPhoto(activePet) ? (
                    <img src={petPhoto(activePet)} alt="" className="h-8 w-8 rounded-lg object-cover" />
                  ) : null}
                  <p className="min-w-0 flex-1 truncate text-xs font-bold text-amber-900">
                    Chatting about {activePet.name}
                  </p>
                  <button
                    type="button"
                    onClick={() => setPetContext(null)}
                    className="shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 text-xs font-bold text-amber-700 hover:bg-amber-100"
                    aria-label="Remove pet context"
                  >
                    ×
                  </button>
                </div>
              )}

              {photoPreview && (
                <div className="flex shrink-0 items-center gap-3 border-t border-stone-200/70 bg-white/70 px-4 py-2">
                  <span className="relative shrink-0">
                    <img src={photoPreview} alt="Attachment preview" className="h-14 w-14 rounded-xl object-cover shadow" />
                    {uploading && (
                      <span className="absolute inset-0 grid place-items-center rounded-xl bg-pine-950/50" aria-hidden="true">
                        <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      </span>
                    )}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-xs font-semibold text-stone-500">
                    {uploading ? "Uploading photo…" : "Photo attached"}
                  </p>
                  {!uploading && (
                    <button
                      type="button"
                      onClick={clearPhoto}
                      className="shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 text-xs font-bold text-stone-500 hover:bg-stone-100"
                      aria-label="Remove photo"
                    >
                      ×
                    </button>
                  )}
                </div>
              )}

              <form onSubmit={send} className="flex shrink-0 items-center gap-2 border-t border-stone-200/70 bg-white/70 p-3">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={pickPhoto}
                  className="hidden"
                  aria-hidden="true"
                  tabIndex={-1}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={sending || uploading}
                  className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-stone-300/80 bg-white/90 text-pine-800 shadow-sm transition-colors hover:bg-stone-100 disabled:opacity-40"
                  aria-label="Attach a photo"
                >
                  <CameraIcon />
                </button>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={`Message ${peer.name.split(" ")[0]}…`}
                  className="h-11 min-w-0 flex-1 rounded-xl border border-stone-300/80 bg-white/90 px-3.5 text-sm shadow-sm placeholder:text-stone-400 focus:border-pine-700 focus:outline-none"
                  aria-label="Message text"
                />
                <button
                  type="submit"
                  disabled={(!input.trim() && !photoFile) || sending || uploading}
                  className="h-11 shrink-0 cursor-pointer rounded-xl bg-ember-500 px-4 text-sm font-bold text-white shadow-md transition-colors hover:bg-ember-600 disabled:opacity-40"
                >
                  {sending ? "…" : "↑"}
                </button>
              </form>
            </>
          )}
        </section>
      </div>

      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo viewer"
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-pine-950/90 p-4 backdrop-blur-sm"
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            aria-label="Close photo viewer"
            className="absolute top-4 right-4 cursor-pointer rounded-full bg-white/15 px-3 py-1.5 text-lg font-bold text-white hover:bg-white/25"
          >
            ×
          </button>
          <img
            src={lightbox}
            alt="Shared photo, full size"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] max-w-[92vw] cursor-default rounded-2xl object-contain shadow-2xl"
          />
        </div>
      )}
    </main>
  );
}
