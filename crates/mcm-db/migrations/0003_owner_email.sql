-- Use email as the single owner login identifier.
ALTER TABLE users RENAME COLUMN username TO email;
