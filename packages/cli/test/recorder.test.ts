import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  SessionRecorder,
  parseArgv,
  isMutationCmd,
  type SessionHeader,
  type SessionEvent,
  type SessionFooter,
} from '../src/daemon/recorder';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msw-rec-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readLines(filePath: string): unknown[] {
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe('SessionRecorder', () => {
  it('is idle before any events', () => {
    const r = new SessionRecorder({ cliVersion: '0.4.2', sessionDir: tmpDir });
    expect(r.status().active).toBe(false);
    expect(r.status().sessionId).toBe(null);
  });

  it('lazily opens a session on first record and writes a header', () => {
    const r = new SessionRecorder({ cliVersion: '0.4.2', sessionDir: tmpDir });
    r.record({
      ts: 1000,
      durationMs: 5,
      file: '/tmp/x.map',
      cmd: 'ls',
      args: ['/'],
      status: 'ok',
      exitCode: 0,
      mutation: false,
      stdoutBytes: 42,
      stderrBytes: 0,
    });
    const st = r.status();
    expect(st.active).toBe(true);
    expect(st.eventCount).toBe(1);
    expect(st.filePath).toBeTruthy();

    const lines = readLines(st.filePath!);
    expect(lines).toHaveLength(2); // header + event
    const header = lines[0] as SessionHeader;
    expect(header.kind).toBe('header');
    expect(header.cliVersion).toBe('0.4.2');
    expect(header.sessionId).toMatch(/^s_\d{8}_\d{6}_[0-9a-f]{6}$/);
    const event = lines[1] as SessionEvent;
    expect(event.kind).toBe('event');
    expect(event.client).toBe('ai');
    expect(event.cmd).toBe('ls');
    expect(event.mutation).toBe(false);
    expect(event.id).toBe('evt_000001');
  });

  it('assigns monotonic event ids', () => {
    const r = new SessionRecorder({ cliVersion: '0.4.2', sessionDir: tmpDir });
    for (let i = 0; i < 3; i++) {
      r.record({
        ts: 1000 + i,
        durationMs: 1,
        file: '/x',
        cmd: 'ls',
        args: [],
        status: 'ok',
        exitCode: 0,
        mutation: false,
        stdoutBytes: 0,
        stderrBytes: 0,
      });
    }
    const lines = readLines(r.status().filePath!) as any[];
    const eventIds = lines.filter((l) => l.kind === 'event').map((l) => l.id);
    expect(eventIds).toEqual(['evt_000001', 'evt_000002', 'evt_000003']);
  });

  it('writes a footer on stop and resets state', () => {
    const r = new SessionRecorder({ cliVersion: '0.4.2', sessionDir: tmpDir });
    r.record({
      ts: 1000,
      durationMs: 1,
      file: '/x',
      cmd: 'ls',
      args: [],
      status: 'ok',
      exitCode: 0,
      mutation: false,
      stdoutBytes: 0,
      stderrBytes: 0,
    });
    const file = r.status().filePath!;
    r.stop('manual-stop');

    const lines = readLines(file);
    const footer = lines[lines.length - 1] as SessionFooter;
    expect(footer.kind).toBe('footer');
    expect(footer.exit).toBe('manual-stop');
    expect(footer.eventCount).toBe(1);

    expect(r.status().active).toBe(false);
  });

  it('stop() is a no-op when no session is open', () => {
    const r = new SessionRecorder({ cliVersion: '0.4.2', sessionDir: tmpDir });
    r.stop('shutdown');
    expect(r.status().active).toBe(false);
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  it('openForTest writes labels into the header', () => {
    const r = new SessionRecorder({ cliVersion: '0.4.2', sessionDir: tmpDir });
    r.openForTest({ ai: 'claude-opus-4-7', task: 'spawn' });
    const header = readLines(r.status().filePath!)[0] as SessionHeader;
    expect(header.labels).toEqual({ ai: 'claude-opus-4-7', task: 'spawn' });
  });
});

describe('parseArgv', () => {
  it('peels optional --type', () => {
    expect(parseArgv(['--type', 'map', '/x.map', 'ls'])).toEqual({
      file: '/x.map',
      cmd: 'ls',
      args: [],
    });
  });

  it('defaults cmd to ls when omitted', () => {
    expect(parseArgv(['/x.map'])).toEqual({
      file: '/x.map',
      cmd: 'ls',
      args: [],
    });
  });

  it('returns nulls for --help', () => {
    expect(parseArgv(['--help'])).toEqual({
      file: null,
      cmd: '--help',
      args: [],
    });
  });

  it('keeps trailing args verbatim', () => {
    expect(parseArgv(['/x.map', 'edit-entity', '/p', '--set', 'k=1'])).toEqual({
      file: '/x.map',
      cmd: 'edit-entity',
      args: ['/p', '--set', 'k=1'],
    });
  });
});

describe('isMutationCmd', () => {
  it('flags writers', () => {
    for (const c of ['edit', 'edit-entity', 'edit-component', 'set', 'remove', 'build-world']) {
      expect(isMutationCmd(c)).toBe(true);
    }
  });

  it('does not flag readers', () => {
    for (const c of ['ls', 'read', 'tree', 'summary', 'list-entities', 'read-entity', null]) {
      expect(isMutationCmd(c)).toBe(false);
    }
  });
});
