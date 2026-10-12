/**
 * A direct browser-to-browser link (WebRTC data channel) set up by hand: one person creates an invitation
 * code, the other pastes it and gets a reply code, the first pastes the reply. No server of ours is involved
 * and no account is needed; the two codes are just text to send through any chat.
 *
 * Without a STUN server the link works between computers on the same network. Reaching across the internet
 * needs STUN (a public server that tells each side how it looks from outside), which means contacting that
 * server, so it is an explicit opt-in.
 */

export interface Transport {
  send(message: unknown): void;
  close(): void;
  readonly open: boolean;
  onMessage(handler: (message: unknown) => void): void;
  onOpen(handler: () => void): void;
  onClose(handler: () => void): void;
}

const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];
const MAX_MESSAGE_CHARS = 64 * 1024;
const GATHER_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------- signalling codes

const b64 = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64 = (text: string): Uint8Array => {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
};

async function pump(input: Uint8Array, stream: { writable: WritableStream<BufferSource>; readable: ReadableStream<Uint8Array> }): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(input as BufferSource).then(() => writer.close());
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** A session description as a short, copy-and-paste-able text: "lk1." + compressed (or "lk0." when the browser cannot compress). */
export async function encodeSignal(description: RTCSessionDescriptionInit): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify({ t: description.type, s: description.sdp }));
  if (typeof CompressionStream === 'function') return 'lk1.' + b64(await pump(raw, new CompressionStream('deflate-raw')));
  return 'lk0.' + b64(raw);
}

export async function decodeSignal(code: string): Promise<RTCSessionDescriptionInit> {
  const text = code.trim().replace(/\s+/g, '');
  const mark = text.slice(0, 4);
  if ((mark !== 'lk1.' && mark !== 'lk0.') || text.length < 12 || text.length > 20000) throw new Error('That is not a Lattakker sharing code. It should start with lk1.');
  let bytes: Uint8Array;
  try {
    bytes = unb64(text.slice(4));
    if (mark === 'lk1.') bytes = await pump(bytes, new DecompressionStream('deflate-raw'));
  } catch {
    throw new Error('The code is damaged (part of it was lost when copying). Copy the whole code again.');
  }
  let parsed: { t?: unknown; s?: unknown };
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('The code is damaged (part of it was lost when copying). Copy the whole code again.');
  }
  if ((parsed.t !== 'offer' && parsed.t !== 'answer') || typeof parsed.s !== 'string') throw new Error('That is not a Lattakker sharing code.');
  return { type: parsed.t, sdp: parsed.s };
}

// ---------------------------------------------------------------- the link

async function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve) => {
    const done = (): void => {
      pc.removeEventListener('icegatheringstatechange', check);
      window.clearTimeout(timer);
      resolve();
    };
    const check = (): void => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = window.setTimeout(done, GATHER_TIMEOUT_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export class RtcLink implements Transport {
  private channel: RTCDataChannel | null = null;
  private readonly messageHandlers: Array<(m: unknown) => void> = [];
  private readonly openHandlers: Array<() => void> = [];
  private readonly closeHandlers: Array<() => void> = [];
  private closed = false;

  private constructor(private readonly pc: RTCPeerConnection) {
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') this.handleClose();
    });
  }

  get open(): boolean {
    return this.channel?.readyState === 'open';
  }

  /** The person who shares starts here: returns the invitation code to send, and the link that completes when the reply arrives. */
  static async invite(useStun: boolean): Promise<{ code: string; link: RtcLink }> {
    const pc = new RTCPeerConnection({ iceServers: useStun ? STUN : [] });
    const link = new RtcLink(pc);
    link.attach(pc.createDataChannel('lattakker', { ordered: true }));
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    return { code: await encodeSignal(pc.localDescription!), link };
  }

  /** The invited person pastes the invitation and gets a reply code to send back. */
  static async join(invitation: string, useStun: boolean): Promise<{ code: string; link: RtcLink }> {
    const offer = await decodeSignal(invitation);
    if (offer.type !== 'offer') throw new Error('That code is a reply, not an invitation. Paste the invitation you were sent.');
    const pc = new RTCPeerConnection({ iceServers: useStun ? STUN : [] });
    const link = new RtcLink(pc);
    pc.addEventListener('datachannel', (e) => link.attach(e.channel));
    await pc.setRemoteDescription(offer);
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    return { code: await encodeSignal(pc.localDescription!), link };
  }

  /** The sharer pastes the reply: the link opens a moment later. */
  async acceptReply(reply: string): Promise<void> {
    const answer = await decodeSignal(reply);
    if (answer.type !== 'answer') throw new Error('That code is an invitation, not a reply. Paste the reply you were sent back.');
    await this.pc.setRemoteDescription(answer);
  }

  private attach(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.addEventListener('open', () => this.openHandlers.forEach((h) => h()));
    channel.addEventListener('close', () => this.handleClose());
    channel.addEventListener('message', (e) => {
      if (typeof e.data !== 'string' || e.data.length > MAX_MESSAGE_CHARS) return;
      let message: unknown;
      try {
        message = JSON.parse(e.data);
      } catch {
        return;
      }
      this.messageHandlers.forEach((h) => h(message));
    });
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeHandlers.forEach((h) => h());
  }

  send(message: unknown): void {
    if (!this.open) return;
    const text = JSON.stringify(message);
    if (text.length <= MAX_MESSAGE_CHARS) this.channel!.send(text);
  }

  close(): void {
    this.channel?.close();
    this.pc.close();
    this.handleClose();
  }

  onMessage(handler: (message: unknown) => void): void {
    this.messageHandlers.push(handler);
  }

  onOpen(handler: () => void): void {
    this.openHandlers.push(handler);
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }
}
