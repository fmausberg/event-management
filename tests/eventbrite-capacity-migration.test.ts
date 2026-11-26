import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

it("queues transactional capacity work for all local booking lifecycle paths and existing publications", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TYPE "Platform" AS ENUM ('EVENTBRITE', 'RAUSGEGANGEN');
      CREATE TABLE "Event" (id TEXT PRIMARY KEY, "maxSeats" INTEGER);
      CREATE TABLE "EventbritePublication" ("eventId" TEXT PRIMARY KEY, status TEXT);
      CREATE TABLE "Booking" (id TEXT PRIMARY KEY, "eventId" TEXT, platform "Platform", quantity INTEGER, status TEXT, "userId" TEXT);
      INSERT INTO "Event" VALUES ('event', 10), ('other', 10);
      INSERT INTO "EventbritePublication" VALUES ('event', 'PUBLISHED'), ('other', 'DRAFT');
    `);
    await db.exec(readFileSync(new URL("../prisma/migrations/20261126183000_eventbrite_capacity_sync/migration.sql", import.meta.url), "utf8"));
    const revision = async () => Number((await db.query<{ revision: number }>('SELECT revision FROM "EventbriteCapacitySync" WHERE "eventId" = \'event\'')).rows[0].revision);
    expect(await revision()).toBe(1);
    await db.exec(`UPDATE "EventbriteCapacitySync" SET "syncedRevision" = revision, "retryAt" = NULL;`);
    await db.exec(`INSERT INTO "Booking" VALUES ('local', 'event', NULL, 2, 'PENDING_PAYMENT', NULL);`);
    expect(await revision()).toBeGreaterThan(1);
    let before = await revision();
    await db.exec(`UPDATE "Booking" SET status = 'CONFIRMED' WHERE id = 'local';`);
    expect(await revision()).toBeGreaterThan(before);
    before = await revision();
    await db.exec(`UPDATE "Booking" SET "userId" = 'linked-user' WHERE id = 'local';`);
    expect(await revision()).toBe(before);
    await db.exec(`INSERT INTO "Booking" VALUES ('external', 'event', 'EVENTBRITE', 3, 'CONFIRMED', NULL);`);
    await db.exec(`UPDATE "Booking" SET status = 'CANCELLED' WHERE id = 'external';`);
    expect(await revision()).toBe(before);
    await db.exec(`BEGIN; UPDATE "Booking" SET quantity = 4 WHERE id = 'local'; ROLLBACK;`);
    expect(await revision()).toBe(before);
    await db.exec(`UPDATE "Booking" SET status = 'EXPIRED' WHERE id = 'local';`);
    expect(await revision()).toBeGreaterThan(before);
    before = await revision();
    await db.exec(`UPDATE "Booking" SET status = 'CANCELLED' WHERE id = 'local';`);
    expect(await revision()).toBeGreaterThan(before);
    before = await revision();
    await db.exec(`DELETE FROM "Booking" WHERE id = 'local';`);
    expect(await revision()).toBeGreaterThan(before);
    before = await revision();
    await db.exec(`UPDATE "Event" SET "maxSeats" = 20 WHERE id = 'event';`);
    expect(await revision()).toBeGreaterThan(before);
    await db.exec(`UPDATE "EventbritePublication" SET status = 'PUBLISHED' WHERE "eventId" = 'other';`);
    expect((await db.query('SELECT * FROM "EventbriteCapacitySync" WHERE "eventId" = \'other\'')).rows).toHaveLength(1);
    expect((await db.query<{ retryAt: Date | null }>('SELECT "retryAt" FROM "EventbriteCapacitySync" WHERE "eventId" = \'event\'')).rows[0].retryAt).not.toBeNull();
  } finally { await db.close(); }
}, 30000);
