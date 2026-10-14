import fs from 'node:fs/promises';
import path from 'node:path';

async function exists(file, operations) {
  try {
    await operations.stat(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Publish a complete capture directory without copying over reviewed files.
 * A retained backup recovers a process interrupted between directory renames.
 * Run one capture publisher at a time. Operations can be injected for failures.
 * @param {string} source Completed, validated capture directory.
 * @param {string} destination Reviewed capture directory.
 * @param {typeof fs} operations Filesystem operations.
 */
export async function publishCaptures(source, destination, operations = fs) {
  const parent = path.dirname(destination);
  const backup = path.join(parent, '.launch-assets-backup');
  await operations.mkdir(parent, { recursive: true });
  if (await exists(backup, operations)) {
    if (!(await exists(destination, operations))) {
      await operations.rename(backup, destination);
    } else {
      // A prior publication completed before its backup cleanup was interrupted.
      await operations.rm(backup, { recursive: true });
    }
  }
  const stage = await operations.mkdtemp(path.join(parent, '.launch-assets-stage-'));
  let backedUp = false;
  try {
    await operations.cp(source, stage, { recursive: true });
    if (await exists(destination, operations)) {
      await operations.rename(destination, backup);
      backedUp = true;
    }
    try {
      await operations.rename(stage, destination);
    } catch (error) {
      if (backedUp) await operations.rename(backup, destination);
      throw error;
    }
    if (backedUp) await operations.rm(backup, { recursive: true });
  } finally {
    await operations.rm(stage, { recursive: true, force: true });
  }
}
