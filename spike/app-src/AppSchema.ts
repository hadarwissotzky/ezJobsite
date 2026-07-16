import { column, Schema, Table } from '@powersync/react-native';

// NOTE: never define `id` — PowerSync creates it automatically.
// Booleans -> column.integer, ISO dates -> column.text (SDK rules).

const project = new Table({
  owner_id: column.text,
  name: column.text,
  status: column.text, // SERVER-owned (predeclaration §2)
  updated_at: column.text,
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
