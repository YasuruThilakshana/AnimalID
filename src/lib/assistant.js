/** Universal AI Pet Care Assistant — module registry + offline brain.
 *
 *  AI_MODULES is the single source of truth for the Ask Ash module tabs, the
 *  per-module suggestion chips, and the offline fallback answers used when the
 *  backend is unreachable. Module ids map 1:1 onto the backend controller.
 */

export const AI_MODULES = [
  {
    id: "nutrition",
    label: "Nutrition",
    blurb: "Custom diets, portions & toxic-food warnings",
    suggestions: ["Calculate daily portions", "Toxic foods to avoid", "Build a custom diet plan"],
  },
  {
    id: "health",
    label: "Health & First-Aid",
    blurb: "Symptoms, emergencies & vaccination logs",
    suggestions: ["Emergency warning signs", "First-aid basics", "Vaccination schedule"],
  },
  {
    id: "behavior",
    label: "Behavior & Training",
    blurb: "Positive training for biting, barking & anxiety",
    suggestions: ["Stop excessive barking", "Litter box problems", "Separation anxiety help"],
  },
  {
    id: "planner",
    label: "Daily Care Planner",
    blurb: "Feeding, grooming, exercise & schedules",
    suggestions: ["Make today's care schedule", "Grooming routine", "Exercise plan"],
  },
  {
    id: "vet-report",
    label: "Vet Report",
    blurb: "Turn care logs into vet-visit summaries",
    suggestions: ["Summarize logs for my vet", "What should I track daily?", "Questions to ask my vet"],
  },
  {
    id: "budget",
    label: "Budget Guide",
    blurb: "Feeding, medical & upkeep estimates",
    suggestions: ["Monthly cost estimate", "First-year costs", "Adoption vs breeder?"],
  },
];

export const GENERAL_STARTERS = [
  "What should I feed my pet?",
  "Help with training",
  "Plan my pet's day",
  "Estimate care costs",
];

export function moduleById(id) {
  return AI_MODULES.find((m) => m.id === id) || null;
}

/** Chips for a module tab (general starters when no module is active). */
export function moduleSuggestions(moduleId, hasPet) {
  const mod = moduleId ? moduleById(moduleId) : null;
  if (mod) return [...mod.suggestions];
  return hasPet
    ? ["What should I feed them?", "Plan their day", "Estimate care costs"]
    : [...GENERAL_STARTERS];
}

/** Detect the intended module from message keywords (offline routing). */
export function detectModuleLocal(text) {
  const t = String(text || "").toLowerCase();
  if (/(vet report|vet visit|summary for (my )?vet|summari(s|z)e .*?(log|history|symptom)|care log|health histor|questions? (to ask|for)( my)? vet|\btrack(ing|ed)?\b)/.test(t)) return "vet-report";
  if (/(daily schedule|care schedule|task planner|remind me|grooming routine|exercise (plan|routine)|make .*plan for|today'?s schedule|plan.*day|day.*plan|daily plan)/.test(t)) return "planner";
  if (/(budget|cost|price|how much|expense|afford|adoption vs|first-year)/.test(t)) return "budget";
  if (/(diet|feed|food|nutrition|portion|meal|treat|kibble|toxic)/.test(t)) return "nutrition";
  if (/(behav|bark|bite|biting|aggress|anxi|fear|scratch|chew|train|toilet|potty|litter|jump|leash)/.test(t)) return "behavior";
  if (/(sick|ill|unwell|poorly|symptom|vomit|diarrh|limp|itch|skin|rash|ear|eye|cough|letharg|fever|pain|hurt|injur|wound|bleed|emergency|first.?aid|\baid\b|vet\b|vaccin|not eating|won't eat)/.test(t)) return "health";
  return "general";
}

const TOXIC_FOODS = {
  cat: "onion, garlic, grapes, chocolate, xylitol, and **lilies (deadly to cats)**",
  bird: "avocado, chocolate, caffeine, alcohol, onion, garlic, salt, and fruit pits — plus Teflon/smoke fumes",
  reptile: "fireflies, avocado, and wild-caught insects from sprayed areas",
  fish: "human food and overfeeding — stick to species-appropriate flakes/pellets",
  farm: "nightshade, rhododendron, oleander, moldy feed, and chocolate",
  exotic: "chocolate, onion, garlic, and anything high in sugar or salt",
  dog: "chocolate, grapes/raisins, onion, garlic, xylitol (birch sugar), macadamia nuts, alcohol, and cooked bones",
};

const BUDGET_ROWS = {
  cat: ["Food: ~$20–$60/mo", "Routine vet + vaccines: ~$100–$300/yr", "Litter: ~$15–$30/mo", "Supplies/toys: ~$10–$25/mo"],
  bird: ["Food: ~$15–$50/mo", "Avian vet: ~$100–$300/yr", "Toys/cage upkeep: ~$10–$30/mo", "Setup (cage): ~$80–$400 once"],
  reptile: ["Food: ~$10–$40/mo", "Heat/lighting: ~$10–$25/mo", "Exotic vet: ~$75–$250/yr", "Setup (terrarium): ~$100–$500 once"],
  fish: ["Food: ~$5–$20/mo", "Water care + power: ~$10–$30/mo", "Livestock/equipment: varies widely", "Setup (tank): ~$60–$400 once"],
  farm: ["Feed: ~$40–$200+/mo", "Hoof/farrier: ~$30–$150/visit", "Routine vet: ~$150–$500/yr", "Shelter/fencing: varies widely"],
  exotic: ["Food + hay: ~$10–$50/mo", "Exotic vet: ~$75–$250/yr", "Bedding/habitat: ~$10–$40/mo", "Setup: ~$60–$300 once"],
  dog: ["Food: ~$25–$80/mo", "Routine vet + vaccines: ~$150–$400/yr", "Grooming: ~$0–$80/mo", "Supplies/toys: ~$15–$40/mo"],
};

/** Normalize any registry species label onto a care-profile key. */
export function speciesKey(pet) {
  const s = String(pet?.species || "").toLowerCase();
  if (s.includes("cat")) return "cat";
  if (s.includes("bird") || s.includes("parrot")) return "bird";
  if (s.includes("reptile") || s.includes("lizard") || s.includes("snake") || s.includes("turtle") || s.includes("gecko")) return "reptile";
  if (s.includes("fish")) return "fish";
  if (s.includes("farm") || s.includes("chicken") || s.includes("goat") || s.includes("horse") || s.includes("sheep") || s.includes("cow")) return "farm";
  if (s.includes("rabbit") || s.includes("hamster") || s.includes("exotic") || s.includes("ferret") || s.includes("hedgehog") || s.includes("elephant")) return "exotic";
  return "dog";
}

function petName(pet, fallback = "your pet") {
  return pet?.name ? `**${pet.name}**` : fallback;
}

/** Parse "28 kg" / "10 lbs" style weight strings into { kg, label }. */
export function parseWeight(pet) {
  if (Number.isFinite(Number(pet?.weightKg)) && Number(pet.weightKg) > 0) {
    return { kg: Number(pet.weightKg), label: `${pet.weightKg} kg` };
  }
  const m = String(pet?.weight || "").match(/([\d.]+)\s*(kg|kilos?|lb|lbs|pounds?|g|grams?|oz)?/i);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = (m[2] || "kg").toLowerCase();
  const kg = unit.startsWith("lb") || unit.startsWith("pound") ? value * 0.4536
    : unit === "g" || unit.startsWith("gram") ? value / 1000
    : unit === "oz" ? value * 0.02835
    : value;
  return { kg, label: pet.weight.trim() };
}

function nutritionAnswer(pet) {
  const who = petName(pet);
  const key = speciesKey(pet);
  const parsed = parseWeight(pet);
  const portion = parsed
    ? key === "cat"
      ? `At **${parsed.label}** (≈${parsed.kg.toFixed(1)} kg), ${who} needs roughly **${Math.round(parsed.kg * 1000 * 0.22)}–${Math.round(parsed.kg * 1000 * 0.25)} kcal/day** (20–25 kcal per 100 g) — confirm against the food label.`
      : `At **${parsed.label}** (≈${parsed.kg.toFixed(1)} kg), resting needs ≈ **${Math.round(70 * Math.pow(parsed.kg, 0.75))} kcal/day** (70 × kg^0.75), ×1.6 for a neutered adult dog — confirm against the food label.`
    : `Portions scale with weight — weigh ${who} (or check the last vet record) and use the food label's per-kg table as the anchor.`;
  return [
    `### Nutrition plan for ${who}`,
    ``,
    portion,
    ``,
    `**Strict toxic-food list:** ${TOXIC_FOODS[key]}.`,
    ``,
    `**Build the habit:** 2 measured meals a day (3–4 for young ones), treats under 10% of calories, fresh water always, transitions over 7–10 days.`,
    ``,
    `Reconnect and I'll fine-tune portions for ${who}'s exact age, weight, and activity.`,
  ].join("\n");
}

function healthAnswer(pet) {
  const who = petName(pet);
  return [
    `### Health triage for ${who} (offline mode)`,
    `Work through this checklist and tell your vet what you find:`,
    ``,
    `☐ **Since when?** Sudden or building up over days?`,
    `☐ **Eating and drinking normally?** Not drinking is more urgent than not eating.`,
    `☐ **Energy and mood?** Playful, restless, lethargic, or hiding?`,
    `☐ **Anything else?** Vomiting, diarrhea, coughing, limping, scratching?`,
    ``,
    `**Red flags — see a vet urgently:** trouble breathing, seizures, major bleeding, bloated painful belly, suspected poisoning, heatstroke, inability to urinate, or a pet that can't stand. For urgent lost-pet cases call 1-800-555-0199.`,
    ``,
    `**Vaccination log:** note past shots + dates; core vaccines are DHPP + rabies (dogs) and FVRCP + rabies (cats) with puppy/kitten boosters — your vet sets the exact schedule.`,
    ``,
    `This is general guidance, not a medical diagnosis — only a vet can diagnose and prescribe.`,
  ].join("\n");
}

function behaviorAnswer(pet) {
  const who = petName(pet);
  return [
    `### Behavior & training for ${who} (offline mode)`,
    `Most behavior issues are communication, not disobedience:`,
    ``,
    `☐ **Needs met?** Enough exercise, play, and mental stimulation?`,
    `☐ **Trigger?** When exactly — visitors, being alone, walks, nights?`,
    `☐ **Health first?** Sudden changes (hiding, snapping, soiling) deserve a vet check.`,
    ``,
    `**Positive-reinforcement plan:** reward the behavior you want within seconds, manage the environment first (crate, gates, closed bins), and train in 5-minute sessions twice a day. Never use punishment or shock/prong tools.`,
    ``,
    `Describe what ${who} does and when — reconnect and I'll build a step-by-step training plan.`,
  ].join("\n");
}

function plannerAnswer(pet) {
  const who = petName(pet);
  return [
    `### Daily care schedule for ${who} (offline mode)`,
    ``,
    `**Morning:** fresh water + measured breakfast · toilet break/litter scoop · 20–30 min exercise.`,
    `**Midday:** 5-minute play/training session · water top-up (birds/reptiles: light/heat/humidity check).`,
    `**Evening:** measured dinner + calm play · grooming rotation · same bedtime spot.`,
    `**Weekly:** full groom, weigh-in, toy rotation, wash bowls/bedding; fish: partial water change.`,
    ``,
    `Reconnect and I'll set exact clock times around your routine.`,
  ].join("\n");
}

function timeLabel(t) {
  const n = Number(t);
  if (!Number.isFinite(n)) return "";
  return new Date(n).toLocaleDateString();
}

function vetReportAnswer(pet) {
  const who = petName(pet, "your pet");
  const lines = [
    `### Vet visit summary for ${who}`,
    ``,
    `**Patient:** ${pet?.species || "—"}${pet?.breed ? ` · ${pet.breed}` : ""}${pet?.age ? ` · ${pet.age}` : ""}${pet?.weight ? ` · ${pet.weight}` : ""}${pet?.gender ? ` · ${pet.gender}` : ""}`,
    ``,
  ];
  const timeline = Array.isArray(pet?.timeline) ? pet.timeline : [];
  const sightings = Array.isArray(pet?.sightings) ? pet.sightings : [];
  if (timeline.length || sightings.length) {
    lines.push(`**Timeline of recent events:**`);
    timeline.slice(-6).forEach((e, i) => lines.push(`${i + 1}. (${timeLabel(e.t)}) ${e.text}`));
    sightings.slice(-3).forEach((s) => lines.push(`• Sighting (${timeLabel(s.t)}): ${s.place}${s.note ? ` — ${s.note}` : ""}`));
    lines.push(``);
  } else {
    lines.push(`**Timeline:** no care logs on this profile yet — track appetite, water, energy, stool, vomiting, and meds with times starting today.`);
    lines.push(``);
  }
  lines.push(`**Questions to ask your vet:** what is the likely cause? what tests (if any) do you suggest? what should I monitor at home, and when should I come back?`);
  return lines.join("\n");
}

function budgetAnswer(pet) {
  const who = petName(pet, "a pet");
  const rows = BUDGET_ROWS[speciesKey(pet)];
  return [
    `### Budget guide for ${who} (offline mode)`,
    `Typical global ranges, not fixed prices — breed, size, and region move every line:`,
    ``,
    ...rows.map((r) => `☐ **${r}**`),
    ``,
    `**Upfront:** adoption (~$50–$300, often vaccinated already) vs breeder (~$300–$3,000+).`,
    `**Rule of thumb:** keep an emergency fund of 1–2 months of care costs.`,
  ].join("\n");
}

const MODULE_ANSWERS = {
  nutrition: nutritionAnswer,
  health: healthAnswer,
  behavior: behaviorAnswer,
  planner: plannerAnswer,
  "vet-report": vetReportAnswer,
  budget: budgetAnswer,
};

function searchPets(pets, text) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["find", "search", "show", "for", "the", "pet", "pets", "and", "looking", "look", "any"].includes(w));
  if (!words.length) return [];
  return pets
    .map((pet) => {
      const hay = `${pet.name} ${pet.species} ${pet.breed} ${pet.color} ${pet.marks} ${pet.location} ${pet.tagNumber || ""} ${pet.id}`.toLowerCase();
      const hits = words.filter((w) => hay.includes(w)).length;
      return { pet, hits };
    })
    .filter((r) => r.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 3)
    .map((r) => r.pet);
}

function petLine(p) {
  return `${p.name} — ${p.breed}, ${p.location} (${p.tagNumber || p.id})`;
}

/**
 * Offline brain: module-aware care answers + registry/app guidance for when
 * the backend is unreachable. The live Meta AI answers come from the server.
 *
 * @param {string} input user message
 * @param {{pets: Array, currentUser: object|null, activePet?: object|null, module?: string|null}} ctx
 * @returns {{text: string, petIds?: string[], replies?: string[]}}
 */
export function assistantReply(input, ctx) {
  const { pets, currentUser, activePet = null, module = null } = ctx;
  const t = input.toLowerCase();
  const has = (...words) => words.some((w) => t.includes(w));
  const hasPet = Boolean(activePet);
  const starters = moduleSuggestions(moduleById(module) ? module : null, hasPet);

  // Strict guardrail: end-user help only — never backend/code/model details.
  if (
    has(
      "source code", "codebase", "backend", "server code", "api key", "secret key",
      "what model", "which model", "model are you", "ai model", "language model",
      "system prompt", "your prompt", "training data", "database", "schema",
      "github", "repository", "how are you built", "how were you built",
      "how are you trained", "your architecture", "ignore instructions", "jailbreak",
      "developer mode",
    )
  ) {
    return {
      text: `I keep AnimalID's inner workings private, so I can't share backend, code, model, or developer details.\n\nI can help with pet care or using the app instead — pick a module above or ask about nutrition, health, training, schedules, vet reports, or budgets.`,
      replies: starters,
    };
  }

  if (has("found", "stray", "wandering") && has("pet", "dog", "cat", "animal", "stray", "found", "him", "her", "them", "one")) {
    const lost = pets.filter((p) => p.status === "lost");
    return {
      text: `Great instinct — here's what to do:\n\n1. Keep them safe and check for a collar tag.\n2. Scan their AnimalID or run a photo scan to find the owner instantly.\n3. If there's no match, report a sighting on the closest profile.\n\n${lost.length ? `There are ${lost.length} active lost report(s) right now — one could be this pet.` : "No active lost reports right now."}`,
      petIds: lost.slice(0, 3).map((p) => p.id),
      replies: starters,
    };
  }

  if (has("lost", "missing", "escaped", "run away", "ran away") && has("my", "lost", "missing", "pet", "dog", "cat", "escaped")) {
    const mine = currentUser ? pets.filter((p) => p.ownerEmail === currentUser.email) : [];
    return {
      text: currentUser
        ? `I'm sorry — let's move fast:\n\n1. Open your pet's profile and hit "Report as lost" so the alert broadcasts.\n2. Generate a lost-pet poster from the Alerts hub and print it.\n3. Check new sightings on the profile — finders report there.\n\nYou have ${mine.length} registered pet(s).${mine.length ? " Pick one to open it:" : ""}`
        : `I'm sorry — let's move fast:\n\n1. Create a free account and register your pet (10 minutes).\n2. Hit "Report as lost" so the alert broadcasts to the community.\n3. Generate a printable poster from the Alerts hub.\n\nWant me to take you to sign-up?`,
      petIds: mine.map((p) => p.id),
      replies: starters,
    };
  }

  if (has("sighting", "spotted")) {
    return {
      text: `Spotted a lost pet? Open their profile (from a scan match, the Alerts hub, or Find-a-pet search), then add where and when you saw them plus a note — it lands on the profile's sightings and timeline instantly.\n\nA quick photo helps more than pursuit — don't chase a scared animal.`,
      replies: starters,
    };
  }

  if (has("subscri", "notify", "notification", "alert me", "get alerts", "alerts hub")) {
    return {
      text: `Get notified the moment a pet goes missing near you:\n\n1. Open the Alerts hub (every lost report lives there).\n2. Scroll to "Get alerts for your area" at the bottom.\n3. Enter your email (and area) and hit "Alert me".\n\nYou can also filter the hub by keyword, area, species, and recency.`,
      replies: starters,
    };
  }

  if (has("register", "sign up", "signup", "add a pet", "add my pet", "new pet", "account")) {
    return {
      text: `Registration takes about 10 minutes:\n\n1. Create a free account (or use the demo to explore).\n2. Fill in basics, ID details, and upload 4 photo angles.\n3. Get a permanent AnimalID plus a printable scan code.\n\nYour progress saves as a draft automatically.`,
      replies: starters,
    };
  }

  if (
    (has("match", "score", "similarity", "confidence", "percent") ||
      (t.includes("%") && has("mean", "result", "scan", "view"))) &&
    has("match", "score", "scan", "result", "view", "mean", "photo", "similarity", "confidence", "%")
  ) {
    return {
      text: `After a photo scan, ranked top matches appear below your photo:\n\n1. Each candidate shows a similarity % and a band: High (85%+), Moderate (65%+), Possible (50%+) — 50%+ counts as a confident match.\n2. Tap a pet's name or "Open profile" to see the full record.\n3. Below the cutoff? The closest profiles are still listed so you can compare manually.`,
      replies: starters,
    };
  }

  if (has("scan", "photo", "match", "identify", "identification", "camera", "picture", "image")) {
    return {
      text: `The photo scanner compares an uploaded picture against every registered pet using coat, markings, species, and location signals, then ranks likely matches with confidence scores.\n\nNo account needed to scan — just drag in a photo. For best results, add the species and any visible markings.`,
      replies: starters,
    };
  }

  if (has("microchip", "chip", "collar tag", "tag")) {
    return {
      text: `Every AnimalID profile gets an auto-generated tag number (like TAG-001-0001) linked to its photos and owner contact. Type any tag into Find-a-pet search to open the profile instantly.\n\nThe 4-angle photos and scan code on the collar work as backup ID.`,
      replies: starters,
    };
  }

  if (has("poster", "flyer", "print")) {
    return {
      text: `From the Alerts hub, open any lost report and hit "Create poster". You get a print-ready flyer with photo, description, scan code, and tear-off contact tabs — free.`,
      replies: starters,
    };
  }

  if (has("shelter", "rescue", "find a vet", "vet near", "vet clinic", "nearest vet")) {
    return {
      text: `460+ partner shelters scan AnimalIDs at intake, so a tagged stray is usually identified in seconds. Your pet's profile stores its vet clinic too, and finders can call it from the contact card.\n\nFor a sick or injured animal, skip the search — call your regular vet clinic now, or an emergency vet after hours.`,
      replies: starters,
    };
  }

  // Module-aware care answers: an explicitly selected module wins, otherwise
  // the message keywords pick one. Care routing sits above the generic
  // account/hotline branches so "what should I feed my pet?" gets a diet
  // answer instead of a pet list.
  const activeModule = moduleById(module) ? module : detectModuleLocal(t);
  if (MODULE_ANSWERS[activeModule]) {
    return { text: MODULE_ANSWERS[activeModule](activePet), replies: moduleSuggestions(activeModule, hasPet) };
  }

  if (has("my pet", "my dog", "my cat", "my account", "dashboard", "my profile")) {
    if (!currentUser)
      return { text: "You're browsing as a guest — sign in to see your pets and dashboard.", replies: starters };
    const mine = pets.filter((p) => p.ownerEmail === currentUser.email);
    if (!mine.length) return { text: "You don't have any registered pets yet. Registration takes about 10 minutes — want to start?", replies: starters };
    return {
      text: `You have ${mine.length} registered pet(s):\n${mine.map((p) => `• ${petLine(p)}`).join("\n")}`,
      petIds: mine.map((p) => p.id),
    };
  }

  if (has("alert", "lost near", "near me", "missing")) {
    const lost = pets.filter((p) => p.status === "lost");
    if (!lost.length) return { text: "Good news — there are no active lost reports right now.", replies: starters };
    return {
      text: `These pets are currently reported lost:\n${lost.map((p) => `• ${petLine(p)}`).join("\n")}\n\nOpen one to report a sighting or print a poster.`,
      petIds: lost.map((p) => p.id),
    };
  }

  if (has("human", "person", "phone", "call", "hotline", "contact", "support")) {
    return {
      text: `For urgent cases call the lost-pet hotline at 1-800-555-0199. For anything else, tell me what happened — pick a care module above or describe the issue.`,
      replies: starters,
    };
  }

  if (has("thank", "thanks", "great", "awesome", "perfect")) {
    return { text: "Anytime! Happy to help you care for them. Anything else?", replies: starters };
  }

  if (has("hi", "hello", "hey", "yo", "sup") && t.trim().length < 20) {
    return {
      text: `Hello${currentUser ? `, ${currentUser.name.split(" ")[0]}` : ""}! I'm Ash, your universal pet care assistant. Pick a module above (nutrition, health, training, schedules, vet reports, budgets) or just ask — I cover dogs, cats, birds, reptiles, fish, farm, and exotic pets.`,
      replies: starters,
    };
  }

  // Fallback: try a pet search before admitting defeat.
  const results = searchPets(pets, t);
  if (results.length) {
    return {
      text: `Here's what I found in the registry:\n${results.map((p) => `• ${petLine(p)}`).join("\n")}\n\nTap one to open the full profile.`,
      petIds: results.map((p) => p.id),
      replies: starters,
    };
  }

  return {
    text: `I want to point you the right way — pick a care module above (nutrition, health & first-aid, training, daily schedules, vet reports, budgets), ask about any species, or say "find black cat in Austin" to search the registry.`,
    replies: starters,
  };
}
