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
  // REQ-CON1. The spec's data model puts it here: "Project — ... status,
  // recording_consent_state". My first cut invented a separate project_consent
  // table, which was both wrong against the spec and DEVICE-LOCAL -- a second
  // phone on the same job would not know the decision, and a job where recording
  // is unlawful would happily record on the foreman's phone. It belongs on the
  // project row, which PowerSync already syncs both ways.
  recording_consent: column.text,
  consent_basis: column.text,
  consent_jurisdiction: column.text,
  consent_decided_at_ms: column.integer,
  consent_decided_by: column.text,
  // The tenant this project belongs to (376_company_membership). Company members
  // read it; the sync rules use it to decide what downloads.
  company_id: column.text,
  // A single user-applied color label (377; REQ-PM14). Color key or null.
  label: column.text,
});

// The COMPANY tenant + its roster (376). Both sync DOWN (read-only on the client;
// writes go through the server RPCs). company_invite is NOT synced — the owner reads
// invites over PostgREST and hands the token off immediately.
const company = new Table({
  name: column.text,
  owner_id: column.text,
  created_at: column.text,
  // Subscription tier (382). Client READS to lift caps; the store webhook WRITES it.
  plan: column.text,
  // The letterhead mark (402 added the column, 404 the writer). A Storage object key,
  // never a URL — URLs expire and get regenerated; the key is stable and the signed
  // URL is minted at read time. Declared here ONLY so the drawer can read it: the sync
  // rule is already `SELECT * FROM company`, so the value has been arriving on every
  // device since 402 and simply had nowhere to land.
  logo_key: column.text,
});

const company_member = new Table(
  {
    company_id: column.text,
    user_id: column.text,
    role: column.text,     // owner · crew · sub
    status: column.text,   // active · revoked
    invited_by: column.text,
    display_name: column.text,
    joined_at: column.text,
  },
  { indexes: { by_company: ['company_id'] } }
);

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

export const AppSchema = new Schema({ project, capture, capture_op_state, attachment, company, company_member });
export type Database = (typeof AppSchema)['types'];
