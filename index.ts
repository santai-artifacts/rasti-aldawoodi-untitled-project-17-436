import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import db from "./db";

const app = new Hono();

// API routes
app.get("/api/todos", (c) => {
  const todos = db.query("SELECT * FROM todos ORDER BY created_at DESC").all();
  return c.json(todos);
});

app.post("/api/todos", async (c) => {
  const { text } = await c.req.json();
  if (!text?.trim()) return c.json({ error: "Text required" }, 400);
  const stmt = db.prepare("INSERT INTO todos (text) VALUES (?) RETURNING *");
  const todo = stmt.get(text.trim());
  return c.json(todo, 201);
});

app.patch("/api/todos/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const todo = db.query("SELECT * FROM todos WHERE id = ?").get(id);
  if (!todo) return c.json({ error: "Not found" }, 404);

  if ("completed" in body) {
    db.prepare("UPDATE todos SET completed = ? WHERE id = ?").run(body.completed ? 1 : 0, id);
  }
  if ("text" in body && body.text?.trim()) {
    db.prepare("UPDATE todos SET text = ? WHERE id = ?").run(body.text.trim(), id);
  }

  return c.json(db.query("SELECT * FROM todos WHERE id = ?").get(id));
});

app.delete("/api/todos/:id", (c) => {
  const id = Number(c.req.param("id"));
  db.prepare("DELETE FROM todos WHERE id = ?").run(id);
  return c.json({ ok: true });
});

app.delete("/api/todos", (c) => {
  db.exec("DELETE FROM todos WHERE completed = 1");
  return c.json({ ok: true });
});

// Serve static files
app.use("/*", serveStatic({ root: `${import.meta.dir}/public` }));

export default { port: process.env.PORT || 3000, fetch: app.fetch };
