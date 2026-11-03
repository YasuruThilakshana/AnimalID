const fs = require("fs");
const path = require("path");
const { Op } = require("sequelize");
const Message = require("../models/Message");
const User = require("../models/User");
const Animal = require("../models/Animal");

const MAX_TEXT = 2000;
const CHAT_PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

/**
 * Accept only relative chat-photo URLs produced by POST /api/messages/image:
 * "/uploads/<multer-filename>.<photo-ext>". Anything else (remote URLs,
 * traversal, markup/SVG) is "invalid" — chat bubbles must never render
 * attacker-controlled sources.
 */
function sanitizeMessageImageUrl(value) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  const match = /^\/uploads\/([A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp|gif))$/i.exec(text);
  return match ? `/uploads/${match[1]}` : "invalid";
}

function callerId(req) {
  return Number(req.user?.id) || null;
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email };
}

/** POST /api/messages — send a 1-on-1 message. Body: { receiverId, text?, petId?, imageUrl? }. */
async function sendMessage(req, res, next) {
  try {
    const senderId = callerId(req);
    const receiverId = Number(req.body?.receiverId) || null;
    const text = String(req.body?.text || "").trim();
    const imageUrl = sanitizeMessageImageUrl(req.body?.imageUrl);
    const petId = req.body?.petId === undefined || req.body?.petId === null || req.body?.petId === ""
      ? null
      : Number(req.body.petId) || null;
    if (!receiverId) return res.status(400).json({ error: "Choose who to message." });
    if (receiverId === senderId) return res.status(400).json({ error: "You can't message yourself." });
    if (imageUrl === "invalid") {
      return res.status(400).json({ error: "That photo didn't come from chat uploads." });
    }
    if (!text && !imageUrl) return res.status(400).json({ error: "Type a message or attach a photo first." });
    if (text.length > MAX_TEXT) {
      return res.status(400).json({ error: `Keep messages under ${MAX_TEXT} characters.` });
    }
    const receiver = await User.findByPk(receiverId);
    if (!receiver) return res.status(404).json({ error: "That user doesn't exist." });
    if (petId) {
      const pet = await Animal.findByPk(petId);
      if (!pet) return res.status(404).json({ error: "That pet doesn't exist." });
    }
    const message = await Message.create({ senderId, receiverId, petId, text, imageUrl, read: false });
    res.status(201).json({ message });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/messages/image — store one chat photo via the shared multer
 * pipeline and return its relative URL. Runs an extra extension check
 * (the shared filter allows any image/* mimetype) so SVG/markup can never
 * land in a chat bubble; rejected files are deleted immediately.
 */
async function uploadMessageImage(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: "Choose an image to send." });
    const ext = path.extname(req.file.filename || "").toLowerCase();
    if (!CHAT_PHOTO_EXTENSIONS.includes(ext)) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: "Send a JPG, PNG, WebP, or GIF photo." });
    }
    res.status(201).json({ imageUrl: `/uploads/${req.file.filename}` });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/messages/threads — the caller's conversations, newest first.
 * One thread per counterpart: { user, lastMessage, unreadCount }.
 */
async function listThreads(req, res, next) {
  try {
    const me = callerId(req);
    const rows = await Message.findAll({
      where: { [Op.or]: [{ senderId: me }, { receiverId: me }] },
      order: [["createdAt", "DESC"]],
    });
    const otherIds = [...new Set(rows.map((m) => (m.senderId === me ? m.receiverId : m.senderId)))];
    const users = otherIds.length ? await User.findAll({ where: { id: otherIds } }) : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    const threads = [];
    const seen = new Set();
    const unreadByOther = new Map();
    for (const m of rows) {
      if (m.receiverId === me && !m.read) {
        unreadByOther.set(m.senderId, (unreadByOther.get(m.senderId) || 0) + 1);
      }
    }
    for (const m of rows) {
      const otherId = m.senderId === me ? m.receiverId : m.senderId;
      if (seen.has(otherId)) continue;
      seen.add(otherId);
      threads.push({
        user: publicUser(byId.get(otherId)) || { id: otherId, name: "AnimalID member", email: "" },
        lastMessage: m,
        unreadCount: unreadByOther.get(otherId) || 0,
      });
    }
    res.json({ threads });
  } catch (err) {
    next(err);
  }
}

/** GET /api/messages/thread/:userId — full history with one user, oldest first. */
async function getThread(req, res, next) {
  try {
    const me = callerId(req);
    const otherId = Number(req.params.userId) || null;
    if (!otherId) return res.status(400).json({ error: "Choose who to message." });
    if (otherId === me) return res.status(400).json({ error: "You can't message yourself." });
    const other = await User.findByPk(otherId);
    if (!other) return res.status(404).json({ error: "That user doesn't exist." });
    const messages = await Message.findAll({
      where: {
        [Op.or]: [
          { senderId: me, receiverId: otherId },
          { senderId: otherId, receiverId: me },
        ],
      },
      order: [["createdAt", "ASC"]],
    });
    res.json({ user: publicUser(other), messages });
  } catch (err) {
    next(err);
  }
}

/** POST /api/messages/thread/:userId/read — mark their messages to me read. */
async function markThreadRead(req, res, next) {
  try {
    const me = callerId(req);
    const otherId = Number(req.params.userId) || null;
    if (!otherId) return res.status(400).json({ error: "Choose who to message." });
    const [marked] = await Message.update(
      { read: true },
      { where: { senderId: otherId, receiverId: me, read: false } },
    );
    res.json({ ok: true, marked: marked || 0 });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/messages/peer?email= — resolve a chat peer's public profile by
 * email. Lets a pet page start a chat with the owner (pets carry ownerEmail,
 * not ownerId). Returns id + name only — never secrets.
 */
async function getPeerByEmail(req, res, next) {
  try {
    const email = String(req.query?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "Choose who to message." });
    const peer = await User.findOne({ where: { email } });
    if (!peer) return res.status(404).json({ error: "That user doesn't exist." });
    res.json({ user: publicUser(peer) });
  } catch (err) {
    next(err);
  }
}

/** GET /api/messages/unread-count — badge number for the nav. */
async function unreadCount(req, res, next) {
  try {
    const me = callerId(req);
    const count = await Message.count({ where: { receiverId: me, read: false } });
    res.json({ unreadCount: count || 0 });
  } catch (err) {
    next(err);
  }
}

module.exports = { sendMessage, listThreads, getThread, markThreadRead, unreadCount, getPeerByEmail, uploadMessageImage };
