declare module '*.scss' {
  const content: string;
  export default content;
}

interface WettyTerminalControlTarget {
  focus(): void;
  input(data: string, wasUserInput?: boolean): void;
  onData?(listener: (data: string) => void): { dispose(): void };
  paste?(data: string): void;
  socket?: Pick<import('socket.io-client').Socket, 'connected' | 'id' | 'off' | 'once'>;
}

interface Window {
  wetty_term?: WettyTerminalControlTarget;
  clipboardData: DataTransfer;
  closeConfig?: () => void;
  toggleFunctions?: () => void;
  toggleCTRL?: () => void;
  pressESC?: () => void;
  pressUP?: () => void;
  pressDOWN?: () => void;
  pressTAB?: () => void;
  pressLEFT?: () => void;
  pressRIGHT?: () => void;
}
