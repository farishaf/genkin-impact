-- Fuel: nutrition, body composition and recovery tracking inside Mainichi.
-- Training is not duplicated here: runs and workouts stay in planner_events.
-- Numbers are DOUBLE PRECISION so node-postgres returns JS numbers (NUMERIC comes back as strings).

-- One row per user. Thresholds, day-type weights, sweets cap and race date live in `config`;
-- missing keys fall back to defaults in code (lib/fuel/config.ts), so new settings need no migration.
CREATE TABLE fuel_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  height_cm DOUBLE PRECISION NOT NULL DEFAULT 169,
  sex TEXT NOT NULL DEFAULT 'male' CHECK (sex IN ('male', 'female')),
  birth_year INT NOT NULL DEFAULT 2001,
  goal_profile TEXT NOT NULL DEFAULT 'mileage_fueling' CHECK (goal_profile IN ('mileage_fueling', 'fat_loss_endurance', 'lean_gain')),
  maintenance_override_kcal INT,
  config JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE body_readings (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  measured_at TIMESTAMPTZ NOT NULL,
  weight_kg DOUBLE PRECISION NOT NULL,
  body_fat_pct DOUBLE PRECISION,
  body_fat_mass_kg DOUBLE PRECISION,
  skeletal_muscle_mass_kg DOUBLE PRECISION,
  body_water_pct DOUBLE PRECISION,
  protein_mass_kg DOUBLE PRECISION,
  protein_pct DOUBLE PRECISION,
  bone_mass_kg DOUBLE PRECISION,
  visceral_fat_index DOUBLE PRECISION,
  subcutaneous_fat_pct DOUBLE PRECISION,
  bmr_kcal INT,
  limb_muscle_index DOUBLE PRECISION,
  muscle_rate_pct DOUBLE PRECISION,
  body_age INT,
  bmi DOUBLE PRECISION,
  -- {fat: {right_arm, left_arm, trunk, right_leg, left_leg}, muscle: {...}}; left/right comparison only.
  segmental JSONB,
  context TEXT NOT NULL DEFAULT 'other' CHECK (context IN ('fasted_morning', 'post_run', 'other')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'screenshot')),
  origin TEXT NOT NULL DEFAULT '',
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, measured_at, source, origin)
);

CREATE INDEX body_readings_user_time_idx ON body_readings (user_id, measured_at);

CREATE TABLE tape_measurements (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  waist_cm DOUBLE PRECISION,
  chest_cm DOUBLE PRECISION,
  arm_cm DOUBLE PRECISION,
  thigh_cm DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tape_measurements_user_date_idx ON tape_measurements (user_id, date);

-- Saved foods, per 100 g. Barcode lookups are cached here so a product is fetched once.
CREATE TABLE foods (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  barcode TEXT,
  kcal_100g DOUBLE PRECISION NOT NULL,
  protein_100g DOUBLE PRECISION NOT NULL DEFAULT 0,
  carbs_100g DOUBLE PRECISION NOT NULL DEFAULT 0,
  fat_100g DOUBLE PRECISION NOT NULL DEFAULT 0,
  fiber_100g DOUBLE PRECISION,
  sugar_100g DOUBLE PRECISION,
  serving_g DOUBLE PRECISION,
  is_sweet BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'barcode', 'label', 'usda', 'estimated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, barcode)
);

CREATE INDEX foods_user_name_idx ON foods (user_id, lower(name));

-- Each entry keeps a per-100g snapshot, so editing or deleting a saved food never rewrites history.
CREATE TABLE food_entries (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  eaten_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  food_id UUID REFERENCES foods(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  grams DOUBLE PRECISION NOT NULL,
  kcal_100g DOUBLE PRECISION NOT NULL,
  protein_100g DOUBLE PRECISION NOT NULL,
  carbs_100g DOUBLE PRECISION NOT NULL,
  fat_100g DOUBLE PRECISION NOT NULL,
  fiber_100g DOUBLE PRECISION,
  sugar_100g DOUBLE PRECISION,
  kcal DOUBLE PRECISION NOT NULL,
  protein_g DOUBLE PRECISION NOT NULL,
  carbs_g DOUBLE PRECISION NOT NULL,
  fat_g DOUBLE PRECISION NOT NULL,
  fiber_g DOUBLE PRECISION,
  sugar_g DOUBLE PRECISION,
  is_sweet BOOLEAN NOT NULL DEFAULT false,
  is_planned BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('barcode', 'label', 'photo', 'text', 'manual', 'saved')),
  confidence DOUBLE PRECISION,
  image_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX food_entries_user_date_idx ON food_entries (user_id, date);

-- Per-day facts that aren't food: a day-type override and recovery numbers.
CREATE TABLE fuel_days (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  day_type TEXT CHECK (day_type IN ('hard', 'easy', 'rest')),
  sleep_h DOUBLE PRECISION,
  resting_hr INT,
  steps INT,
  soreness INT CHECK (soreness BETWEEN 1 AND 5),
  PRIMARY KEY (user_id, date)
);
