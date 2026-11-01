import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_CHAT_KEY,
  chatKeyFor,
  purgeLegacyChat,
  loadChatFrom,
  saveChatTo,
  clearChatFor,
} from "./chatStore.js";

/** In-memory localStorage stand-in. */
function memStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    keys: () => [...map.keys()],
  };
}

describe("chat key isolation", () => {
  it("gives every user id a distinct key", () => {
    assert.equal(chatKeyFor({ id: 1, email: "a@x.com" }), "animalid.chat.1");
    assert.notEqual(chatKeyFor({ id: 1 }), chatKeyFor({ id: 2 }));
  });

  it("falls back to email, then guest", () => {
    assert.equal(chatKeyFor({ email: "a@x.com" }), "animalid.chat.a@x.com");
    assert.equal(chatKeyFor(7), "animalid.chat.7");
    for (const anon of [null, undefined, {}, { id: null }, ""]) {
      assert.equal(chatKeyFor(anon), "animalid.chat.guest");
    }
  });

  it("never collides with the legacy shared key", () => {
    for (const user of [{ id: 1 }, { email: "a@x.com" }, null]) {
      assert.notEqual(chatKeyFor(user), LEGACY_CHAT_KEY);
    }
  });
});

describe("chat history privacy", () => {
  it("keeps user A's messages invisible to user B", () => {
    const storage = memStorage();
    saveChatTo(storage, chatKeyFor({ id: 1 }), [{ from: "user", text: "A secret" }]);
    saveChatTo(storage, chatKeyFor({ id: 2 }), [{ from: "user", text: "B hello" }]);
    assert.match(JSON.stringify(loadChatFrom(storage, chatKeyFor({ id: 1 }))), /A secret/);
    assert.doesNotMatch(JSON.stringify(loadChatFrom(storage, chatKeyFor({ id: 2 }))), /A secret/);
    assert.equal(loadChatFrom(storage, chatKeyFor({ id: 3 })), null);
  });

  it("clearing one user leaves the other untouched", () => {
    const storage = memStorage();
    saveChatTo(storage, chatKeyFor({ id: 1 }), [{ from: "user", text: "A" }]);
    saveChatTo(storage, chatKeyFor({ id: 2 }), [{ from: "user", text: "B" }]);
    assert.equal(clearChatFor(storage, chatKeyFor({ id: 1 })), true);
    assert.equal(loadChatFrom(storage, chatKeyFor({ id: 1 })), null);
    assert.equal(loadChatFrom(storage, chatKeyFor({ id: 2 })).length, 1);
  });
});

describe("chat storage hygiene", () => {
  it("purges only the legacy shared log", () => {
    const storage = memStorage({
      [LEGACY_CHAT_KEY]: JSON.stringify([{ from: "user", text: "old" }]),
      [chatKeyFor({ id: 1 })]: JSON.stringify([{ from: "user", text: "mine" }]),
    });
    assert.equal(purgeLegacyChat(storage), true);
    assert.deepEqual(storage.keys(), [chatKeyFor({ id: 1 })]);
  });

  it("strips photo data URLs and caps stored length", () => {
    const storage = memStorage();
    const messages = Array.from({ length: 50 }, (_, i) => ({ from: "user", text: `m${i}`, image: "data:image/jpeg;base64,xx" }));
    saveChatTo(storage, chatKeyFor({ id: 1 }), messages);
    const stored = loadChatFrom(storage, chatKeyFor({ id: 1 }));
    assert.equal(stored.length, 40);
    assert.equal(stored[0].text, "m10");
    assert.ok(stored.every((m) => m.image === undefined));
  });

  it("loads null for missing or corrupt data, never throws", () => {
    const storage = memStorage({ bad: "{oops", scalar: '"hi"' });
    assert.equal(loadChatFrom(storage, "missing"), null);
    assert.equal(loadChatFrom(storage, "bad"), null);
    assert.equal(loadChatFrom(storage, "scalar"), null);
  });

  it("survives a hostile storage object", () => {
    const broken = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    };
    assert.equal(loadChatFrom(broken, "k"), null);
    assert.equal(saveChatTo(broken, "k", []), false);
    assert.equal(clearChatFor(broken, "k"), false);
    assert.equal(purgeLegacyChat(broken), false);
  });
});
