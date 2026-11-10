-- Mainichi "Big goals": the few long-term goals shown above the day. One JSONB list per user, written whole.
CREATE TABLE planner_goals (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  goals JSONB NOT NULL DEFAULT '[]'
);
