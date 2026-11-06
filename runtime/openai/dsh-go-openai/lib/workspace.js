import { constants } from 'node:fs';
import { mkdtemp, open, realpath, rm } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative } from 'node:path';
import { MAX_BYTES, OpenAIError } from './client.js';

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.json': 'application/json', '.jsonl': 'application/jsonl', '.txt': 'text/plain', '.zip': 'application/zip', '.csv': 'text/csv' };
const within = (parent, child) => { const rel = relative(parent, child); return rel === '' || !rel.startsWith('..') && !isAbsolute(rel); };
const deny = () => { throw new OpenAIError('OPENAI_WORKSPACE_DENIED'); };

export function workspaceIO(ctx, exec) {
  const agent = exec.agent, session = agent?.session;
  if (!session?.id) deny();
  function live(signal) {
    signal.throwIfAborted(); ctx.fiber.assertActive(); agent.ctx.fiber.assertActive();
    if (agent.session !== session || exec.agent !== agent) deny();
  }
  async function scope(signal, write = false) {
    live(signal);
    const cwd = await ctx.workingDirectory.ensure(agent, signal);
    live(signal);
    const policy = ctx.sandboxPolicy.resolve({ session });
    if (!policy?.workspaceRoot || write && !['workspace-write', 'danger-full-access'].includes(policy.mode)) deny();
    const root = await ctx.fs.resolve(policy.workspaceRoot, { signal });
    const current = await ctx.fs.resolve(cwd, { signal });
    live(signal);
    if (!ctx.fs.contains(root, current)) deny();
    return { root, current, cwd, policy };
  }
  const saved = [];
  return {
    saved,
    async read(path, signal) {
      if (typeof path !== 'string' || !path || path.includes('\0')) deny();
      const { root, cwd } = await scope(signal);
      const target = await ctx.fs.resolve(path, { cwd, signal });
      live(signal);
      if (!ctx.fs.contains(root, target)) deny();
      const info = await ctx.fs.stat(target, signal);
      if (info?.type !== 'file' || !Number.isSafeInteger(info.size) || info.size < 0 || info.size > MAX_BYTES) deny();
      const bytes = await ctx.fs.readByteRange(target, { offset: 0, length: info.size + 1 }, signal);
      live(signal);
      const after = await ctx.fs.stat(target, signal);
      if (bytes.length !== info.size || after?.version !== info.version) throw new OpenAIError('OPENAI_FILE_CHANGED');
      const { root: currentRoot } = await scope(signal);
      if (!ctx.fs.contains(currentRoot, target)) deny();
      return { bytes, name: basename(target.displayPath), mime: MIME[extname(path).toLowerCase()] ?? 'application/octet-stream' };
    },
    async save(bytes, contentType, signal) {
      if (bytes.length > MAX_BYTES) throw new OpenAIError('OPENAI_RESPONSE_TOO_LARGE');
      const { current, cwd, policy } = await scope(signal, true);
      const host = ctx.fs.processPath(current);
      if (!isAbsolute(host) || await realpath(host) !== host) deny();
      const mapped = ctx.fs.processPathFromHostPath(host);
      if (!mapped || (await ctx.fs.resolve(mapped, { signal })).targetKey !== current.targetKey) deny();
      const folder = await mkdtemp(join(host, 'openai-'));
      try {
        live(signal);
        const now = await scope(signal, true);
        if (now.cwd !== cwd || now.policy.mode !== policy.mode || now.policy.workspaceRoot !== policy.workspaceRoot || !within(host, await realpath(folder))) deny();
        const ext = Object.entries(MIME).find(([, mime]) => mime === contentType.split(';')[0])?.[0] ?? '.bin';
        const path = join(folder, `result${ext}`);
        const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { await handle.writeFile(bytes, { signal }); } finally { await handle.close(); }
        live(signal);
        const world = ctx.fs.processPathFromHostPath(path);
        if (!world) deny();
        saved.push(world);
        return world;
      } catch (error) { await rm(folder, { recursive: true, force: true }); throw error; }
    },
  };
}
