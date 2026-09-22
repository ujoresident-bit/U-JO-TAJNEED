-- Migration: Add is_active column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
UPDATE users SET is_active = TRUE WHERE is_active IS NULL;
