import { useStore } from "../lib/store";

export default function Toasts() {
  const { toasts } = useStore();
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-5 left-1/2 z-50 flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`rounded-xl px-4 py-3 text-sm font-semibold shadow-lg ${
            t.kind === "warn" ? "bg-ember-600 text-white" : "bg-pine-900 text-white"
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
