// Agent interview. A simulated buyer agent questions a seller agent about a product
// for a few turns, then a grader reads the transcript.
//
// The seller is either a stand-in that may answer only from a facts sheet the maker
// supplies ("rehearsal"), or the maker's own agent, replying turn by turn over MCP
// or the JSON API ("external"). Each step is one short request, so an interview
// never has to fit inside a single serverless invocation; the session is held in
// the key-value store between steps.

import { z } from 'zod';
import { clip } from './audience.js';
import { costOf } from './llm.js';

export const INTERVIEW_TURN_ESTIMATE_USD = 0.012;
export const MAX_TURNS = 5;

const BUYER_SYSTEM = `You are a purchasing agent evaluating one software product for a client. You are talking to the vendor's agent.

Ask one question at a time, about what your client would need settled before buying: fit for the need, pricing, integration with what they already use, how their data is handled, proof that it works, limits. If an answer is vague or dodges the question, press once. Do not repeat a question that was answered. Keep each message under 60 words. You do not sell or praise; you find out.`;

const BuyerTurn = z.object({ message: z.string(), finished: z.boolean() });

const OpeningSchema = z.object({ buyer: z.string(), need: z.string(), constraint: z.string(), message: z.string() });

const SELLER_SYSTEM = `You are the vendor's agent answering a prospective buyer's agent.

You may state only what the facts sheet says. If the facts sheet does not cover what you are asked, say plainly that you do not have that information; do not guess, estimate or promise. Keep each answer under 90 words.`;

const SellerTurn = z.object({ message: z.string(), lacked_information: z.boolean() });

const GRADER_SYSTEM = `You are grading a vendor agent's answers to a buyer agent. Be strict and literal. Judge the vendor's answers only; do not reward confident wording.`;

const GradeSchema = z.object({
  turns: z.array(z.object({ turn: z.number().int(), handling: z.enum(['answered', 'partly', 'evaded', 'no_information']), note: z.string() })),
  unsupported_claims: z.array(z.object({ turn: z.number().int(), claim: z.string() })),
  would_shortlist: z.enum(['yes', 'maybe', 'no']),
  verdict: z.string(),
  gaps: z.array(z.string()),
});

const product = (p) => `Product: ${p.name || '(unnamed)'}\nTagline: ${p.tagline}${p.description ? `\nDescription: ${p.description}` : ''}`;
const script = (t) => t.map((m) => `${m.role === 'buyer' ? 'BUYER' : 'VENDOR'}: ${m.text}`).join('\n');

function addUsage(session, res) {
  session.usage.calls++;
  session.usage.input += res.usage?.input ?? 0;
  session.usage.output += res.usage?.output ?? 0;
  session.usage.usd = Math.round(costOf(session.usage) * 1e4) / 1e4;
}

function fail(message) {
  return Object.assign(new Error(message), { status: 503 });
}

/** Opens a session: invents a client and asks the first question. */
export async function startInterview({ model, input, facts = '', mode }) {
  const session = {
    kind: 'interview',
    mode, // 'rehearsal' | 'external'
    input,
    facts: String(facts ?? '').trim().slice(0, 4000),
    client: null,
    transcript: [],
    status: 'awaiting_seller',
    scorecard: null,
    model: model.name,
    usage: { calls: 0, input: 0, output: 0, usd: 0 },
    createdAt: new Date().toISOString(),
  };
  const res = await model.ask({
    tag: 'interview.open',
    system: BUYER_SYSTEM,
    user: `${product(input)}

Invent a realistic client for whom this product could be relevant: who they are (buyer), what they are trying to get done (need) and one firm requirement (constraint). Then write your opening question to the vendor's agent.`,
    schema: OpeningSchema,
    effort: 'low',
    maxTokens: 1500,
  });
  addUsage(session, res);
  if (!res.ok) throw fail(`The buyer agent could not start (${res.reason}). Try again.`);
  session.client = { buyer: clip(res.data.buyer, 160), need: clip(res.data.need, 220), constraint: clip(res.data.constraint, 180) };
  session.transcript.push({ role: 'buyer', text: clip(res.data.message, 500) });
  return session;
}

/** Records the seller's answer, then lets the buyer follow up or close and grade. */
export async function sellerReplies({ model, session, text }) {
  if (session.status !== 'awaiting_seller') throw Object.assign(new Error('This interview has finished.'), { status: 409 });
  const answer = clip(text, 1200);
  if (!answer) throw Object.assign(new Error('The reply is empty.'), { status: 400 });
  session.transcript.push({ role: 'seller', text: answer });
  const turnsDone = session.transcript.filter((m) => m.role === 'seller').length;

  if (turnsDone < MAX_TURNS) {
    const res = await model.ask({
      tag: 'interview.buyer',
      system: BUYER_SYSTEM,
      user: `${product(session.input)}

Your client: ${session.client.buyer}
Need: ${session.client.need}
Firm requirement: ${session.client.constraint}

Conversation so far:
${script(session.transcript)}

You have asked ${turnsDone} of at most ${MAX_TURNS} questions. If you have what you need to advise your client, set finished to true and write a one-sentence closing message. Otherwise ask your next question.`,
      schema: BuyerTurn,
      effort: 'low',
      maxTokens: 1200,
    });
    addUsage(session, res);
    if (!res.ok) throw fail(`The buyer agent did not answer (${res.reason}). Try the turn again.`);
    session.transcript.push({ role: 'buyer', text: clip(res.data.message, 500), closing: res.data.finished || undefined });
    if (!res.data.finished) return session;
  }
  return grade({ model, session });
}

/** Rehearsal only: the stand-in seller answers the pending question from the facts sheet. */
export async function standInAnswers({ model, session }) {
  const res = await model.ask({
    tag: 'interview.seller',
    system: SELLER_SYSTEM,
    user: `${product(session.input)}

Facts sheet (the only source you may use):
${session.facts || '(empty)'}

Conversation so far:
${script(session.transcript)}

Answer the buyer's last message.`,
    schema: SellerTurn,
    effort: 'low',
    maxTokens: 1200,
  });
  addUsage(session, res);
  if (!res.ok) throw fail(`The stand-in seller did not answer (${res.reason}). Try the turn again.`);
  return res.data.message;
}

async function grade({ model, session }) {
  const res = await model.ask({
    tag: 'interview.grade',
    system: GRADER_SYSTEM,
    user: `${product(session.input)}

Client: ${session.client.buyer}. Need: ${session.client.need}. Firm requirement: ${session.client.constraint}.

${session.facts ? `Facts sheet supplied by the maker (the vendor's claims are checked against this):\n${session.facts}` : 'No facts sheet was supplied, so vendor claims cannot be checked. Return an empty unsupported_claims list.'}

Transcript:
${script(session.transcript)}

For each vendor answer, in order (turn 1 is the first vendor answer): was the buyer's question answered, partly answered, evaded, or did the vendor say it had no information? Add a note of at most 20 words.
List any vendor claim that the facts sheet does not support, with its turn.
Would this buyer shortlist the product on this conversation: yes, maybe or no? Give a verdict of at most two sentences.
List the facts the vendor needed and did not have, at most six, each a few words.`,
    schema: GradeSchema,
    effort: 'medium',
    maxTokens: 3000,
  });
  addUsage(session, res);
  if (!res.ok) throw fail(`The interview could not be graded (${res.reason}). Try the turn again.`);
  const answers = session.transcript.filter((m) => m.role === 'seller').length;
  session.scorecard = {
    turns: res.data.turns.filter((t) => t.turn >= 1 && t.turn <= answers).map((t) => ({ turn: t.turn, handling: t.handling, note: clip(t.note, 160) })),
    unsupportedClaims: session.facts ? res.data.unsupported_claims.filter((c) => c.turn >= 1 && c.turn <= answers).map((c) => ({ turn: c.turn, claim: clip(c.claim, 200) })) : [],
    claimsChecked: Boolean(session.facts),
    wouldShortlist: res.data.would_shortlist,
    verdict: clip(res.data.verdict, 400),
    gaps: res.data.gaps.slice(0, 6).map((g) => clip(g, 80)),
  };
  session.status = 'done';
  return session;
}
