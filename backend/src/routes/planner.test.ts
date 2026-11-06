import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  await pool.query("DELETE FROM planner_events");
  await pool.query("DELETE FROM planner_routines");
  await pool.query("DELETE FROM planner_days");
  await pool.query("DELETE FROM planner_pages");
  await pool.query("DELETE FROM transaction_tags");
  await pool.query("UPDATE transactions SET installment_plan_id = NULL WHERE installment_plan_id IS NOT NULL");
  await pool.query("DELETE FROM installment_plans");
  await pool.query("DELETE FROM transactions");
  await pool.query("DELETE FROM budgets");
  await pool.query("DELETE FROM savings_goals");
  await pool.query("DELETE FROM recurring_rules");
  await pool.query("DELETE FROM accounts");
  await pool.query("DELETE FROM sessions");
  await pool.query("DELETE FROM members");
  await pool.query("DELETE FROM categories");
  await pool.query("DELETE FROM tags");
  await pool.query("DELETE FROM saved_filters");
  await pool.query("DELETE FROM users");
});

afterAll(async () => {
  await pool.end();
});

async function registerAndLogin(email = "planner@example.com") {
  const agent = request.agent(app);
  await agent.post("/auth/register").send({ email, password: "password12345", display_name: "Planner User" });
  return agent;
}

const benchPress = {
  id: "x1",
  name: "Bench press",
  note: "Pause on chest",
  sets: [
    { id: "s1", reps: "6", kg: "60", done: false },
    { id: "s2", reps: "6", kg: "60", done: false },
  ],
};

describe("/planner/events", () => {
  it("creates a run, lists it in range, updates and deletes it", async () => {
    const agent = await registerAndLogin();

    const created = await agent.post("/planner/events").send({
      date: "2026-11-03",
      type: "run",
      title: "Easy run",
      details: { km: "5", pace: "7:00" },
    });
    expect(created.status).toBe(201);
    expect(created.body.events).toHaveLength(1);
    const id = created.body.events[0].id;
    expect(created.body.events[0].date).toBe("2026-11-03");
    expect(created.body.events[0].details).toEqual({ km: "5", pace: "7:00" });

    const inRange = await agent.get("/planner/events?from=2026-11-01&to=2026-11-30");
    expect(inRange.body.events).toHaveLength(1);
    const outOfRange = await agent.get("/planner/events?from=2026-12-01&to=2026-12-31");
    expect(outOfRange.body.events).toHaveLength(0);

    const patched = await agent.patch(`/planner/events/${id}`).send({ done: true, date: "2026-11-04" });
    expect(patched.status).toBe(200);
    expect(patched.body.event.done).toBe(true);
    expect(patched.body.event.date).toBe("2026-11-04");
    expect(patched.body.event.title).toBe("Easy run");

    expect((await agent.delete(`/planner/events/${id}`)).status).toBe(204);
    expect((await agent.get(`/planner/events/${id}`)).status).toBe(404);
  });

  it("stores a structured run (steps and repeat blocks)", async () => {
    const agent = await registerAndLogin();
    const segments = [
      { id: "w", rounds: 1, steps: [{ id: "w1", kind: "warmup", amount: "1.5", unit: "km", pace: "6:30", note: "" }] },
      {
        id: "i",
        rounds: 6,
        steps: [
          { id: "i1", kind: "run", amount: "400", unit: "m", intensity: "pace", pace: "4:30", paceTo: "4:45", note: "" },
          { id: "i2", kind: "recovery", amount: "90", unit: "s", intensity: "hr", pace: "", hrLow: "120", hrHigh: "140", note: "walk" },
        ],
      },
    ];
    const created = await agent.post("/planner/events").send({ date: "2026-11-03", type: "run", title: "Intervals", details: { km: "3.9", segments } });
    expect(created.status).toBe(201);
    expect(created.body.events[0].details.segments).toEqual(segments);

    const bad = await agent.post("/planner/events").send({
      date: "2026-11-03", type: "run", title: "Bad", details: { segments: [{ id: "x", rounds: 0, steps: [] }] },
    });
    expect(bad.status).toBe(400);
  });

  it("repeats an item weekly", async () => {
    const agent = await registerAndLogin();
    const created = await agent.post("/planner/events").send({ date: "2026-11-02", type: "event", title: "Physio", repeat_weeks: 3 });
    expect(created.body.events.map((e: { date: string }) => e.date)).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
  });

  it("copies routine exercises into a workout; ticking the session leaves the routine untouched", async () => {
    const agent = await registerAndLogin();
    const routine = await agent.post("/planner/routines").send({ title: "Upper A", focus: "Push", exercises: [benchPress] });
    expect(routine.status).toBe(201);

    const created = await agent.post("/planner/events").send({
      date: "2026-11-02",
      type: "workout",
      title: "Upper A",
      routine_id: routine.body.routine.id,
    });
    const event = created.body.events[0];
    expect(event.details.focus).toBe("Push");
    expect(event.details.exercises[0].name).toBe("Bench press");
    expect(event.details.exercises[0].sets).toHaveLength(2);

    const exercises = event.details.exercises;
    exercises[0].sets[0].done = true;
    exercises[0].sets.push({ id: "extra", reps: "6", kg: "62.5", done: true });
    const patched = await agent.patch(`/planner/events/${event.id}`).send({ details: { ...event.details, exercises } });
    expect(patched.body.event.details.exercises[0].sets).toHaveLength(3);

    const routineAfter = await agent.get(`/planner/routines/${routine.body.routine.id}`);
    expect(routineAfter.body.routine.exercises[0].sets).toHaveLength(2);
    expect(routineAfter.body.routine.exercises[0].sets[0].done).toBe(false);
  });

  it("validates the date range query", async () => {
    const agent = await registerAndLogin();
    expect((await agent.get("/planner/events?from=nope&to=2026-11-30")).status).toBe(400);
  });

  it("isolates users and 404s malformed ids", async () => {
    const agentA = await registerAndLogin("a-planner@example.com");
    const agentB = await registerAndLogin("b-planner@example.com");
    const created = await agentA.post("/planner/events").send({ date: "2026-11-02", type: "event", title: "Dentist" });
    const id = created.body.events[0].id;

    expect((await agentB.get("/planner/events?from=2026-11-01&to=2026-11-30")).body.events).toHaveLength(0);
    expect((await agentB.patch(`/planner/events/${id}`).send({ done: true })).status).toBe(404);
    expect((await agentB.delete(`/planner/events/${id}`)).status).toBe(404);
    expect((await agentA.get("/planner/events/not-a-uuid")).status).toBe(404);
  });

  it("requires auth", async () => {
    expect((await request(app).get("/planner/pages")).status).toBe(401);
  });
});

describe("/planner/days", () => {
  it("returns an empty day by default and upserts todos + notes", async () => {
    const agent = await registerAndLogin();

    const empty = await agent.get("/planner/days/2026-10-31");
    expect(empty.body.day).toEqual({ date: "2026-10-31", todos: [], notes: "" });

    const todos = [{ id: "t1", text: "Japanese study", done: false, page_id: null }];
    const put1 = await agent.put("/planner/days/2026-10-31").send({ todos, notes: "Slept 7h" });
    expect(put1.status).toBe(200);
    const put2 = await agent.put("/planner/days/2026-10-31").send({ todos: [{ ...todos[0], done: true }], notes: "Slept 7h" });
    expect(put2.body.day.todos[0].done).toBe(true);

    const got = await agent.get("/planner/days/2026-10-31");
    expect(got.body.day.todos).toHaveLength(1);
    expect(got.body.day.notes).toBe("Slept 7h");
    expect((await agent.get("/planner/days/31-10-2026")).status).toBe(400);
  });
});

describe("/planner/pages", () => {
  it("creates, edits checklist, and unlinks todos on delete", async () => {
    const agent = await registerAndLogin();

    const created = await agent.post("/planner/pages").send({ title: "Japanese study" });
    expect(created.status).toBe(201);
    const page = created.body.page;
    expect(page.icon).toBe("📄");

    const patched = await agent.patch(`/planner/pages/${page.id}`).send({
      icon: "🗾",
      description: "Toward JLPT N3",
      checklist: [{ id: "c1", text: "Anki reviews", done: true }],
      notes: "〜てしまう",
    });
    expect(patched.body.page.checklist).toEqual([{ id: "c1", text: "Anki reviews", done: true }]);
    expect(patched.body.page.title).toBe("Japanese study");

    await agent.put("/planner/days/2026-10-31").send({
      todos: [
        { id: "t1", text: "Japanese study", done: false, page_id: page.id },
        { id: "t2", text: "Laundry", done: false, page_id: null },
      ],
      notes: "",
    });

    expect((await agent.delete(`/planner/pages/${page.id}`)).status).toBe(204);
    const day = await agent.get("/planner/days/2026-10-31");
    expect(day.body.day.todos.map((t: { page_id: string | null }) => t.page_id)).toEqual([null, null]);
    expect((await agent.get("/planner/pages")).body.pages).toHaveLength(0);
  });
});
