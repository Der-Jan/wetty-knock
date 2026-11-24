import { BROWSER_KEY_SCOPE, bytes, checkUserAuth, fields, publicBlob } from '../../../protocol/browserAgent';
import { checkForwardedAuth } from '../../../protocol/forwardedAuth';
import { keyFingerprint } from '../../../protocol/importedKeys';
import { promptForwardSign } from './forwardPrompt';
import { ForwardedApprovals } from './forwardedApprovals';
import { setupKeyringSession } from './keyringSession';
import { generatedKeyInfo, loadSshKey } from './keys';
import type { ForwardApproval } from './forwardPrompt';
import type { ImportApproval } from './keyringSession';
import type { BrowserSshKey } from './keys';
import type { Socket } from 'socket.io-client';

/** No reconnect replay: each Socket.IO connection gets a new signer context. */
export function setupBrowserSigner(
  socket: Socket,
  approve: ForwardApproval = promptForwardSign,
  approveImport?: ImportApproval,
): void {
  let context:
    | {
        sessionId: string;
        user: string;
        key: BrowserSshKey;
        publicKey: string;
        blob: Uint8Array;
        seen: Set<string>;
        managedRequests: Set<string>;
        forwarding: boolean;
        controller: AbortController;
        prompting: boolean;
        approvals: ForwardedApprovals;
      }
    | undefined;
  let preparing: string | undefined;
  setupKeyringSession(socket, () => context, approve, approveImport);
  socket.on('disconnect', () => {
    context?.controller.abort();
    context = undefined;
    preparing = undefined;
  });
  socket.on('logout', () => {
    context?.controller.abort();
    context = undefined;
    preparing = undefined;
  });
  socket.on('browser-key:prepare', (payload: unknown) => {
    if (!socket.connected) return;
    const connectionId = socket.id;
    const ack = (value: Record<string, unknown>): void => {
      if (!socket.connected || socket.id !== connectionId) return;
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return;
      }
      const request = fields(payload);
      socket.emit('browser-key:result', {
        sessionId: request.sessionId,
        requestId: request.requestId,
        ...value,
      });
    };
    void (async () => {
      const request = fields(payload);
      const target = fields(request.target);
      if (
        request.v !== 1 ||
        typeof request.sessionId !== 'string' ||
        request.sessionId.length > 64 ||
        typeof target.user !== 'string' ||
        target.user.length > 256 ||
        context ||
        preparing
      ) {
        throw new Error('Invalid browser key preparation');
      }
      const { sessionId } = request;
      preparing = sessionId;
      const key = await loadSshKey(BROWSER_KEY_SCOPE);
      const publicKey = await key.publicKey();
      if (!socket.connected || preparing !== sessionId) return;
      const controller = new AbortController();
      context = {
        sessionId,
        user: target.user,
        key,
        publicKey,
        blob: publicBlob(publicKey),
        seen: new Set(),
        managedRequests: new Set(),
        forwarding: request.forwarding === true,
        controller,
        approvals: new ForwardedApprovals(controller.signal),
        prompting: false,
      };
      ack({
        v: 1,
        sessionId,
        publicKey,
        forwarding: context.forwarding,
        keyManagement: 1,
        loginKeys: 1,
        sessionBinding: 1,
      });
    })().catch(() => {
      ack({ v: 1, error: 'KEY_UNAVAILABLE' });
    });
  });
  socket.on('browser-key:agent-close', (payload: unknown) => {
    try {
      const request = fields(payload);
      if (request.v === 1 && request.sessionId === context?.sessionId) {
        context?.approvals.close(request.agentConnectionId);
      }
    } catch {
      /* Invalid lifecycle messages cannot change approval state. */
    }
  });
  socket.on('browser-key:bind', (payload: unknown) => {
    const active = context;
    const connectionId = socket.id;
    void (async () => {
      const request = fields(payload);
      try {
        if (
          !active ||
          !active.forwarding ||
          request.v !== 1 ||
          request.sessionId !== active.sessionId ||
          typeof request.requestId !== 'string' ||
          request.requestId.length > 64 ||
          active.seen.has(request.requestId) ||
          active.seen.size >= 160
        ) {
          throw new Error('Invalid binding request');
        }
        active.seen.add(request.requestId);
        await active.approvals.bind(request.agentConnectionId, request.packet);
        if (socket.connected && socket.id === connectionId && context === active) {
          socket.emit('browser-key:result', {
            v: 1,
            sessionId: active.sessionId,
            requestId: request.requestId,
            ok: true,
          });
        }
      } catch {
        if (socket.connected && socket.id === connectionId && context === active) {
          socket.emit('browser-key:result', {
            v: 1,
            sessionId: request.sessionId,
            requestId: request.requestId,
            error: 'BIND_FAILED',
          });
        }
      }
    })().catch(() => {
      /* Malformed envelope: no reply. */
    });
  });
  socket.on('browser-key:sign', (payload: unknown) => {
    if (!socket.connected) return;
    const connectionId = socket.id;
    const ack = (value: Record<string, unknown>): void => {
      if (!socket.connected || socket.id !== connectionId) return;
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return;
      }
      const request = fields(payload);
      socket.emit('browser-key:result', {
        sessionId: request.sessionId,
        requestId: request.requestId,
        ...value,
      });
    };
    const active = context;
    const current = (): boolean => socket.connected && context === active && socket.id === connectionId;
    void (async () => {
      const request = fields(payload);
      if (
        !active ||
        request.v !== 1 ||
        request.sessionId !== active.sessionId ||
        request.algorithm !== 'rsa-sha2-256' ||
        typeof request.requestId !== 'string' ||
        request.requestId.length > 64 ||
        active.seen.has(request.requestId) ||
        active.seen.size >= 160
      ) {
        throw new Error('Invalid SSH signing request');
      }
      active.seen.add(request.requestId);
      const data = bytes(request.data, 32768);
      const forwarded = request.forwarded === true;
      if (request.forwarded !== undefined && typeof request.forwarded !== 'boolean') {
        throw new Error('Invalid forwarding flag');
      }
      if (forwarded && (!active.forwarding || active.prompting)) {
        throw new Error('Forwarding unavailable');
      }
      const user = forwarded ? checkForwardedAuth(data, active.blob) : checkUserAuth(data, active.user, active.blob);
      const policy = await generatedKeyInfo();
      if (policy?.publicKey !== active.publicKey || !current()) throw new Error('Key unavailable');
      if (forwarded || policy.sensitive) {
        if (active.prompting) throw new Error('Approval pending');
        active.prompting = true;
        try {
          const label = policy.sensitive ? `${user} (key ${await keyFingerprint(active.blob)})` : user;
          if (forwarded) {
            await active.approvals.approve(
              request.agentConnectionId,
              data,
              active.blob,
              'rsa-sha2-256',
              approve,
              label,
              policy.sensitive,
              policy.revision,
            );
          } else if ((await approve(label, active.controller.signal, true, undefined, true)) !== true) {
            throw new Error('Signing declined');
          }
        } finally {
          active.prompting = false;
        }
      }
      active.controller.signal.throwIfAborted();
      if (!current()) return;
      const signature = await active.key.sign(data);
      const latest = await generatedKeyInfo();
      if (latest?.publicKey !== active.publicKey || latest.revision !== policy.revision) {
        throw new Error('Key changed');
      }
      if (forwarded) active.approvals.assertCurrent(request.agentConnectionId);
      if (socket.connected && context === active) {
        ack({
          v: 1,
          sessionId: active.sessionId,
          requestId: request.requestId,
          signature,
        });
      }
    })().catch(() => {
      if (socket.connected && context === active) {
        ack({ v: 1, error: 'SIGN_FAILED' });
      }
    });
  });
}
