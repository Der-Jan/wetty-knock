import { expect } from 'chai';
import 'mocha';
import sinon from 'sinon';
import { FlowControlServer, tinybuffer } from './flowcontrol';
import type { Socket } from 'socket.io';

describe('Disposable PTY output buffer', () => {
  let clock: sinon.SinonFakeTimers;
  beforeEach(() => {
    clock = sinon.useFakeTimers();
  });
  afterEach(() => {
    clock.restore();
  });
  function fixture() {
    const socket = { emit: sinon.spy() };
    return { socket, send: tinybuffer(socket as unknown as Socket, 2, 8) };
  }
  it('should preserve upstream timed batching and immediate size-limit flushing', () => {
    const { socket, send } = fixture();
    send('one');
    send('two');
    expect(socket.emit.called).to.equal(false);
    clock.tick(2);
    expect(socket.emit.firstCall.args).to.deep.equal(['data', 'onetwo']);
    send('123456789');
    expect(socket.emit.secondCall.args).to.deep.equal(['data', '123456789']);
    clock.tick(2);
    expect(socket.emit.callCount).to.equal(2);
    send.cancel();
  });
  it('should flush final output exactly once before disposal', () => {
    const { socket, send } = fixture();
    send('final');
    send.flush();
    send.flush();
    send.cancel();
    send.cancel();
    clock.tick(10);
    expect(socket.emit.calledOnceWithExactly('data', 'final')).to.equal(true);
    expect(clock.countTimers()).to.equal(0);
  });
  it('should discard pending output on disposal and refuse later writes', () => {
    const { socket, send } = fixture();
    send('pending');
    send.cancel();
    send('late');
    send.flush();
    clock.tick(10);
    expect(socket.emit.called).to.equal(false);
    expect(clock.countTimers()).to.equal(0);
  });
});

describe('server flow control boundaries', () => {
  it('pauses when output reaches the high watermark exactly', () => {
    const flow = new FlowControlServer(2, 4);

    expect(flow.account(4)).to.equal(true);
    expect(flow.account(1)).to.equal(false);
  });

  it('pauses when output crosses the high watermark', () => {
    const flow = new FlowControlServer(2, 4);

    expect(flow.account(3)).to.equal(false);
    expect(flow.account(1)).to.equal(true);
    expect(flow.account(1)).to.equal(false);
  });

  it('resumes when a commit reaches the low watermark exactly', () => {
    const flow = new FlowControlServer(2, 4);

    expect(flow.account(4)).to.equal(true);
    expect(flow.commit(2)).to.equal(true);
    expect(flow.commit(1)).to.equal(false);
  });
});
