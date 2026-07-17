import { column, Schema, Table } from '@powersync/react-native';

// NOTE: never define `id` — PowerSync creates it automatically.
// Booleans -> column.integer, ISO dates -> column.text (SDK rules).

const project = new Table({
  owner_id: column.text,
  name: column.text,
  status: column.text, // SERVER-owned (predeclaration §2)
  updated_at: column.text,
  // REQ-SET1: "address/geofence/client so resolution and evidence have a home".
  // These live on the POWERSYNC table, not an app-owned one. A project is a
  // mutable relational row -- exactly what PowerSync exists to sync. Captures need
  // an owned queue because they are append-only evidence whose commitment only
  // SQLite can know; a jobsite address is not evidence. Building a second sync
  // engine beside the one we adopted would be pattern-matching, not design.
  address: column.text,
  lat: column.real,
  lng: column.real,
  // How close counts as "on this job". Defaulted, never asked -- nobody on a
  // ladder is choosing a radius in metres.
  geofence_m: column.integer,
  client_ref: column.text,
  created_at_ms: column.integer,
  // REQ-P1 context signal: the job you were just on is the job you are probably
  // still on. Carries the no-GPS case.
  last_used_ms: column.integer,
});

const capture = new Table(
  {
    owner_id: column.text,
    project_id: column.text,
    seq: column.integer, // Q1 negative control — proves the inversion happened
    trial: column.integer,
    label: column.text,
    payload: column.text,
    payload_sha256: column.text,
    client_created_at: column.text,
    inserted_at: column.text,
  },
  { indexes: { by_project: ['project_id'] } }
);

const capture_op_state = new Table({
  capture_id: column.text,
  owner_id: column.text,
  project_id: column.text,
  processing_state: column.text,  // SERVER-owned  -> client writes must be REJECTED
  resolution_status: column.text, // CLIENT-owned  -> pending offline edit must WIN
  updated_at: column.text,
});

const attachment = new Table({
  capture_id: column.text,
  owner_id: column.text,
  project_id: column.text,
  object_key: column.text,
  ciphertext_sha256: column.text,
  ciphertext_len: column.integer,
  wrapped_dek_device: column.text,
  wrapped_dek_server: column.text,
  aead_nonce: column.text,
  aead_alg: column.text,
  state: column.text,
});

export const AppSchema = new Schema({ project, capture, capture_op_state, attachment });
export type Database = (typeof AppSchema)['types'];
