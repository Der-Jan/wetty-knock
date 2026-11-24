import { promptAgentChoice } from './approvalPrompt';

export interface ForwardDestination {
  hostFingerprint: string;
  forwardingHostFingerprints: string[];
  canRemember: boolean;
}

export type ForwardApproval = (
  user: string,
  signal: AbortSignal,
  initialLogin?: boolean,
  destination?: ForwardDestination,
  sensitive?: boolean,
) => Promise<boolean | 'session'> | boolean | 'session';
export const promptForwardSign: ForwardApproval = (user, signal, initialLogin, destination, sensitive) => {
  let message = `A remote process requests use of your browser key to log in as ${user}. The destination is not verified by this browser. Approve only if you just started this SSH or Git operation. This request expires in 45 seconds.`;
  if (initialLogin) {
    message = `Log in to your configured SSH server as ${user}? This request expires in 45 seconds.`;
  } else if (destination) {
    const path = destination.forwardingHostFingerprints
      .map((host, index) => `Forwarding host ${String(index + 1)}: ${host}`)
      .join('\n');
    let scope = 'This signature is not host-bound; approval is for this use only.';
    if (sensitive) scope = 'This sensitive key requires approval for every use.';
    else if (destination.canRemember) {
      scope =
        'Approval until disconnected applies only to this key, username and host-key path, and is cleared on reload or disconnect.';
    }
    message = `Log in as ${user}. Verified session host key: ${destination.hostFingerprint}.\n${path}\nSSH verifies the hostname. ${scope} This request expires in 45 seconds.`;
  }
  const heading = initialLogin ? 'Use imported SSH key for login?' : 'Allow forwarded SSH authentication?';
  return promptAgentChoice(
    sensitive ? 'Sensitive SSH key' : heading,
    message,
    'Allow once',
    signal,
    !sensitive && !initialLogin && destination?.canRemember === true,
    sensitive,
  );
};
