import { app, dialog } from 'electron';
import { mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
// Keep the startup boundary free of third-party modules so packaging/load errors
// are observable even when application services cannot be imported.
void import('./index').catch(async (error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error('LocalAI startup failed:', message);
  try {
    const directory = join(app.getPath('userData'), 'logs');
    await mkdir(directory, { recursive: true });
    await appendFile(join(directory, 'startup.log'), `${new Date().toISOString()} ${message}\n`);
  } catch (logError) {
    console.error('Unable to write startup log:', logError);
  }
  await app.whenReady();
  dialog.showErrorBox('LocalAI Workspace could not start', message);
  app.quit();
});
