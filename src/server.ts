/**
 * Create WeTTY server
 * @module WeTTy
 */
import express from 'express';
import { Gauge, collectDefaultMetrics } from 'prom-client';
import { browserSshIntegration } from './server/browserAgent/integration.js';
import { getCommand } from './server/command/index.js';
import { sshDefault, serverDefault, forceSSHDefault, defaultCommand } from './server/config/defaults.js';
import { observeGC } from './server/metrics.js';
import { logger as getLogger } from './server/observability/logger.js';
import { runServerSession } from './server/session.js';
import { server } from './server/socketServer/index.js';
import { spawn } from './server/spawn/index.js';
import { logSafeArgs } from './server/spawn/log-safety.js';
import type { ClientToServerEvents, ServerToClientEvents } from './protocol/socket-events.js';
import type { SSH, SSL, Server } from './server/config/types.js';
import type { Express } from 'express';
import type SocketIO from 'socket.io';
import type { Socket as ServerSocket } from 'socket.io';

export * from './server/config/types.js';
export { logger as getLogger } from './server/observability/logger.js';

const wettyConnections = new Gauge({
  name: 'wetty_connections',
  help: 'number of active socket connections to wetty',
});

/**
 * Starts WeTTy Server
 * @name startServer
 * @returns Promise that resolves SocketIO server
 */
export const start = (
  ssh: SSH = sshDefault,
  serverConf: Server = serverDefault,
  command: string = defaultCommand,
  forcessh: boolean = forceSSHDefault,
  ssl?: SSL,
): Promise<SocketIO.Server> => decorateServerWithSsh(express(), ssh, serverConf, command, forcessh, ssl);

export async function decorateServerWithSsh(
  app: Express,
  ssh: SSH = sshDefault,
  serverConf: Server = serverDefault,
  command: string = defaultCommand,
  forcessh: boolean = forceSSHDefault,
  ssl?: SSL,
): Promise<SocketIO.Server> {
  const logger = getLogger();
  const browserSsh = await browserSshIntegration(ssh);
  if (ssh.key) {
    logger.warn(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
! Password-less auth enabled using private key from ${ssh.key}.
! This is dangerous, anything that reaches the wetty server
! will be able to run remote operations without authentication.
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
  }

  collectDefaultMetrics();
  observeGC();

  const io = await server(app, serverConf, ssl, browserSsh.origin);
  const browserSessions = browserSsh.attach(io, command, () => {
    wettyConnections.dec();
  });
  /**
   * Wetty server connected too
   * @fires WeTTy#connnection
   */
  io.on('connection', async (socket: ServerSocket<ClientToServerEvents, ServerToClientEvents>) => {
    /**
     * @event wetty#connection
     * @name connection
     */
    logger.info('Connection accepted.');
    if (browserSsh.origin !== undefined) {
      wettyConnections.inc();
      browserSessions.handle(socket);
      return;
    }

    await runServerSession(socket, {
      connections: wettyConnections,
      getCommand: (session) => getCommand(socket, ssh, command, forcessh, session),
      spawn: (args, session) => spawn(socket, args, session),
      onCommand: (args) => {
        logger.debug('Command Generated', {
          cmd: logSafeArgs(args).join(' '),
        });
      },
      onError: (error) => {
        logger.info('Disconnect signal sent', { err: error });
      },
      onCleanupError: (error) => {
        logger.warn('Session cleanup failed', { err: error });
      },
    });
  });
  return io;
}
