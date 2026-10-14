import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { publishCaptures } from './capture-store.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'symtri-captures-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'launch-assets');
  for (const [directory, value] of [[source, 'new'], [destination, 'reviewed']]) {
    await fs.mkdir(directory);
    for (const file of ['map.png', 'threads.png', 'provenance.json']) {
      await fs.writeFile(path.join(directory, file), value);
    }
  }
  return { root, source, destination };
}

async function assertSet(directory, value) {
  for (const file of ['map.png', 'threads.png', 'provenance.json']) {
    assert.equal(await fs.readFile(path.join(directory, file), 'utf8'), value);
  }
}

test('publishes a complete set and removes stale reviewed assets', async (t) => {
  const { root, source, destination } = await fixture(t);
  await fs.writeFile(path.join(destination, 'obsolete.png'), 'old');
  await publishCaptures(source, destination);
  await assertSet(destination, 'new');
  assert.deepEqual((await fs.readdir(root)).sort(), ['launch-assets', 'source']);
  await assert.rejects(fs.stat(path.join(destination, 'obsolete.png')), { code: 'ENOENT' });
});

test('partial staging copy failure preserves every reviewed file', async (t) => {
  const { root, source, destination } = await fixture(t);
  await assert.rejects(publishCaptures(source, destination, {
    ...fs,
    cp: async (_, stage) => {
      await fs.writeFile(path.join(stage, 'map.png'), 'partial');
      const error = new Error('Disk full');
      error.code = 'ENOSPC';
      throw error;
    },
  }), { code: 'ENOSPC' });
  await assertSet(destination, 'reviewed');
  assert.deepEqual((await fs.readdir(root)).sort(), ['launch-assets', 'source']);
});

test('failed replacement rename restores the reviewed set', async (t) => {
  const { source, destination } = await fixture(t);
  await assert.rejects(publishCaptures(source, destination, {
    ...fs,
    rename: async (from, to) => {
      if (path.basename(from).startsWith('.launch-assets-stage-')) {
        throw new Error('Replacement failed');
      }
      await fs.rename(from, to);
    },
  }), /Replacement failed/);
  await assertSet(destination, 'reviewed');
});

test('recovers an interrupted rename before a later copy fails', async (t) => {
  const { root, source, destination } = await fixture(t);
  await fs.rename(destination, path.join(root, '.launch-assets-backup'));
  await assert.rejects(publishCaptures(source, destination, {
    ...fs,
    cp: async () => { throw new Error('Copy failed'); },
  }), /Copy failed/);
  await assertSet(destination, 'reviewed');
});

test('supports the first publication without a reviewed directory', async (t) => {
  const { source, destination } = await fixture(t);
  await fs.rm(destination, { recursive: true });
  await publishCaptures(source, destination);
  await assertSet(destination, 'new');
});
