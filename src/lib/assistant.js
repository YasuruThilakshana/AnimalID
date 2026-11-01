/** Rule-based brain for the AnimalID assistant widget.
 *  Intents: guidance (lost/found/register/scan/chip), pet search over the
 *  local registry, account help, and handoff to the hotline.
 */

/** Focused entry points: pet identification, urgent missing-pet help, behavior, health. */
export const QUICK_REPLIES = ["Identify a pet", "I lost my pet", "Behavior help", "Health & care"];

export const CARE_QUICK_PROMPTS = ["Diet tips", "Behavioral habits", "Age-related care"];

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
 * @param {string} input user message
 * @param {{pets: Array, currentUser: object|null}} ctx
 * @returns {{text: string, petIds?: string[], replies?: string[]}}
 */
export function assistantReply(input, ctx) {
  const { pets, currentUser } = ctx;
  const t = input.toLowerCase();
  const has = (...words) => words.some((w) => t.includes(w));

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
      text: `I keep AnimalID's inner workings private, so I can't share backend, code, model, or developer details.\n\nI can help you use the app instead — scanning, matches, lost & found, sightings, posters, alert subscriptions, and tags. What would you like to do?`,
      replies: ["Identify a pet", "I lost my pet"],
    };
  }

  if (has("found", "stray", "wandering") && has("pet", "dog", "cat", "animal", "stray", "found", "him", "her", "them", "one")) {
    const lost = pets.filter((p) => p.status === "lost");
    return {
      text: `Great instinct — here's what to do:\n\n1. Keep them safe and check for a collar tag.\n2. Scan their AnimalID or run a photo scan to find the owner instantly.\n3. If there's no match, report a sighting on the closest profile.\n\n${lost.length ? `There are ${lost.length} active lost report(s) right now — one could be this pet.` : "No active lost reports right now."}`,
      petIds: lost.slice(0, 3).map((p) => p.id),
      replies: ["Identify a pet", "I lost my pet"],
    };
  }

  if (has("lost", "missing", "escaped", "run away", "ran away") && has("my", "lost", "missing", "pet", "dog", "cat", "escaped")) {
    const mine = currentUser ? pets.filter((p) => p.ownerEmail === currentUser.email) : [];
    return {
      text: currentUser
        ? `I'm sorry — let's move fast:\n\n1. Open your pet's profile and hit "Report as lost" so the alert broadcasts.\n2. Generate a lost-pet poster from the Alerts hub and print it.\n3. Check new sightings on the profile — finders report there.\n\nYou have ${mine.length} registered pet(s).${mine.length ? " Pick one to open it:" : ""}`
        : `I'm sorry — let's move fast:\n\n1. Create a free account and register your pet (10 minutes).\n2. Hit "Report as lost" so the alert broadcasts to the community.\n3. Generate a printable poster from the Alerts hub.\n\nWant me to take you to sign-up?`,
      petIds: mine.map((p) => p.id),
      replies: currentUser ? ["Identify a pet"] : ["Identify a pet", "I lost my pet"],
    };
  }

  if (has("sighting", "spotted")) {
    return {
      text: `Spotted a lost pet? Open their profile (from a scan match, the Alerts hub, or Find-a-pet search), then add where and when you saw them plus a note — it lands on the profile's sightings and timeline instantly.\n\nA quick photo helps more than pursuit — don't chase a scared animal.`,
      replies: ["Identify a pet", "I lost my pet"],
    };
  }

  if (has("subscri", "notify", "notification", "alert me", "get alerts", "alerts hub")) {
    return {
      text: `Get notified the moment a pet goes missing near you:\n\n1. Open the Alerts hub (every lost report lives there).\n2. Scroll to "Get alerts for your area" at the bottom.\n3. Enter your email (and area) and hit "Alert me".\n\nYou can also filter the hub by keyword, area, species, and recency.`,
      replies: ["I lost my pet", "Identify a pet"],
    };
  }

  if (has("register", "sign up", "signup", "add a pet", "add my pet", "new pet", "account")) {
    return {
      text: `Registration takes about 10 minutes:\n\n1. Create a free account (or use the demo to explore).\n2. Fill in basics, ID details, and upload 4 photo angles.\n3. Get a permanent AnimalID plus a printable scan code.\n\nYour progress saves as a draft automatically.`,
      replies: ["I lost my pet", "Identify a pet"],
    };
  }

  if (
    (has("match", "score", "similarity", "confidence", "percent") ||
      (t.includes("%") && has("mean", "result", "scan", "view"))) &&
    has("match", "score", "scan", "result", "view", "mean", "photo", "similarity", "confidence", "%")
  ) {
    return {
      text: `After a photo scan, ranked top matches appear below your photo:\n\n1. Each candidate shows a similarity % and a band: High (85%+), Moderate (65%+), Possible (50%+) — 50%+ counts as a confident match.\n2. Tap a pet's name or "Open profile" to see the full record.\n3. Below the cutoff? The closest profiles are still listed so you can compare manually.`,
      replies: ["Identify a pet", "I lost my pet"],
    };
  }

  if (has("scan", "photo", "match", "identify", "identification", "camera", "picture", "image")) {
    return {
      text: `The photo scanner compares an uploaded picture against every registered pet using coat, markings, species, and location signals, then ranks likely matches with confidence scores.\n\nNo account needed to scan — just drag in a photo. For best results, add the species and any visible markings.`,
      replies: ["Identify a pet", "I lost my pet"],
    };
  }

  if (has("microchip", "chip", "collar tag", "tag")) {
    return {
      text: `Every AnimalID profile gets an auto-generated tag number (like TAG-001-0001) linked to its photos and owner contact. Type any tag into Find-a-pet search to open the profile instantly.\n\nThe 4-angle photos and scan code on the collar work as backup ID.`,
      replies: ["Identify a pet", "I lost my pet"],
    };
  }

  if (has("poster", "flyer", "print")) {
    return {
      text: `From the Alerts hub, open any lost report and hit "Create poster". You get a print-ready flyer with photo, description, scan code, and tear-off contact tabs — free.`,
      replies: ["I lost my pet"],
    };
  }

  if (has("shelter", "vet", "rescue")) {
    return {
      text: `460+ partner shelters scan AnimalIDs at intake, so a tagged stray is usually identified in seconds. Your pet's profile stores its vet clinic too, and finders can call it from the contact card.`,
      replies: ["Identify a pet", "I lost my pet"],
    };
  }

  if (has("my pet", "my dog", "my cat", "my account", "dashboard", "my profile")) {
    if (!currentUser)
      return { text: "You're browsing as a guest — sign in to see your pets and dashboard.", replies: ["Identify a pet"] };
    const mine = pets.filter((p) => p.ownerEmail === currentUser.email);
    if (!mine.length) return { text: "You don't have any registered pets yet. Registration takes about 10 minutes — want to start?", replies: ["Identify a pet"] };
    return {
      text: `You have ${mine.length} registered pet(s):\n${mine.map((p) => `• ${petLine(p)}`).join("\n")}`,
      petIds: mine.map((p) => p.id),
    };
  }

  if (has("alert", "lost near", "near me", "missing")) {
    const lost = pets.filter((p) => p.status === "lost");
    if (!lost.length) return { text: "Good news — there are no active lost reports right now." };
    return {
      text: `These pets are currently reported lost:\n${lost.map((p) => `• ${petLine(p)}`).join("\n")}\n\nOpen one to report a sighting or print a poster.`,
      petIds: lost.map((p) => p.id),
    };
  }

  if (has("human", "person", "phone", "call", "hotline", "contact", "help", "support", "emergency")) {
    return {
      text: `For urgent cases call the lost-pet hotline at 1-800-555-0199. For anything else, tell me what happened — I can guide you through lost, found, and registration step by step.`,
      replies: ["I lost my pet", "Identify a pet"],
    };
  }

  if (has("thank", "thanks", "great", "awesome", "perfect")) {
    return { text: "Anytime! Bringing them home is what we're here for. Anything else I can help with?", replies: QUICK_REPLIES };
  }

  if (has("hi", "hello", "hey", "yo", "sup") && t.trim().length < 20) {
    return {
      text: `Hello${currentUser ? `, ${currentUser.name.split(" ")[0]}` : ""}! I'm Ash, the AnimalID assistant. I can help you search pets, report lost or found animals, register, or explain how matching works. What's going on?`,
      replies: QUICK_REPLIES,
    };
  }

  // Fallback: try a pet search before admitting defeat.
  const results = searchPets(pets, t);
  if (results.length) {
    return {
      text: `Here's what I found in the registry:\n${results.map((p) => `• ${petLine(p)}`).join("\n")}\n\nTap one to open the full profile.`,
      petIds: results.map((p) => p.id),
      replies: ["Identify a pet", "I lost my pet"],
    };
  }

  return {
    text: `I want to point you the right way — I can search the registry ("find black cat in Austin"), walk you through a lost or found report, or explain registration, photo scanning, matches, and alert subscriptions. Which one fits?`,
    replies: QUICK_REPLIES,
  };
}
