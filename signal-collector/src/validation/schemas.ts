import { z } from 'zod';
import {
  APPROACH_DIRECTIONS,
  MOVEMENT_TYPES,
  SIGNAL_STATES,
} from '@/types/models';

export const signalStateSchema = z.enum(SIGNAL_STATES);
export const approachDirectionSchema = z.enum(APPROACH_DIRECTIONS);
export const movementTypeSchema = z.enum(MOVEMENT_TYPES);

const uuidSchema = z.string().uuid();

export const observationInputSchema = z.object({
  clientGeneratedId: uuidSchema,
  sessionClientId: uuidSchema,
  state: signalStateSchema,
  observedAt: z.string().datetime({ offset: true }),
  deviceTimestampMs: z.number().int().positive(),
  latitude: z.number().gte(-90).lte(90).nullable(),
  longitude: z.number().gte(-180).lte(180).nullable(),
  headingDegrees: z.number().gte(0).lt(360).nullable(),
  speedMps: z.number().gte(0).nullable(),
  accuracyMeters: z.number().gte(0).nullable(),
  altitudeMeters: z.number().nullable(),
  source: z.enum(['manual', 'import']).default('manual'),
  note: z.string().max(2000).nullable().default(null),
});
export type ObservationInput = z.infer<typeof observationInputSchema>;

export const intersectionInputSchema = z.object({
  clientGeneratedId: uuidSchema,
  name: z.string().trim().min(2).max(200),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  city: z.string().max(120).nullable().default(null),
  state: z.string().max(120).nullable().default(null),
  timezone: z.string().max(64).nullable().default(null),
  source: z.enum(['seed', 'user', 'import']).default('user'),
});
export type IntersectionInput = z.infer<typeof intersectionInputSchema>;

export const sessionInputSchema = z.object({
  clientGeneratedId: uuidSchema,
  intersectionClientId: uuidSchema.nullable(),
  intersectionName: z.string().trim().min(1).max(200),
  approachDirection: approachDirectionSchema,
  movementType: movementTypeSchema,
  movementDescription: z.string().max(500).nullable().default(null),
  startedAt: z.string().datetime({ offset: true }),
  startedAtMs: z.number().int().positive(),
});
export type SessionInput = z.infer<typeof sessionInputSchema>;

export const locationSampleInputSchema = z.object({
  clientGeneratedId: uuidSchema,
  sessionClientId: uuidSchema,
  observedAt: z.string().datetime({ offset: true }),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  headingDegrees: z.number().gte(0).lt(360).nullable(),
  speedMps: z.number().gte(0).nullable(),
  accuracyMeters: z.number().gte(0).nullable(),
});
export type LocationSampleInput = z.infer<typeof locationSampleInputSchema>;

export const envSchema = z.object({
  EXPO_PUBLIC_SUPABASE_URL: z.string().url(),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});
