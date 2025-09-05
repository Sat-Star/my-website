const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const sanitize = require("sanitize-html");

const app = express();
app.use(cors());
// increase JSON/body size limit to allow small base64 image uploads from the client
app.use(express.json({ limit: "6mb" }));
app.use(express.urlencoded({ limit: "6mb", extended: true }));

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://localhost:27017/my-website";
const JWT_SECRET = process.env.JWT_SECRET || "devsecret";

mongoose
  .connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("Mongo connection error", err));

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const User = mongoose.model("User", userSchema);

const entrySchema = new mongoose.Schema({
  kind: { type: String, enum: ["thought", "learning", "note"], required: true },
  title: String,
  body: { type: String, required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  ownerName: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

entrySchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

const Entry = mongoose.model("Entry", entrySchema);

function sanitizeBody(html) {
  return sanitize(html, {
    allowedTags: sanitize.defaults.allowedTags.concat(["img"]),
    allowedAttributes: { "*": ["href", "src", "alt", "title", "target"] },
  });
}

// Simple Image model (store small images as base64). For production use GridFS or cloud storage.
const imageSchema = new mongoose.Schema({
  mime: String,
  data: String, // base64
  createdAt: { type: Date, default: Date.now },
});
const Image = mongoose.model("Image", imageSchema);

// upload image endpoint (accepts JSON { mime, data }) to avoid native multipart dependency.
app.post("/api/images-json", authMiddleware, async (req, res) => {
  try {
    const { mime, data } = req.body;
    if (!mime || !data)
      return res.status(400).json({ error: "mime and data required" });
    const img = new Image({ mime, data });
    await img.save();
    res.status(201).json({ id: img._id, url: `/api/images/${img._id}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

// serve image bytes
app.get("/api/images/:id", async (req, res) => {
  try {
    const img = await Image.findById(req.params.id);
    if (!img) return res.status(404).end();
    const buf = Buffer.from(img.data, "base64");
    res.set("Content-Type", img.mime);
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

function generateToken(user) {
  return jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, {
    expiresIn: "7d",
  });
}

async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "missing auth" });
  const parts = auth.split(" ");
  if (parts.length !== 2)
    return res.status(401).json({ error: "malformed auth" });
  const token = parts[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "invalid token" });
  }
}

// register
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: "username and password required" });
    const existing = await User.findOne({ username });
    if (existing) return res.status(409).json({ error: "username taken" });
    const hash = await bcrypt.hash(password, 10);
    const u = new User({ username, passwordHash: hash });
    await u.save();
    res.status(201).json({ token: generateToken(u), username: u.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

// login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: "username and password required" });
    const u = await User.findOne({ username });
    if (!u) return res.status(401).json({ error: "invalid" });
    const ok = await bcrypt.compare(password, u.passwordHash);
    if (!ok) return res.status(401).json({ error: "invalid" });
    res.json({ token: generateToken(u), username: u.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

// list with pagination
app.get("/api/entries", async (req, res) => {
  try {
    const { kind, page = 0, limit = 10, q } = req.query;
    const filter = {};
    if (kind) filter.kind = kind;
    if (q) {
      // simple case-insensitive search on title and body
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ title: re }, { body: re }];
    }
    const skip = Math.max(0, parseInt(page)) * parseInt(limit);
    const list = await Entry.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

// create (requires auth)
app.post("/api/entries", authMiddleware, async (req, res) => {
  try {
    const { kind, title, body } = req.body;
    if (!kind || !body)
      return res.status(400).json({ error: "kind and body required" });
    const clean = sanitizeBody(body);
    const user = await User.findById(req.user.id);
    const e = new Entry({
      kind,
      title,
      body: clean,
      ownerId: user._id,
      ownerName: user.username,
    });
    await e.save();
    res.status(201).json(e);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// edit entry (owner only)
app.put("/api/entries/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const entry = await Entry.findById(id);
    if (!entry) return res.status(404).json({ error: "not found" });
    if (entry.ownerId && entry.ownerId.toString() !== req.user.id)
      return res.status(403).json({ error: "not owner" });
    const { title, body } = req.body;
    if (body) entry.body = sanitizeBody(body);
    if (title !== undefined) entry.title = title;
    await entry.save();
    res.json(entry);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

// delete entry (owner only)
app.delete("/api/entries/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const entry = await Entry.findById(id);
    if (!entry) return res.status(404).json({ error: "not found" });
    if (entry.ownerId && entry.ownerId.toString() !== req.user.id)
      return res.status(403).json({ error: "not owner" });
    await Entry.deleteOne({ _id: id });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

// Serve static frontend files
app.use(express.static("."));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
