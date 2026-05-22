-- Table schema is managed by the application migration system (lib/migrate.ts + migrations/).
-- This file exists solely so the MySQL docker-entrypoint-initdb.d/ init has a database
-- to connect to before the app starts and runs migrations on first boot.
CREATE DATABASE IF NOT EXISTS producer;
