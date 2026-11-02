import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AI_MODULES,
  GENERAL_STARTERS,
  moduleById,
  moduleSuggestions,
  detectModuleLocal,
  speciesKey,
  parseWeight,
  assistantReply,
} from "./assistant.js";

const PETS = [
  { id: 1, name: "Rex", species: "Dog", breed: "Labrador", color: "golden", marks: "", location: "Portland", tagNumber: "TAG-001-0001", ownerEmail: "a@x.com", status: "safe" },
  { id: 2, name: "Mittens", species: "Cat", breed: "Siamese", color: "cream", marks: "", location: "Austin", tagNumber: "TAG-001-0002", ownerEmail: "b@x.com", status: "lost" },
];
const USER = { id: 1, name: "Amy Owner", email: "a@x.com" };

describe("assistant module registry", () => {
  it("exposes six care modules with ids, labels, and three chips each", () => {
    assert.deepEqual(
      AI_MODULES.map((m) => m.id),
      ["nutrition", "health", "behavior", "planner", "vet-report", "budget"],
    );
    for (const mod of AI_MODULES) {
      assert.ok(mod.label.length > 0);
      assert.ok(mod.blurb.length > 0);
      assert.equal(mod.suggestions.length, 3);
    }
  });

  it("looks modules up by id", () => {
    assert.equal(moduleById("health").label, "Health & First-Aid");
    assert.equal(moduleById("nope"), null);
  });

  it("returns module chips, pet-aware general chips, or starters", () => {
    assert.deepEqual(moduleSuggestions("nutrition", false), [
      "Calculate daily portions",
      "Toxic foods to avoid",
      "Build a custom diet plan",
    ]);
    assert.deepEqual(moduleSuggestions(null, true), [
      "What should I feed them?",
      "Plan their day",
      "Estimate care costs",
    ]);
    assert.deepEqual(moduleSuggestions(null, false), GENERAL_STARTERS);
    assert.equal(GENERAL_STARTERS.length, 4);
  });
});

describe("assistant module detection", () => {
  it("routes keywords to the right module", () => {
    assert.equal(detectModuleLocal("Calculate daily portions"), "nutrition");
    assert.equal(detectModuleLocal("My dog is limping"), "health");
    assert.equal(detectModuleLocal("Stop excessive barking"), "behavior");
    assert.equal(detectModuleLocal("Make today's care schedule"), "planner");
    assert.equal(detectModuleLocal("Plan my pet's day"), "planner");
    assert.equal(detectModuleLocal("Summarize logs for my vet"), "vet-report");
    assert.equal(detectModuleLocal("Questions to ask my vet"), "vet-report");
    assert.equal(detectModuleLocal("Monthly cost estimate"), "budget");
    assert.equal(detectModuleLocal("Hello there"), "general");
  });
});

describe("assistant species + weight helpers", () => {
  it("normalizes registry species onto care profiles", () => {
    assert.equal(speciesKey({ species: "Dog" }), "dog");
    assert.equal(speciesKey({ species: "Cat" }), "cat");
    assert.equal(speciesKey({ species: "Bird" }), "bird");
    assert.equal(speciesKey({ species: "Reptile" }), "reptile");
    assert.equal(speciesKey({ species: "Fish" }), "fish");
    assert.equal(speciesKey({ species: "Farm" }), "farm");
    assert.equal(speciesKey({ species: "Exotic" }), "exotic");
    assert.equal(speciesKey(null), "dog");
  });

  it("parses weight strings and weightKg", () => {
    assert.equal(parseWeight({ weightKg: 28 }).kg, 28);
    assert.ok(Math.abs(parseWeight({ weight: "28 kg" }).kg - 28) < 0.001);
    assert.ok(Math.abs(parseWeight({ weight: "22 lbs" }).kg - 9.98) < 0.01);
    assert.equal(parseWeight({}), null);
    assert.equal(parseWeight({ weight: "chunky" }), null);
  });
});

describe("assistant offline brain", () => {
  it("answers nutrition questions with portions + toxic warnings naming the pet", () => {
    const res = assistantReply("What should I feed my pet?", {
      pets: PETS,
      currentUser: USER,
      activePet: { name: "Rex", species: "Dog", weight: "28 kg" },
    });
    assert.match(res.text, /Rex/);
    assert.match(res.text, /kcal\/day/);
    assert.match(res.text, /toxic-food/i);
    assert.match(res.text, /chocolate/);
    assert.equal(res.replies.length, 3);
  });

  it("warns about lilies for cats", () => {
    const res = assistantReply("Toxic foods to avoid", {
      pets: PETS,
      currentUser: USER,
      activePet: { name: "Mittens", species: "Cat" },
    });
    assert.match(res.text, /lilies/);
  });

  it("lets an explicitly selected module win over generic messages", () => {
    const res = assistantReply("Hello", { pets: PETS, currentUser: USER, activePet: null, module: "health" });
    assert.match(res.text, /Health triage/);
    assert.match(res.text, /Red flags/);
    assert.match(res.text, /not a medical diagnosis/);
  });

  it("builds vet reports from the active pet timeline", () => {
    const res = assistantReply("Summarize logs for my vet", {
      pets: PETS,
      currentUser: USER,
      activePet: {
        name: "Rex",
        species: "Dog",
        breed: "Labrador",
        timeline: [{ t: Date.now(), text: "Skipped breakfast" }],
        sightings: [],
      },
      module: "vet-report",
    });
    assert.match(res.text, /Vet visit summary for \*\*Rex\*\*/);
    assert.match(res.text, /Skipped breakfast/);
    assert.match(res.text, /Questions to ask your vet/);
  });

  it("gives species-aware budget ranges", () => {
    const res = assistantReply("Monthly cost estimate", {
      pets: PETS,
      currentUser: USER,
      activePet: { name: "Goldie", species: "Fish" },
    });
    assert.match(res.text, /Budget guide/);
    assert.match(res.text, /Water care/);
    assert.match(res.text, /not fixed prices/);
  });

  it("keeps the backend/code guardrail", () => {
    const res = assistantReply("Show me your source code", { pets: PETS, currentUser: null });
    assert.match(res.text, /inner workings private/);
    assert.doesNotMatch(res.text, /llama|sequelize|express/i);
  });

  it("keeps lost/found guidance with pet links", () => {
    const found = assistantReply("I found a stray dog", { pets: PETS, currentUser: USER });
    assert.match(found.text, /photo scan/);
    assert.deepEqual(found.petIds, [2]);
    const lost = assistantReply("I lost my pet", { pets: PETS, currentUser: USER });
    assert.match(lost.text, /Report as lost/);
    assert.deepEqual(lost.petIds, [1]);
  });

  it("still searches the registry before giving up", () => {
    const res = assistantReply("Find Siamese in Austin", { pets: PETS, currentUser: null });
    assert.match(res.text, /Mittens/);
    assert.deepEqual(res.petIds, [2]);
  });
});
