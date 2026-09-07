/**
 * Every write the console makes. There are four, and the list is short on purpose.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *   · Creating a change order. The desk does not capture. 427 grants the office UPDATE
 *     and not INSERT, so this is enforced in the database and not merely omitted here.
 *   · Deleting anything. 390 refuses it past draft and nothing here asks.
 *   · Approving or declining. That is the CLIENT's act, through their own link, under
 *     their own signature. A contractor-side "mark as approved" would be the product
 *     forging the one thing it exists to prove.
 *
 * EVERY WRITE BELOW CAN BE REFUSED BY THE DATABASE, AND THAT IS THE DESIGN. 383's
 * trigger refuses a change to frozen terms once a change order is sent; 384 refuses an
 * illegal status move; 427's policy refuses a non-owner. So the functions here do not
 * pre-check permission and then write — they write, and turn a refusal into a sentence
 * a person can act on. A client-side guard that agrees with the server is duplication;
 * one that disagrees is a lie.
 */
import { supabase } from '../supabase.ts';
import type { LineItem } from './types.ts';

/** PostgREST/Postgres codes that mean "this will never work", with what to say. */
const REFUSALS: Record<string, string> = {
  '42501': 'The database refused this. You need to be the company owner to change a '
    + "teammate's change order.",
  '23514': 'The database refused this because the values do not hold together — most '
    + 'often a breakdown that does not add up to the total.',
  '23505': 'That has already been recorded.',
};

function explain(where: string, e: { code?: string; message: string }): Error {
  const known = e.code ? REFUSALS[e.code] : undefined;
  // The raw message is kept on the end even when we have a friendly one. A support
  // conversation that starts from "it says it refused it" and cannot get to the code
  // is the confirm.html failure again: a real error with nowhere to put itself.
  return new Error(known ? `${known} (${where}: ${e.message})` : `${where}: ${e.message}`);
}

/**
 * Edit the wording a client will read.
 *
 * Writes BOTH `scope` and `scope_of_work`. They are not duplicates: `scope` is the
 * one-line title the ledger rows show and `scope_of_work` is the long form on the
 * record. Editing the long form and leaving the title behind is how the same change
 * order ends up saying two different things about itself on two screens.
 *
 * `WHERE status = 'draft'` is stated here as well as trusted from 383 — not because
 * the trigger might fail, but because a filtered UPDATE that matches nothing returns
 * cleanly, and the caller can then say "this was sent while you were typing" instead
 * of reporting success for a write that changed no rows.
 */
export async function saveScope(
  changeOrderId: string, title: string, longForm: string,
): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) {
    // `scope` is `check (length(scope) > 0)`. Refusing here gives a sentence instead
    // of a constraint name.
    throw new Error('A change order needs a description. Type what the work is.');
  }
  const { data, error } = await supabase
    .from('change_order')
    .update({ scope: trimmed, scope_of_work: longForm.trim() || null })
    .eq('id', changeOrderId)
    .eq('status', 'draft')
    .select('id');
  if (error) throw explain('saveScope', error);
  if (!data || data.length === 0) {
    throw new Error(
      'Nothing was saved — this change order is no longer a draft. Once it has gone to '
      + 'the client its wording is frozen, and a change now goes out as a new version.',
    );
  }
}

/**
 * Put a price on a draft, with or without a breakdown.
 *
 * THE SUM IS CHECKED HERE TOO. `change_order_line_items_total` (070) refuses a
 * breakdown whose lines do not add up to `amount_cents`, and being refused by a check
 * constraint tells a person almost nothing. Checking first means the message can name
 * the two figures and their difference. The constraint stays the authority; this is
 * only the better sentence.
 */
export async function savePrice(
  changeOrderId: string, amountCents: number, lines: LineItem[],
): Promise<void> {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error('A price has to be a whole number of cents, and not negative.');
  }
  if (lines.length > 0) {
    const sum = lines.reduce((n, l) => n + l.total_cents, 0);
    if (sum !== amountCents) {
      throw new Error(
        `The breakdown adds up to ${(sum / 100).toFixed(2)} but the total says `
        + `${(amountCents / 100).toFixed(2)}. Fix one of them before saving — a change `
        + 'order that contradicts itself cannot be sent.',
      );
    }
  }
  const { data, error } = await supabase
    .from('change_order')
    .update({ amount_cents: amountCents, line_items: lines })
    .eq('id', changeOrderId)
    .eq('status', 'draft')
    .select('id');
  if (error) throw explain('savePrice', error);
  if (!data || data.length === 0) {
    throw new Error(
      'Nothing was saved — this change order is no longer a draft. A price change after '
      + 'it has gone out has to be sent as a new version.',
    );
  }
}

/** SHA-256 of a string, hex. Web Crypto, so the console adds no hashing dependency. */
async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Answer the client on a change order.
 *
 * Goes through `ingest_r5b_v1` rather than inserting into `confirmation_reply`
 * directly, and the reason is in 308: THE CALLER DOES NOT CHOOSE THE TOKEN. A reply
 * has to land against the change order's ONE live link, and the server is the only
 * thing that knows which that is. A console holding a token it read a minute ago could
 * reply against a version the contractor has already revised — the "two different
 * numbers" failure, from the conversation's side.
 *
 * The mutation id and payload hash mirror `discussionstore.ts` exactly, because the
 * server's replay guard compares them: same `m-reply-<id>` shape, same payload fields,
 * same `JSON.stringify` of them. A retry of this call is then indistinguishable from a
 * retry from a phone, and returns `already_applied` instead of a second message.
 *
 * Returns 'sent' or 'no_live_link' — the second is not an error. 308 is explicit that
 * there is nothing to retry towards: the client answered or the version was replaced
 * while this was being typed, and the honest response is to say so, not to fail.
 */
export async function postClientReply(
  changeOrderId: string, body: string, ownerId: string,
): Promise<'sent' | 'no_live_link'> {
  const text = body.trim();
  if (!text) throw new Error('An empty reply is not a reply.');

  const id = crypto.randomUUID();
  const at = Date.now();
  const payload = { id, change_order_id: changeOrderId, body: text, at_ms: at, owner_id: ownerId };
  const json = JSON.stringify(payload);

  const { data, error } = await supabase.rpc('ingest_r5b_v1', {
    p_mutation_id: `m-reply-${id}`,
    p_kind: 'reply',
    p_id: id,
    p_owner_id: ownerId,
    p_change_order_id: changeOrderId,
    p_body: text,
    p_at_ms: at,
    p_request_sha256: await sha256Hex(json),
  });
  if (error) throw explain('postClientReply', error);
  return (data as { status?: string })?.status === 'no_live_link' ? 'no_live_link' : 'sent';
}

/**
 * Say something to the crew on a change order.
 *
 * The one write on this list that needed no migration: 380 already scopes `co_comment`
 * company-wide for read and "you write AS yourself, on a project you can see" for
 * insert. Append-only — there is no edit and no delete, by that file's trigger.
 *
 * `author_name` is denormalised onto the row on purpose (380 carries `project_id` the
 * same way): a message has to keep reading correctly after the person who wrote it
 * leaves the company and their membership row goes.
 */
export async function postTeamComment(
  changeOrderId: string, projectId: string, authorId: string,
  authorName: string | null, body: string,
): Promise<void> {
  const text = body.trim();
  if (!text) throw new Error('An empty message is not a message.');
  const { error } = await supabase.from('co_comment').insert({
    id: crypto.randomUUID(),
    change_order_id: changeOrderId,
    project_id: projectId,
    author_id: authorId,
    author_name: authorName,
    body: text,
    at_ms: Date.now(),
  });
  if (error) throw explain('postTeamComment', error);
}
