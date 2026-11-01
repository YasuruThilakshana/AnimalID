const Notification = require("../models/Notification");

function ownerOf(req) {
  return String(req.user?.email || "").toLowerCase();
}

/** GET /api/notifications — the caller's own notifications, newest first. */
async function listMine(req, res, next) {
  try {
    const notifications = await Notification.findAll({
      where: { ownerEmail: ownerOf(req) },
      order: [["createdAt", "DESC"]],
    });
    const unreadCount = notifications.filter((n) => !n.read).length;
    res.json({ notifications, unreadCount });
  } catch (err) {
    next(err);
  }
}

/** POST /api/notifications/read-all — mark all of the caller's notifications read. */
async function readAll(req, res, next) {
  try {
    const [marked] = await Notification.update(
      { read: true },
      { where: { ownerEmail: ownerOf(req), read: false } },
    );
    res.json({ ok: true, marked: marked || 0 });
  } catch (err) {
    next(err);
  }
}

module.exports = { listMine, readAll };
