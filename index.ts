import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import db from "./db";

const app = new Hono();

// --- Auth helpers ---

function randomToken() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
}

async function hashPassword(password: string) {
  return Bun.password.hash(password);
}

async function verifyPassword(password: string, hash: string) {
  return Bun.password.verify(password, hash);
}

function getUser(c: any) {
  const token = getCookie(c, "session");
  if (!token) return null;
  const session = db.query(
    "SELECT s.user_id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?"
  ).get(token) as { user_id: number; username: string } | null;
  return session;
}

// --- Auth routes ---

app.post("/api/register", async (c) => {
  const { username, password } = await c.req.json();
  if (!username?.trim() || !password) return c.json({ error: "Username and password required" }, 400);
  if (username.trim().length < 2) return c.json({ error: "Username must be at least 2 characters" }, 400);
  if (password.length < 6) return c.json({ error: "Password must be at least 6 characters" }, 400);

  const existing = db.query("SELECT id FROM users WHERE username = ?").get(username.trim());
  if (existing) return c.json({ error: "Username already taken" }, 409);

  const hash = await hashPassword(password);
  const user = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?) RETURNING id, username")
    .get(username.trim(), hash) as { id: number; username: string };

  const token = randomToken();
  db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)").run(token, user.id);
  setCookie(c, "session", token, { httpOnly: true, path: "/", maxAge: 60 * 60 * 24 * 30 });

  return c.json({ username: user.username });
});

app.post("/api/login", async (c) => {
  const { username, password } = await c.req.json();
  if (!username || !password) return c.json({ error: "Username and password required" }, 400);

  const user = db.query("SELECT * FROM users WHERE username = ?").get(username) as any;
  if (!user) return c.json({ error: "Invalid username or password" }, 401);

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return c.json({ error: "Invalid username or password" }, 401);

  const token = randomToken();
  db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)").run(token, user.id);
  setCookie(c, "session", token, { httpOnly: true, path: "/", maxAge: 60 * 60 * 24 * 30 });

  return c.json({ username: user.username });
});

app.post("/api/logout", (c) => {
  const token = getCookie(c, "session");
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  deleteCookie(c, "session", { path: "/" });
  return c.json({ ok: true });
});

app.get("/api/me", (c) => {
  const user = getUser(c);
  if (!user) return c.json({ user: null });
  return c.json({ user: { username: user.username } });
});

// --- Todo routes (auth required) ---

app.get("/api/todos", (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const todos = db.query("SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC").all(user.user_id);
  return c.json(todos);
});

app.post("/api/todos", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const { text } = await c.req.json();
  if (!text?.trim()) return c.json({ error: "Text required" }, 400);
  const todo = db.prepare("INSERT INTO todos (user_id, text) VALUES (?, ?) RETURNING *").get(user.user_id, text.trim());
  return c.json(todo, 201);
});

app.patch("/api/todos/:id", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const id = Number(c.req.param("id"));
  const todo = db.query("SELECT * FROM todos WHERE id = ? AND user_id = ?").get(id, user.user_id);
  if (!todo) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json();
  if ("completed" in body) db.prepare("UPDATE todos SET completed = ? WHERE id = ?").run(body.completed ? 1 : 0, id);
  if ("text" in body && body.text?.trim()) db.prepare("UPDATE todos SET text = ? WHERE id = ?").run(body.text.trim(), id);

  return c.json(db.query("SELECT * FROM todos WHERE id = ?").get(id));
});

app.delete("/api/todos/:id", (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const id = Number(c.req.param("id"));
  db.prepare("DELETE FROM todos WHERE id = ? AND user_id = ?").run(id, user.user_id);
  return c.json({ ok: true });
});

app.delete("/api/todos", (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  db.exec(`DELETE FROM todos WHERE completed = 1 AND user_id = ${user.user_id}`);
  return c.json({ ok: true });
});

// Serve frontend
app.use("/*", serveStatic({ root: `${import.meta.dir}/public` }));

export default { port: process.env.PORT || 3000, fetch: app.fetch };
