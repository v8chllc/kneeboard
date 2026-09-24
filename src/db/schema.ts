import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import type { Navlog } from "../domain/navlog";
import type { TrackerSnapshot } from "../domain/tracker";
import { user } from "./auth-schema";

export * from "./auth-schema";

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

export const accountSettings = pgTable(
  "account_settings",
  {
    userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
    pilotId: text("pilot_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check("account_settings_pilot_id_format", sql`${table.pilotId} IS NULL OR ${table.pilotId} ~ '^[0-9]{1,16}$'`),
  ],
);

// One row per user makes the accepted-attempt timestamp and active key an
// atomic reservation boundary. Clearing activeKey retains the short cooldown.
export const loadReservation = pgTable(
  "load_reservation",
  {
    userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
    activeKey: text("active_key"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check("load_reservation_active_requires_attempt", sql`${table.activeKey} IS NULL OR ${table.acceptedAt} IS NOT NULL`),
  ],
);

export const ofpLoad = pgTable(
  "ofp_load",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    flightNumber: text("flight_number").notNull(),
    originIcaoCode: text("origin_icao_code").notNull(),
    destinationIcaoCode: text("destination_icao_code").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    loadedAt: timestamp("loaded_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("ofp_load_user_key_unique").on(table.userId, table.idempotencyKey),
    unique("ofp_load_id_user_unique").on(table.id, table.userId),
    index("ofp_load_recent_by_user_idx").on(table.userId, table.loadedAt.desc(), table.id.desc()),
  ],
);

export const ofpRaw = pgTable("ofp_raw", {
  loadId: uuid("load_id").primaryKey().references(() => ofpLoad.id, { onDelete: "cascade" }),
  payload: jsonb("payload").$type<unknown>().notNull(),
  createdAt: createdAt(),
});

export const tracker = pgTable(
  "tracker",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    loadId: uuid("load_id").notNull().unique(),
    navlog: jsonb("navlog").$type<Navlog>().notNull(),
    snapshot: jsonb("snapshot").$type<TrackerSnapshot>().notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({ columns: [table.loadId, table.userId], foreignColumns: [ofpLoad.id, ofpLoad.userId] }).onDelete("cascade"),
    index("tracker_user_created_idx").on(table.userId, table.createdAt.desc()),
    check("tracker_version_positive", sql`${table.version} >= 1`),
    check("tracker_snapshot_version_matches", sql`${table.snapshot} ->> 'version' IS NOT NULL AND (${table.snapshot} ->> 'version')::integer = ${table.version}`),
  ],
);
