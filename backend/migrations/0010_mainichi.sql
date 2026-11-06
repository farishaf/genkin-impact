-- Mainichi: personal daily planner (calendar, workouts, daily to-dos, pages).
-- Nested lists (exercises/sets, todos, checklists) are JSONB documents written whole on each save:
-- single-user data, last write wins.

CREATE TABLE planner_routines (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  focus TEXT NOT NULL DEFAULT '',
  exercises JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX planner_routines_user_idx ON planner_routines (user_id, created_at);

CREATE TABLE planner_events (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('workout', 'run', 'event')),
  title TEXT NOT NULL,
  time TEXT,
  notes TEXT NOT NULL DEFAULT '',
  done BOOLEAN NOT NULL DEFAULT false,
  -- run: {km, pace, detail}; workout: {routine_id, focus, exercises}; event: {}
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX planner_events_user_date_idx ON planner_events (user_id, date);

CREATE TABLE planner_pages (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  icon TEXT NOT NULL DEFAULT '📄',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  checklist JSONB NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX planner_pages_user_idx ON planner_pages (user_id, updated_at DESC);

CREATE TABLE planner_days (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  todos JSONB NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, date)
);
