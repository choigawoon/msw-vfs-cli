// MSW VFS web viewer — HTTP server.
//
// Ported from map_vfs_web.py. Serves an inline HTML/CSS/JS viewer at `/`
// and JSON responses at `/api/{tree,ls,read,stat,search,grep,summary}`.
// Uses Node stdlib `http` — no Express dependency.

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { URL } from 'node:url';

import type { EntitiesVFS } from '../vfs/entities';
import type { MapSummary } from '../vfs/map';
import type { UISummary } from '../vfs/ui';

const TEMPLATE_PATH = path.join(__dirname, 'template.html');
const HTML = fs.readFileSync(TEMPLATE_PATH, 'utf8');

export interface ServeOptions {
  host?: string;
  port?: number;
}

export function startServer(vfs: EntitiesVFS, opts: ServeOptions = {}): http.Server {
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? 8787;

  const server = http.createServer((req, res) => {
    try {
      handle(vfs, req, res);
    } catch (e: any) {
      sendJson(res, 500, { error: String(e?.message ?? e) });
    }
  });
  server.listen(port, host);
  return server;
}

function handle(vfs: EntitiesVFS, req: http.IncomingMessage, res: http.ServerResponse): void {
  if (!req.url) { sendStatus(res, 400); return; }
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (pathname === '/' || pathname === '/index.html') {
    sendHtml(res, HTML);
    return;
  }

  if (!pathname.startsWith('/api/')) { sendStatus(res, 404); return; }

  const endpoint = pathname.slice('/api/'.length);
  const q = url.searchParams;

  switch (endpoint) {
    case 'summary': {
      const base = vfs.summary() as MapSummary | UISummary;
      const entities = vfs.listTopLevelEntities();
      sendJson(res, 200, { ...base, entities });
      return;
    }
    case 'tree': {
      const md = q.get('max_depth');
      sendJson(res, 200, vfs.treeData(q.get('path') ?? '/', md !== null ? parseInt(md, 10) : null));
      return;
    }
    case 'ls': {
      const detail = q.get('detail') === 'true' || q.get('detail') === '1';
      sendJson(res, 200, vfs.ls(q.get('path') ?? '/', detail));
      return;
    }
    case 'read': {
      const compact = q.get('compact') === 'true' || q.get('compact') === '1';
      sendJson(res, 200, vfs.read(q.get('path') ?? '/', compact));
      return;
    }
    case 'stat': {
      sendJson(res, 200, vfs.stat(q.get('path') ?? '/'));
      return;
    }
    case 'search': {
      sendJson(res, 200, vfs.search(q.get('pattern') ?? '*', q.get('path') ?? '/'));
      return;
    }
    case 'grep': {
      sendJson(res, 200, vfs.grep(q.get('pattern') ?? '', q.get('path') ?? '/'));
      return;
    }
    default:
      sendStatus(res, 404);
  }
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  const body = Buffer.from(JSON.stringify(data), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
  });
  res.end(body);
}

function sendHtml(res: http.ServerResponse, text: string): void {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
  });
  res.end(body);
}

function sendStatus(res: http.ServerResponse, status: number): void {
  res.writeHead(status);
  res.end();
}
