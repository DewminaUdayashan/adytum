import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AdytumConfig } from '@adytum/shared';

const execAsync = promisify(exec);

export interface StorageResult {
  type: 'postgres-docker' | 'postgres-existing' | 'sqlite';
  connectionString?: string;
  sqlitePath?: string;
}

const DOCKER_CONTAINER_NAME = 'adytum-postgres';
const DOCKER_IMAGE = 'pgvector/pgvector:pg17';
const PG_USER = 'adytum';
const PG_PASSWORD = 'adytum_dev';
const PG_DB = 'adytum';
const PG_PORT = 5432;

/**
 * Auto-provision storage:
 * 1. If DATABASE_URL is set → use existing PostgreSQL
 * 2. If Docker is available → auto-start PostgreSQL + pgvector container
 * 3. Fallback → SQLite + sqlite-vec
 */
export async function autoProvisionStorage(config: AdytumConfig): Promise<StorageResult> {
  // Option 1: Existing PostgreSQL
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    return { type: 'postgres-existing', connectionString: databaseUrl };
  }

  // Option 2: Docker-managed PostgreSQL
  if (await isDockerAvailable()) {
    try {
      const connectionString = await ensureDockerPostgres(config.dataPath);
      return { type: 'postgres-docker', connectionString };
    } catch (error) {
      // Fall through to SQLite
    }
  }

  // Option 3: SQLite fallback
  const sqliteDir = join(config.dataPath, 'sqlite');
  mkdirSync(sqliteDir, { recursive: true });
  const sqlitePath = join(sqliteDir, 'adytum.db');
  return { type: 'sqlite', sqlitePath };
}

async function isDockerAvailable(): Promise<boolean> {
  try {
    await execAsync('docker info', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function ensureDockerPostgres(dataPath: string): Promise<string> {
  // Check if container already exists and is running
  try {
    const { stdout } = await execAsync(
      `docker inspect -f '{{.State.Running}}' ${DOCKER_CONTAINER_NAME}`,
      { timeout: 5000 },
    );

    if (stdout.trim() === 'true') {
      // Container is running
      return `postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DB}`;
    }

    // Container exists but is stopped — start it
    await execAsync(`docker start ${DOCKER_CONTAINER_NAME}`, { timeout: 10000 });
    await waitForPostgres();
    return `postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DB}`;
  } catch {
    // Container doesn't exist — create it
  }

  // Create data volume directory
  const pgDataDir = join(dataPath, 'pgdata');
  mkdirSync(pgDataDir, { recursive: true });

  // Pull and start PostgreSQL with pgvector
  await execAsync(`docker run -d \
    --name ${DOCKER_CONTAINER_NAME} \
    -e POSTGRES_USER=${PG_USER} \
    -e POSTGRES_PASSWORD=${PG_PASSWORD} \
    -e POSTGRES_DB=${PG_DB} \
    -p ${PG_PORT}:5432 \
    -v "${pgDataDir}:/var/lib/postgresql/data" \
    --restart unless-stopped \
    ${DOCKER_IMAGE}`,
    { timeout: 120000 }, // 2 min for image pull
  );

  await waitForPostgres();

  // Enable pgvector extension
  await execAsync(
    `docker exec ${DOCKER_CONTAINER_NAME} psql -U ${PG_USER} -d ${PG_DB} -c "CREATE EXTENSION IF NOT EXISTS vector;"`,
    { timeout: 10000 },
  );

  return `postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DB}`;
}

async function waitForPostgres(maxRetries: number = 30): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await execAsync(
        `docker exec ${DOCKER_CONTAINER_NAME} pg_isready -U ${PG_USER}`,
        { timeout: 3000 },
      );
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('PostgreSQL failed to start within timeout');
}
