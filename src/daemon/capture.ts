// Intercepts process.stdout.write, process.stderr.write, and process.exit
// within a request scope so the daemon can run existing CLI handlers
// unmodified and collect their output.
//
// Uses AsyncLocalStorage — concurrent requests each see their own buffer.

import { AsyncLocalStorage } from 'node:async_hooks';

export interface CaptureCtx {
  out: string[];
  err: string[];
  code: number;
}

export class ExitSignal extends Error {
  constructor(public code: number) {
    super(`process.exit(${code}) intercepted`);
  }
}

const store = new AsyncLocalStorage<CaptureCtx>();
let installed = false;

export function installInterceptors(): void {
  if (installed) return;
  installed = true;

  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  const origExit = process.exit.bind(process);

  (process.stdout as any).write = function (chunk: any, encOrCb?: any, cb?: any) {
    const ctx = store.getStore();
    if (ctx) {
      ctx.out.push(typeof chunk === 'string' ? chunk : chunk?.toString?.() ?? String(chunk));
      if (typeof encOrCb === 'function') encOrCb();
      else if (typeof cb === 'function') cb();
      return true;
    }
    return origOut(chunk, encOrCb, cb);
  };

  (process.stderr as any).write = function (chunk: any, encOrCb?: any, cb?: any) {
    const ctx = store.getStore();
    if (ctx) {
      ctx.err.push(typeof chunk === 'string' ? chunk : chunk?.toString?.() ?? String(chunk));
      if (typeof encOrCb === 'function') encOrCb();
      else if (typeof cb === 'function') cb();
      return true;
    }
    return origErr(chunk, encOrCb, cb);
  };

  (process as any).exit = function (code?: number): never {
    const ctx = store.getStore();
    if (ctx) {
      ctx.code = code ?? 0;
      throw new ExitSignal(ctx.code);
    }
    return origExit(code as any);
  };
}

export interface CaptureResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function runCaptured(fn: () => void): CaptureResult {
  const ctx: CaptureCtx = { out: [], err: [], code: 0 };
  return store.run(ctx, () => {
    try {
      fn();
    } catch (e) {
      if (e instanceof ExitSignal) {
        // expected; code is already recorded
      } else {
        ctx.err.push(`${(e as any)?.stack ?? e}\n`);
        ctx.code = 1;
      }
    }
    return {
      stdout: ctx.out.join(''),
      stderr: ctx.err.join(''),
      code: ctx.code,
    };
  });
}
