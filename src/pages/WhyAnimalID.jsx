import { useEffect, useRef, useState } from "react";
import { openAssistant, useStore } from "../lib/store";

/** Fades a block in the first time it scrolls into view. */
function Reveal({ children, className = "", delay = 0 }) {
  const ref = useRef(null);
  // Without IntersectionObserver (old browsers, SSR) there is nothing to wait for.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
      className={`reveal${visible ? " is-visible" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

function HeroRadar() {
  return (
    <svg viewBox="0 0 220 220" className="h-56 w-56 sm:h-72 sm:w-72" aria-hidden="true">
      <circle cx="110" cy="110" r="96" fill="none" stroke="#fbbf24" strokeOpacity="0.25" strokeWidth="1.5" />
      <circle cx="110" cy="110" r="70" fill="none" stroke="#fbbf24" strokeOpacity="0.35" strokeWidth="1.5" />
      <circle cx="110" cy="110" r="44" fill="none" stroke="#fbbf24" strokeOpacity="0.5" strokeWidth="1.5" />
      <circle cx="110" cy="110" r="96" fill="none" stroke="#fbbf24" strokeWidth="2" className="ring-ping" />
      <g className="radar-sweep" style={{ transformOrigin: "110px 110px" }}>
        <line x1="110" y1="110" x2="110" y2="18" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />
      </g>
      <g>
        <circle cx="110" cy="110" r="13" fill="#fbbf24" />
        <circle cx="104" cy="105" r="3.4" fill="#0a2320" />
        <circle cx="116" cy="105" r="3.4" fill="#0a2320" />
        <path d="M104 114c1.8 2.6 10.2 2.6 12 0-1.6 3.4-10.4 3.4-12 0z" fill="#0a2320" />
      </g>
      <circle cx="158" cy="72" r="5" fill="#e4572e" className="blip" />
      <circle cx="66" cy="146" r="4" fill="#5eead4" className="blip blip-late" />
    </svg>
  );
}

function ScanArt() {
  return (
    <svg viewBox="0 0 200 140" className="h-full w-full" aria-hidden="true">
      <rect x="52" y="10" width="96" height="120" rx="14" fill="#0a2320" />
      <rect x="62" y="20" width="76" height="76" rx="8" fill="#174840" />
      <circle cx="88" cy="52" r="9" fill="#fbbf24" />
      <circle cx="112" cy="52" r="9" fill="#fbbf24" />
      <path d="M84 74c3 5 29 5 32 0-3 8-29 8-32 0z" fill="#fbbf24" />
      <rect x="62" y="104" width="76" height="8" rx="4" fill="#e4572e" className="meter-fill" />
      <rect x="46" y="4" width="34" height="34" rx="8" fill="none" stroke="#5eead4" strokeWidth="4" className="corner-tl" />
      <rect x="120" y="102" width="34" height="34" rx="8" fill="none" stroke="#5eead4" strokeWidth="4" className="corner-br" />
    </svg>
  );
}

function CommunityArt() {
  return (
    <svg viewBox="0 0 200 140" className="h-full w-full" aria-hidden="true">
      <line x1="100" y1="66" x2="40" y2="34" stroke="#1f5c52" strokeWidth="2.5" className="link-draw" />
      <line x1="100" y1="66" x2="160" y2="34" stroke="#1f5c52" strokeWidth="2.5" className="link-draw link-late" />
      <line x1="100" y1="66" x2="52" y2="112" stroke="#1f5c52" strokeWidth="2.5" className="link-draw link-later" />
      <line x1="100" y1="66" x2="148" y2="112" stroke="#1f5c52" strokeWidth="2.5" className="link-draw" />
      <circle cx="40" cy="34" r="16" fill="#e4572e" />
      <circle cx="160" cy="34" r="16" fill="#b98a1f" />
      <circle cx="52" cy="112" r="16" fill="#1f5c52" />
      <circle cx="148" cy="112" r="16" fill="#0a2320" />
      <circle cx="100" cy="66" r="24" fill="#fbbf24" className="hub-pulse" />
      <circle cx="93" cy="61" r="4" fill="#0a2320" />
      <circle cx="107" cy="61" r="4" fill="#0a2320" />
      <path d="M92 72c2.4 3.4 13.6 3.4 16 0-2.2 4.6-13.8 4.6-16 0z" fill="#0a2320" />
    </svg>
  );
}

function AshArt() {
  return (
    <svg viewBox="0 0 200 140" className="h-full w-full" aria-hidden="true">
      <rect x="30" y="14" width="140" height="52" rx="16" fill="#0a2320" />
      <rect x="44" y="28" width="84" height="8" rx="4" fill="#fbbf24" className="bubble-line" />
      <rect x="44" y="42" width="56" height="8" rx="4" fill="#fbbf24" opacity="0.55" className="bubble-line bubble-late" />
      <rect x="60" y="74" width="110" height="52" rx="16" fill="#e4572e" />
      <rect x="74" y="88" width="70" height="8" rx="4" fill="#fff" className="bubble-line bubble-later" />
      <rect x="74" y="102" width="46" height="8" rx="4" fill="#fff" opacity="0.6" className="bubble-line" />
      <circle cx="160" cy="30" r="7" fill="#5eead4" className="blip" />
      <circle cx="38" cy="104" r="5" fill="#b98a1f" className="blip blip-late" />
    </svg>
  );
}

const STEPS = [
  {
    n: 1,
    title: "Join AnimalID",
    body: "Create a free account in under a minute. Your dashboard keeps every pet, alert, and conversation in one calm place.",
    chip: "Free forever plan",
  },
  {
    n: 2,
    title: "Ask Ash for guidance",
    body: "Not sure which pet fits your life? Ash weighs your space, schedule, and experience, then recommends species and breeds with honest trade-offs.",
    chip: "AI assistant",
  },
  {
    n: 3,
    title: "Register with photos + tag",
    body: "Snap front, left, right, and mark photos so visual recognition learns your pet from every angle — then print the unique QR tag for their collar.",
    chip: "QR tag issued",
  },
  {
    n: 4,
    title: "Trigger a Missing Alert",
    body: "If they slip away, broadcast a lost alert with the last-seen location. Nearby members and the scanner network start watching instantly.",
    chip: "Instant broadcast",
  },
  {
    n: 5,
    title: "Scan, notify, reunite",
    body: "A finder scans the tag or spots your pet — you get an instant notification with who and where, chat with them directly, and bring your pet home.",
    chip: "Happy reunion",
  },
];

export default function WhyAnimalID() {
  const { navigate } = useStore();
  return (
    <main>
      {/* Hero */}
      <section className="topo-pattern relative overflow-hidden bg-pine-950 text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:py-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-bold text-amber-200">
              <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" aria-hidden="true" />
              The lost-pet safety network
            </p>
            <h1 className="font-display mt-5 text-5xl leading-[1.05] font-bold tracking-tight sm:text-6xl">
              Every pet, <span className="text-amber-400">findable.</span>
              <br />
              Every owner, <span className="text-amber-400">one scan away.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-stone-300 sm:text-lg">
              AnimalID pairs multi-angle visual recognition with a living community and an AI
              assistant — so lost pets get found, finders reach owners in seconds, and nobody
              faces a missing pet alone.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                onClick={() => navigate("register")}
                className="cursor-pointer rounded-xl bg-ember-500 px-6 py-3 text-sm font-bold text-white shadow-lg transition-colors hover:bg-ember-600"
              >
                Register your pet — free
              </button>
              <button
                onClick={() => navigate("scan")}
                className="cursor-pointer rounded-xl border border-white/25 bg-white/10 px-6 py-3 text-sm font-bold text-white backdrop-blur transition-colors hover:bg-white/20"
              >
                Try the photo scan
              </button>
            </div>
          </div>
          <div className="relative mx-auto">
            <HeroRadar />
            <div className="float-y absolute -top-2 -right-2 rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-xs font-bold text-white shadow-lg backdrop-blur-md">
              Match found · 98.2%
            </div>
            <div
              className="float-y float-late absolute -bottom-3 -left-4 rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-xs font-bold text-white shadow-lg backdrop-blur-md"
              aria-hidden="true"
            >
              Owner notified instantly
            </div>
          </div>
        </div>
      </section>

      {/* Value cards */}
      <section className="mx-auto max-w-6xl space-y-6 px-4 py-16 sm:px-6" aria-label="Why AnimalID">
        <Reveal className="max-w-2xl">
          <h2 className="font-display text-4xl font-bold tracking-tight text-pine-950">
            Three reasons pets come home
          </h2>
          <p className="mt-2 text-stone-600">
            Recognition to identify them, community to watch for them, and guidance for everything between.
          </p>
        </Reveal>

        <Reveal>
          <article className="grid overflow-hidden rounded-3xl border border-stone-200/80 bg-white/85 shadow-xl backdrop-blur-xl md:grid-cols-2">
            <div className="bg-pine-950 p-8">
              <ScanArt />
            </div>
            <div className="flex flex-col justify-center p-8">
              <p className="text-xs font-black tracking-widest text-ember-600 uppercase">AI pet identification</p>
              <h3 className="font-display mt-2 text-3xl font-bold text-pine-950">
                Recognized from any angle
              </h3>
              <p className="mt-3 leading-relaxed text-stone-600">
                Register front, side, and mark photos once. When a found pet is scanned, visual
                recognition compares every angle and pings the owner the instant a confident
                match lands — no microchip reader required.
              </p>
              <div className="mt-5">
                <button
                  onClick={() => navigate("scan")}
                  className="cursor-pointer rounded-xl bg-pine-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-pine-800"
                >
                  Scan a photo →
                </button>
              </div>
            </div>
          </article>
        </Reveal>

        <Reveal>
          <article className="grid overflow-hidden rounded-3xl border border-stone-200/80 bg-white/85 shadow-xl backdrop-blur-xl md:grid-cols-2">
            <div className="flex flex-col justify-center p-8 md:order-1">
              <p className="text-xs font-black tracking-widest text-ember-600 uppercase">Pet community</p>
              <h3 className="font-display mt-2 text-3xl font-bold text-pine-950">
                Neighbors who watch with you
              </h3>
              <p className="mt-3 leading-relaxed text-stone-600">
                Join local alerts, follow nearby lost pets, and message finders directly. Every
                sighting report carries the reporter's name, so owners always know who to thank —
                and who to call first.
              </p>
              <div className="mt-5">
                <button
                  onClick={() => navigate("alerts")}
                  className="cursor-pointer rounded-xl bg-pine-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-pine-800"
                >
                  Browse lost alerts →
                </button>
              </div>
            </div>
            <div className="bg-pine-50 p-8 md:order-2">
              <CommunityArt />
            </div>
          </article>
        </Reveal>

        <Reveal>
          <article className="grid overflow-hidden rounded-3xl border border-stone-200/80 bg-white/85 shadow-xl backdrop-blur-xl md:grid-cols-2">
            <div className="bg-ember-600 p-8">
              <AshArt />
            </div>
            <div className="flex flex-col justify-center p-8">
              <p className="text-xs font-black tracking-widest text-ember-600 uppercase">Ask Ash · AI assistant</p>
              <h3 className="font-display mt-2 text-3xl font-bold text-pine-950">
                Expert answers, day or night
              </h3>
              <p className="mt-3 leading-relaxed text-stone-600">
                Behavior puzzles, nutrition questions, first-aid triage, or picking the right
                species for your home — Ash answers instantly, remembers your pets, and speaks
                your language.
              </p>
              <div className="mt-5">
                <button
                  onClick={() => openAssistant()}
                  className="cursor-pointer rounded-xl bg-pine-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-pine-800"
                >
                  Chat with Ash →
                </button>
              </div>
            </div>
          </article>
        </Reveal>
      </section>

      {/* Journey timeline */}
      <section className="bg-pine-50/60 py-16" aria-label="How it works">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-4xl font-bold tracking-tight text-pine-950">
              From sign-up to reunion in five steps
            </h2>
            <p className="mt-2 text-stone-600">Follow one owner&apos;s journey through AnimalID.</p>
          </Reveal>
          <ol className="relative mt-12 space-y-6 md:space-y-0">
            <span className="timeline-rail" aria-hidden="true" />
            {STEPS.map((s, i) => (
              <li key={s.n} className="relative md:grid md:grid-cols-2 md:gap-12 md:pb-10 md:last:pb-0">
                <Reveal
                  delay={(i % 2) * 60}
                  className={i % 2 === 0 ? "md:col-start-1 md:text-right" : "md:col-start-2"}
                >
                  <article
                    className={`relative ml-12 rounded-2xl border border-white/60 bg-white/85 p-6 shadow-xl backdrop-blur-xl md:ml-0 ${
                      i % 2 === 0 ? "step-side-l" : "step-side-r"
                    } ${s.n === 5 ? "border-amber-300/70" : ""}`}
                  >
                    <span
                      className={`step-node ${s.n === 5 ? "step-node-final" : ""}`}
                      aria-hidden="true"
                    >
                      {s.n}
                    </span>
                    <p className="inline-block rounded-full bg-pine-900 px-2.5 py-1 text-[11px] font-black tracking-wide text-amber-300 uppercase">
                      Step {s.n} · {s.chip}
                    </p>
                    <h3 className="font-display mt-2 text-2xl font-bold text-pine-950">{s.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-stone-600">{s.body}</p>
                  </article>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <Reveal>
          <div className="topo-pattern relative overflow-hidden rounded-3xl bg-pine-950 px-8 py-12 text-center text-white sm:px-12">
            <h2 className="font-display mx-auto max-w-xl text-4xl font-bold tracking-tight">
              Your pet&apos;s way home starts with one photo
            </h2>
            <p className="mx-auto mt-3 max-w-md text-stone-300">
              Join free, register your pet, and sleep better knowing thousands of eyes — and one sharp AI — are watching out for them.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <button
                onClick={() => navigate("register")}
                className="cursor-pointer rounded-xl bg-ember-500 px-6 py-3 text-sm font-bold text-white shadow-lg transition-colors hover:bg-ember-600"
              >
                Register your pet — free
              </button>
              <button
                onClick={() => navigate("browse")}
                className="cursor-pointer rounded-xl border border-white/25 bg-white/10 px-6 py-3 text-sm font-bold text-white backdrop-blur transition-colors hover:bg-white/20"
              >
                Meet the community
              </button>
            </div>
          </div>
        </Reveal>
      </section>
    </main>
  );
}
