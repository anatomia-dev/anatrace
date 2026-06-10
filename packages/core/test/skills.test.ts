import { describe, it, expect } from 'vitest';
import { claudeAdapter } from '../src/adapters/claude.js';
import { codexAdapter } from '../src/adapters/codex.js';
import { skillsInvoked, matchAnnouncedSkills } from '../src/skills.js';
import { deriveCounts } from '../src/derive.js';
import type { NamedBlob } from '../src/adapter.js';
import type { NormalizedSession } from '../src/session.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const jsonl = (objs: unknown[]): string => objs.map((o) => JSON.stringify(o)).join('\n');

describe('B2 — SkillEvent consumer wired (render reader; never a ProvenanceCounts field)', () => {
  it('Claude Skill-tool invocation → SkillEvent source:"tool" (high-confidence), consumed by skillsInvoked', () => {
    const lines = jsonl([
      {
        type: 'assistant',
        sessionId: 's',
        uuid: 'a1',
        timestamp: '2026-06-08T00:00:01.000Z',
        message: {
          id: 'm1',
          role: 'assistant',
          model: 'claude-opus-4-8',
          content: [{ type: 'tool_use', name: 'Skill', input: { command: 'testing-standards' } }],
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
    ]);
    const s = claudeAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    expect(skillsInvoked(s)).toEqual([{ skill: 'testing-standards', source: 'tool' }]);
  });

  it('Codex announce-string → SkillEvent source:"announce-text" (low-confidence, OQ5)', () => {
    const lines = jsonl([
      { type: 'session_meta', timestamp: '2026-06-08T00:00:00.000Z', payload: { id: 'sc', originator: 'codex_cli', cli_version: '0.9' } },
      { type: 'turn_context', timestamp: '2026-06-08T00:00:01.000Z', payload: { model: 'gpt-5.5' } },
      { type: 'response_item', timestamp: '2026-06-08T00:00:02.000Z', payload: { type: 'message', role: 'assistant', content: [{ type: 'text', text: "I'm using the test-driven-development skill now." }] } },
    ]);
    const s = codexAdapter.parse([{ name: 'parent', bytes: enc(lines) }])!;
    expect(skillsInvoked(s)).toEqual([{ skill: 'test-driven-development', source: 'announce-text' }]);
  });

  it('matchAnnouncedSkills is conservative (matches the announce convention, not arbitrary prose)', () => {
    expect(matchAnnouncedSkills('using the foo skill')).toEqual(['foo']);
    expect(matchAnnouncedSkills("I'm using 'bar-baz' skill")).toEqual(['bar-baz']);
    expect(matchAnnouncedSkills('we should be skilled at this')).toEqual([]); // no false positive
    expect(matchAnnouncedSkills('the skill issue')).toEqual([]);
  });

  it('ACCEPTANCE — adding skill events leaves ProvenanceCounts byte-identical (M5 bit-freeze)', () => {
    const baseEvents = [
      { type: 'message' as const, role: 'assistant' as const, model: 'm', agent: { kind: 'root' as const }, blobName: 'p', lineIndex: 0, ts: 1000 },
      { type: 'usage' as const, usage: { input: 5, output: 5, cache_create: 0, cache_read: 0 }, messageId: 'm1', isSidechain: false, cumulative: false, agent: { kind: 'root' as const }, blobName: 'p', lineIndex: 1, ts: 1000 },
    ];
    const withSkill = [
      ...baseEvents,
      { type: 'skill' as const, skill: 'x', source: 'announce-text' as const, agent: { kind: 'root' as const }, blobName: 'p', lineIndex: 2, ts: 1000 },
    ];
    const a = deriveCounts({ events: baseEvents } as unknown as NormalizedSession);
    const b = deriveCounts({ events: withSkill } as unknown as NormalizedSession);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a)); // skill events never touch counts
  });

  it('dedupes distinct skills; tool source outranks announce-text for the same skill', () => {
    const events = [
      { type: 'skill' as const, skill: 'a', source: 'announce-text' as const, agent: { kind: 'root' as const }, blobName: 'p', lineIndex: 0 },
      { type: 'skill' as const, skill: 'a', source: 'tool' as const, agent: { kind: 'root' as const }, blobName: 'p', lineIndex: 1 },
      { type: 'skill' as const, skill: 'b', source: 'tool' as const, agent: { kind: 'root' as const }, blobName: 'p', lineIndex: 2 },
    ];
    const inv = skillsInvoked({ events } as unknown as NormalizedSession);
    expect(inv).toEqual([{ skill: 'a', source: 'tool' }, { skill: 'b', source: 'tool' }]);
  });
});
