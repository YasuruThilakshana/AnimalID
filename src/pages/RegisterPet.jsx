import { useEffect, useMemo, useState } from "react";
import { ScanCode, StatusPill } from "../components/ui";
import { useStore } from "../lib/store";

const DRAFT_KEY = "animalid.draft";

const ANGLES = [
  { id: "front", label: "Front face", hint: "Head-on, both eyes visible", required: true },
  { id: "left", label: "Left side", hint: "Full left profile, standing", required: true },
  { id: "right", label: "Right side", hint: "Full right profile, standing", required: false },
  { id: "mark", label: "Identifying mark", hint: "Scar, patch, or unique feature close-up", required: false },
];

const STEPS = ["Basics", "Identification", "Photos", "Review"];

const EMPTY = {
  name: "",
  species: "Dog",
  breed: "",
  age: "",
  gender: "Female",
  color: "",
  weight: "",
  location: "",
  microchip: "",
  tagId: "",
  marks: "",
  vet: "",
  contact: "",
  photos: {},
};

function downscale(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 640;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image."));
    };
    img.src = url;
  });
}

function Field({ label, children, hint }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-bold tracking-wide text-stone-600 uppercase">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-stone-400">{hint}</p>}
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm focus:border-pine-700 focus:outline-none";

export default function RegisterPet() {
  const { currentUser, navigate, savePet, pets, nextId, toast, logActivity, route } = useStore();
  const editId = route.query.edit || null;
  const editing = useMemo(
    () => (editId ? pets.find((p) => p.id === editId) : null),
    [editId, pets],
  );

  const [step, setStep] = useState(0);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (!currentUser) navigate("auth", null, { mode: "up", next: "register" });
  }, [currentUser, navigate]);

  useEffect(() => {
    if (editing) {
      setForm({
        name: editing.name,
        species: editing.species,
        breed: editing.breed,
        age: editing.age,
        gender: editing.gender,
        color: editing.color,
        weight: editing.weight || "",
        location: editing.location,
        microchip: editing.microchip || "",
        tagId: editing.tagId || "",
        marks: editing.marks || "",
        vet: editing.vet || "",
        contact: editing.contact || "",
        photos: editing.photos || {},
      });
      return;
    }
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (draft && draft.owner === currentUser?.email) setForm({ ...EMPTY, ...draft.form });
    } catch {
      /* ignore corrupt draft */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id, currentUser?.email]);

  useEffect(() => {
    if (!editing && currentUser) {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ owner: currentUser.email, form }));
      } catch {
        /* storage full — draft simply won't persist */
      }
    }
  }, [form, currentUser, editing]);

  if (!currentUser) return null;

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const validate = (s) => {
    const e = {};
    if (s === 0) {
      if (form.name.trim().length < 2) e.name = "Give your pet a name (2+ characters).";
      if (!form.breed.trim()) e.breed = "Breed helps finders identify your pet.";
      if (!form.age.trim()) e.age = "Age is required.";
      if (!form.color.trim()) e.color = "Primary color is required.";
      if (!form.location.trim()) e.location = "City / area is required for alerts.";
    }
    if (s === 1) {
      if (form.microchip && !/^\d{9,15}$/.test(form.microchip.replace(/\s/g, "")))
        e.microchip = "Microchip numbers are 9–15 digits.";
      if (!form.contact.trim()) e.contact = "A contact number or email is required.";
    }
    if (s === 2) {
      for (const a of ANGLES.filter((x) => x.required)) {
        if (!form.photos[a.id]) e[a.id] = `${a.label} photo is required.`;
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => {
    if (validate(step)) setStep((s) => Math.min(3, s + 1));
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  const onPhoto = async (angleId, file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("That file isn't an image. Please choose a photo.", "warn");
      return;
    }
    try {
      const dataUrl = await downscale(file);
      setForm((f) => ({ ...f, photos: { ...f.photos, [angleId]: dataUrl } }));
      setErrors((e) => ({ ...e, [angleId]: undefined }));
    } catch {
      toast("Could not read that image. Try another file.", "warn");
    }
  };

  const submit = () => {
    if (!validate(0) || !validate(1) || !validate(2)) {
      setStep(0);
      toast("A few required fields need attention.", "warn");
      return;
    }
    const now = Date.now();
    if (editing) {
      const updated = {
        ...editing,
        ...form,
        name: form.name.trim(),
        timeline: [...(editing.timeline || []), { t: now, text: "Profile details updated" }],
      };
      savePet(updated);
      logActivity(`${updated.name}'s profile was updated`, currentUser.email);
      toast(`${updated.name}'s profile is up to date.`);
      navigate("pet", updated.id);
      return;
    }
    const pet = {
      id: nextId(),
      ...form,
      name: form.name.trim(),
      status: "safe",
      owner: currentUser.email,
      ownerName: currentUser.name,
      createdAt: now,
      sightings: [],
      timeline: [{ t: now, text: "Registered on AnimalID" }],
    };
    savePet(pet);
    logActivity(`${pet.name} was registered (${pet.id})`, currentUser.email);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* noop */
    }
    setDone(pet);
  };

  if (done) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-14 text-center sm:px-6">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-pine-900 text-2xl text-white">
          ✓
        </span>
        <h1 className="font-display mt-5 text-4xl font-bold text-pine-950">
          {done.name} is protected!
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          AnimalID <span className="font-mono font-bold">{done.id}</span> is live. Anyone who finds{" "}
          {done.name} can now reach you in seconds.
        </p>
        <div className="mx-auto mt-6 flex max-w-md items-center gap-4 rounded-2xl border border-stone-200 bg-white p-4 text-left shadow-sm">
          <ScanCode seed={done.id} className="h-24 w-24 shrink-0 rounded-lg border border-stone-200" />
          <div className="text-sm">
            <p className="font-bold text-pine-950">{done.name}'s scan code is ready</p>
            <p className="mt-1 text-stone-500">
              Print it from the profile page for collars, crates, and carriers.
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => navigate("pet", done.id)}
            className="cursor-pointer rounded-xl bg-pine-900 px-6 py-3 text-sm font-bold text-white hover:bg-pine-800"
          >
            View {done.name}'s profile
          </button>
          <button
            onClick={() => navigate("dashboard")}
            className="cursor-pointer rounded-xl border border-stone-300 px-6 py-3 text-sm font-bold text-stone-700 hover:border-stone-400"
          >
            Go to dashboard
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="bg-stone-100">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-4xl font-bold tracking-tight text-pine-950">
          {editing ? `Edit ${editing.name}'s profile` : "Register your pet"}
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          {editing
            ? `Updating ${editing.id}. Changes go live immediately.`
            : "Four quick steps. Your progress saves automatically as a draft."}
        </p>

        {/* Progress */}
        <ol className="mt-6 flex items-center gap-1 sm:gap-2" aria-label="Registration progress">
          {STEPS.map((label, i) => (
            <li key={label} className="flex flex-1 items-center gap-2">
              <button
                onClick={() => i < step && setStep(i)}
                disabled={i >= step}
                className={`flex flex-1 items-center gap-2 rounded-xl px-2 py-2 text-left sm:px-3 ${
                  i < step ? "cursor-pointer" : "cursor-default"
                }`}
                aria-current={i === step ? "step" : undefined}
              >
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                    i < step
                      ? "bg-pine-900 text-white"
                      : i === step
                        ? "bg-ember-500 text-white"
                        : "bg-stone-200 text-stone-500"
                  }`}
                >
                  {i < step ? "✓" : i + 1}
                </span>
                <span
                  className={`hidden text-xs font-bold sm:block ${
                    i === step ? "text-pine-950" : "text-stone-400"
                  }`}
                >
                  {label}
                </span>
              </button>
              {i < STEPS.length - 1 && <span className="h-px w-2 flex-shrink bg-stone-300 sm:w-4" />}
            </li>
          ))}
        </ol>

        <div className="mt-4 rounded-3xl border border-stone-200 bg-white p-6 sm:p-8">
          {step === 0 && (
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Pet name *">
                <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Maple" className={inputCls} />
                {errors.name && <Err msg={errors.name} />}
              </Field>
              <Field label="Species *">
                <select value={form.species} onChange={(e) => set("species", e.target.value)} className={`${inputCls} cursor-pointer`}>
                  {["Dog", "Cat", "Bird", "Rabbit", "Other"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Breed *">
                <input value={form.breed} onChange={(e) => set("breed", e.target.value)} placeholder="Golden Retriever" className={inputCls} />
                {errors.breed && <Err msg={errors.breed} />}
              </Field>
              <Field label="Age *">
                <input value={form.age} onChange={(e) => set("age", e.target.value)} placeholder="3 years" className={inputCls} />
                {errors.age && <Err msg={errors.age} />}
              </Field>
              <Field label="Gender">
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1">
                  {["Female", "Male"].map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => set("gender", g)}
                      className={`cursor-pointer rounded-lg py-2 text-sm font-bold ${
                        form.gender === g ? "bg-white text-pine-950 shadow-sm" : "text-stone-500"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Primary color *">
                <input value={form.color} onChange={(e) => set("color", e.target.value)} placeholder="Golden" className={inputCls} />
                {errors.color && <Err msg={errors.color} />}
              </Field>
              <Field label="Weight">
                <input value={form.weight} onChange={(e) => set("weight", e.target.value)} placeholder="28 kg" className={inputCls} />
              </Field>
              <Field label="Home city / area *">
                <input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Portland, OR" className={inputCls} />
                {errors.location && <Err msg={errors.location} />}
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Microchip number" hint="9–15 digits, usually on adoption paperwork.">
                <input value={form.microchip} onChange={(e) => set("microchip", e.target.value)} placeholder="985141042118203" className={`${inputCls} font-mono`} inputMode="numeric" />
                {errors.microchip && <Err msg={errors.microchip} />}
              </Field>
              <Field label="Collar tag ID" hint="Anything engraved on the current tag.">
                <input value={form.tagId} onChange={(e) => set("tagId", e.target.value)} placeholder="TAG-MPL-88" className={`${inputCls} font-mono`} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Distinctive markings" hint="The details a stranger would notice first.">
                  <textarea value={form.marks} onChange={(e) => set("marks", e.target.value)} rows={3} placeholder="Small white chest patch, freckle on nose, notch on right ear…" className={inputCls} />
                </Field>
              </div>
              <Field label="Veterinary clinic">
                <input value={form.vet} onChange={(e) => set("vet", e.target.value)} placeholder="Rose City Vet Clinic" className={inputCls} />
              </Field>
              <Field label="Owner contact *">
                <input value={form.contact} onChange={(e) => set("contact", e.target.value)} placeholder="(503) 555-0182" className={inputCls} />
                {errors.contact && <Err msg={errors.contact} />}
              </Field>
            </div>
          )}

          {step === 2 && (
            <div>
              <p className="text-sm text-stone-600">
                Four angles make a match <strong>4× more reliable</strong>. Front and left-side
                photos are required; the rest are strongly recommended.
              </p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {ANGLES.map((a) => (
                  <div key={a.id} className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
                    <div className="flex items-center justify-between px-1">
                      <p className="text-sm font-bold text-pine-950">
                        {a.label} {a.required && <span className="text-ember-600">*</span>}
                      </p>
                    </div>
                    <p className="px-1 text-xs text-stone-500">{a.hint}</p>
                    {form.photos[a.id] ? (
                      <div className="relative mt-2">
                        <img src={form.photos[a.id]} alt={`${a.label} of ${form.name || "pet"}`} className="h-40 w-full rounded-xl object-cover" />
                        <button
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, photos: { ...f.photos, [a.id]: undefined } }))}
                          className="absolute top-2 right-2 cursor-pointer rounded-lg bg-black/60 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-black/80"
                        >
                          Replace
                        </button>
                      </div>
                    ) : (
                      <label className="mt-2 flex h-40 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-stone-300 bg-white text-stone-400 hover:border-pine-700 hover:text-pine-800">
                        <svg viewBox="0 0 24 24" className="h-8 w-8 fill-current" aria-hidden="true">
                          <path d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5zm0 5.4a1.9 1.9 0 1 1 0-3.8 1.9 1.9 0 0 1 0 3.8zm7-9.9h-2.6l-1.4-1.7a1 1 0 0 0-.8-.4H9.8a1 1 0 0 0-.8.4L7.6 4H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm1 13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.3l1.4-1.7h4.6L14.7 5H19a1 1 0 0 1 1 1z" />
                        </svg>
                        <span className="text-xs font-bold">Upload {a.label.toLowerCase()}</span>
                        <span className="text-[11px]">JPG or PNG, resized automatically</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(e) => onPhoto(a.id, e.target.files?.[0])}
                        />
                      </label>
                    )}
                    {errors[a.id] && <Err msg={errors[a.id]} />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <div className="flex items-center justify-between">
                <h2 className="font-display text-2xl font-bold text-pine-950">
                  {form.name || "Your pet"}, ready for review
                </h2>
                <StatusPill status="safe" />
              </div>
              <dl className="mt-5 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                {[
                  ["Species", `${form.species} · ${form.gender}`],
                  ["Breed", form.breed],
                  ["Age", form.age],
                  ["Color", form.color + (form.weight ? ` · ${form.weight}` : "")],
                  ["Location", form.location],
                  ["Microchip", form.microchip || "—"],
                  ["Tag ID", form.tagId || "—"],
                  ["Vet", form.vet || "—"],
                  ["Contact", form.contact],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-stone-100 pb-2">
                    <dt className="font-semibold text-stone-500">{k}</dt>
                    <dd className="text-right font-bold text-pine-950">{v}</dd>
                  </div>
                ))}
              </dl>
              {form.marks && (
                <p className="mt-4 rounded-xl bg-stone-100 p-4 text-sm">
                  <span className="font-bold text-pine-950">Markings: </span>
                  <span className="text-stone-600">{form.marks}</span>
                </p>
              )}
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {ANGLES.map((a) => (
                  <div key={a.id}>
                    {form.photos[a.id] ? (
                      <img src={form.photos[a.id]} alt={a.label} className="h-24 w-full rounded-xl object-cover" />
                    ) : (
                      <div className="grid h-24 place-items-center rounded-xl bg-stone-100 text-xs font-semibold text-stone-400">
                        No photo
                      </div>
                    )}
                    <p className="mt-1 text-center text-[11px] font-bold text-stone-500">{a.label}</p>
                  </div>
                ))}
              </div>
              {!editing && (
                <div className="mt-5 flex items-center gap-4 rounded-2xl bg-pine-50 p-4">
                  <ScanCode seed="preview" className="h-16 w-16 shrink-0 rounded-lg border border-stone-200" />
                  <p className="text-xs leading-relaxed text-stone-600">
                    On submit, {form.name || "your pet"} gets a permanent AnimalID and a printable
                    scan code for collars and carriers.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Nav buttons */}
          <div className="mt-8 flex items-center justify-between gap-3 border-t border-stone-100 pt-6">
            <button
              onClick={back}
              disabled={step === 0}
              className="cursor-pointer rounded-xl border border-stone-300 px-5 py-2.5 text-sm font-bold text-stone-600 hover:border-stone-400 disabled:cursor-default disabled:opacity-40"
            >
              ← Back
            </button>
            {step < 3 ? (
              <button
                onClick={next}
                className="cursor-pointer rounded-xl bg-pine-900 px-6 py-2.5 text-sm font-bold text-white hover:bg-pine-800"
              >
                Continue →
              </button>
            ) : (
              <button
                onClick={submit}
                className="cursor-pointer rounded-xl bg-ember-500 px-6 py-2.5 text-sm font-bold text-white hover:bg-ember-600"
              >
                {editing ? "Save changes" : "Complete registration"}
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function Err({ msg }) {
  return (
    <p className="mt-1 text-xs font-semibold text-ember-600" role="alert">
      {msg}
    </p>
  );
}
