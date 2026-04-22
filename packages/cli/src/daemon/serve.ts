// Persistent stdin/stdout pipe mode.
//
// Usage: `msw-vfs serve`
//
// Reads newline-delimited JSON requests on stdin:
//   {"id": <any>?, "argv": ["file.map", "summary"]}
// Writes newline-delimited JSON responses on stdout:
//   {"id": <echoed>, "stdout": "...", "stderr": "...", "code": N}
// Signals readiness by writing 'ready\n' to stderr once the event loop
// starts consuming stdin — consumers may wait on that before piping.
//
// A single Node process handles unbounded sequential requests with shared
// in-process VFS cache, so Node startup cost is amortized and heavy JSON
// parsing of .map files happens at most once per file.

import * as readline from 'node:readline';

import { installInterceptors, runCaptured } from './capture';
import { installCacheFactories } from './cache';

export interface ServePipeOptions {
  dispatch: (argv: string[]) => number;
  /** If true, exit(0) on EOF. Default: true. */
  exitOnClose?: boolean;
}

export function runServePipe(opts: ServePipeOptions): Promise<number> {
  installInterceptors();
  installCacheFactories();

  const exitOnClose = opts.exitOnClose ?? true;

  // Signal readiness AFTER the readline interface is wired, so consumers
  // that pipe eagerly (printf '...' | msw-vfs serve) don't race.
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
    terminal: false,
  });

  process.stderr.write('ready\n');

  return new Promise<number>((resolve) => {
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let req: any;
      try {
        req = JSON.parse(trimmed);
      } catch (e: any) {
        writeResponse(undefined, {
          stdout: '',
          stderr: `msw-vfs serve: invalid JSON (${e.message})\n`,
          code: 1,
        });
        return;
      }

      const id = req.id;
      if (!Array.isArray(req.argv)) {
        writeResponse(id, {
          stdout: '',
          stderr: 'msw-vfs serve: "argv" must be an array of strings\n',
          code: 1,
        });
        return;
      }

      const result = runCaptured(() => {
        opts.dispatch(['node', 'msw-vfs', ...req.argv]);
      });
      writeResponse(id, result);
    });

    rl.on('close', () => {
      if (exitOnClose) resolve(0);
    });
  });
}

function writeResponse(
  id: any,
  result: { stdout: string; stderr: string; code: number },
): void {
  const payload = id === undefined ? result : { id, ...result };
  process.stdout.write(JSON.stringify(payload) + '\n');
}
