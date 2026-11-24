import { exec } from 'child_process';

const envVersion = (signal?: AbortSignal): Promise<number> =>
  new Promise((resolve, reject) => {
    exec('/usr/bin/env --version', { signal, timeout: 5000 }, (error, stdout, stderr): void => {
      if (error) {
        reject(Error(`error getting env version: ${error.message}`));
        return;
      }
      if (stderr) {
        reject(Error(`error getting env version: ${stderr}`));
        return;
      }
      const major = /^env \(GNU coreutils\) (\d+)/.exec(stdout)?.[1];
      if (major === undefined) {
        reject(new Error('Unable to identify GNU env version'));
        return;
      }
      resolve(Number(major));
    });
  });

export const envVersionOr = (fallback: number, signal?: AbortSignal): Promise<number> =>
  envVersion(signal).catch(() => fallback);
