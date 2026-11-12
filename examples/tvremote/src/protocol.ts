/**
 * Android TV Remote v2 wire protocol — pure TypeScript implementation.
 *
 * Ported from github.com/tronikos/androidtvremote2 (Apache-2.0)
 * Copyright (c) 2022-2026 tronikos
 *
 * Covers:
 *  1. Protobuf varint framing and wire encoders/decoders;
 *  2. Polo pairing protocol (polo.proto, port 6467);
 *  3. Remote control protocol (remotemessage.proto, port 6466);
 *  4. Key codes, hold/release directions, and text/app injection;
 *  5. Pairing and Remote state machines.
 *
 * Dependency-free: runs anywhere (QuickJS, Bun, Node, browser preview).
 */

// ============================================================================
// 1. Protobuf Varint & Wire Helpers
// ============================================================================

export function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = [];
  let v = value >>> 0;
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v & 0x7f);
  return new Uint8Array(bytes);
}

export function decodeVarint(
  bytes: Uint8Array,
  offset: number = 0
): { value: number; bytesRead: number } | null {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (pos < bytes.length) {
    const b = bytes[pos]!;
    pos += 1;
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) {
      return { value: result >>> 0, bytesRead: pos - offset };
    }
    shift += 7;
    if (shift >= 35) {
      throw new Error("varint overflow");
    }
  }
  return null;
}

/** Delimits a protobuf payload with its varint length prefix. */
export function frameMessage(payload: Uint8Array): Uint8Array {
  const prefix = encodeVarint(payload.length);
  const out = new Uint8Array(prefix.length + payload.length);
  out.set(prefix, 0);
  out.set(payload, prefix.length);
  return out;
}

/** Parses one or more varint-prefixed frames from an accumulated buffer. */
export function decodeFrames(buffer: Uint8Array): {
  frames: Uint8Array[];
  remaining: Uint8Array;
} {
  const frames: Uint8Array[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const decoded = decodeVarint(buffer, offset);
    if (!decoded) break;
    const msgLen = decoded.value;
    const msgStart = offset + decoded.bytesRead;
    const msgEnd = msgStart + msgLen;
    if (msgEnd > buffer.length) {
      // Partial frame, wait for more data.
      break;
    }
    frames.push(buffer.subarray(msgStart, msgEnd));
    offset = msgEnd;
  }
  return {
    frames,
    remaining: offset === 0 ? buffer : buffer.slice(offset),
  };
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export class ProtoWriter {
  private chunks: Uint8Array[] = [];
  private totalLength = 0;

  private push(bytes: Uint8Array) {
    this.chunks.push(bytes);
    this.totalLength += bytes.length;
  }

  writeTag(fieldNumber: number, wireType: number) {
    this.push(encodeVarint((fieldNumber << 3) | wireType));
  }

  writeVarint(fieldNumber: number, value: number) {
    this.writeTag(fieldNumber, 0);
    this.push(encodeVarint(value));
  }

  writeBool(fieldNumber: number, value: boolean) {
    this.writeVarint(fieldNumber, value ? 1 : 0);
  }

  writeString(fieldNumber: number, value: string) {
    const encoded = textEncoder.encode(value);
    this.writeTag(fieldNumber, 2);
    this.push(encodeVarint(encoded.length));
    this.push(encoded);
  }

  writeBytes(fieldNumber: number, value: Uint8Array) {
    this.writeTag(fieldNumber, 2);
    this.push(encodeVarint(value.length));
    this.push(value);
  }

  writeMessage(fieldNumber: number, messageBytes: Uint8Array) {
    this.writeTag(fieldNumber, 2);
    this.push(encodeVarint(messageBytes.length));
    this.push(messageBytes);
  }

  finish(): Uint8Array {
    const out = new Uint8Array(this.totalLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

export interface ProtoField {
  fieldNumber: number;
  wireType: number;
  varintValue?: number;
  lengthDelimitedValue?: Uint8Array;
}

export function readProtoFields(bytes: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const tagVar = decodeVarint(bytes, offset);
    if (!tagVar) break;
    offset += tagVar.bytesRead;
    const tag = tagVar.value;
    const wireType = tag & 0x07;
    const fieldNumber = tag >>> 3;

    if (wireType === 0) {
      const val = decodeVarint(bytes, offset);
      if (!val) break;
      offset += val.bytesRead;
      fields.push({ fieldNumber, wireType, varintValue: val.value });
    } else if (wireType === 2) {
      const lenVar = decodeVarint(bytes, offset);
      if (!lenVar) break;
      offset += lenVar.bytesRead;
      const len = lenVar.value;
      const data = bytes.subarray(offset, offset + len);
      offset += len;
      fields.push({ fieldNumber, wireType, lengthDelimitedValue: data });
    } else {
      // Wire types 1 (64-bit), 5 (32-bit), 3/4 (groups) - unsupported/skipped
      break;
    }
  }
  return fields;
}

// ============================================================================
// 2. Pure TypeScript SHA-256 implementation (QuickJS-safe & zero-dep)
// ============================================================================

export function sha256Sync(data: Uint8Array): Uint8Array {
  function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount));
  }

  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const originalLength = data.length;
  const bitLength = originalLength * 8;
  const withOne = originalLength + 1;
  const padLength = (withOne % 64 <= 56 ? 56 - (withOne % 64) : 120 - (withOne % 64));
  const total = withOne + padLength + 8;
  const padded = new Uint8Array(total);
  padded.set(data, 0);
  padded[originalLength] = 0x80;

  // Append 64-bit big-endian bit length
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  view.setUint32(total - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(total - 4, bitLength >>> 0, false);

  const w = new Uint32Array(64);
  for (let chunk = 0; chunk < total; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(chunk + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rightRotate(w[i - 15]!, 7) ^ rightRotate(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rightRotate(w[i - 2]!, 17) ^ rightRotate(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

    for (let i = 0; i < 64; i++) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[i]! + w[i]!) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out;
}

// ============================================================================
// 3. Polo Pairing Protocol (OuterMessage)
// ============================================================================

export const POLO_STATUS = {
  STATUS_OK: 200,
  STATUS_ERROR: 400,
  STATUS_BAD_CONFIGURATION: 401,
  STATUS_BAD_SECRET: 402,
} as const;

export const POLO_ENCODING_TYPE = {
  UNKNOWN: 0,
  ALPHANUMERIC: 1,
  NUMERIC: 2,
  HEXADECIMAL: 3,
  QRCODE: 4,
} as const;

export const POLO_ROLE_TYPE = {
  UNKNOWN: 0,
  INPUT: 1,
  OUTPUT: 2,
} as const;

export interface OuterMessage {
  protocolVersion: number;
  status: number;
  hasPairingRequest?: boolean;
  hasPairingRequestAck?: boolean;
  hasOptions?: boolean;
  hasConfiguration?: boolean;
  hasConfigurationAck?: boolean;
  hasSecret?: boolean;
  hasSecretAck?: boolean;
  secretPayload?: Uint8Array;
}

export function createPairingRequest(clientName: string, serviceName: string = "atvremote"): Uint8Array {
  const req = new ProtoWriter();
  req.writeString(1, serviceName);
  req.writeString(2, clientName);

  const outer = new ProtoWriter();
  outer.writeVarint(1, 2); // protocol_version = 2
  outer.writeVarint(2, POLO_STATUS.STATUS_OK);
  outer.writeMessage(10, req.finish());
  return outer.finish();
}

export function createPairingOption(): Uint8Array {
  const encoding = new ProtoWriter();
  encoding.writeVarint(1, POLO_ENCODING_TYPE.HEXADECIMAL);
  encoding.writeVarint(2, 6); // symbol_length = 6

  const opt = new ProtoWriter();
  opt.writeMessage(1, encoding.finish()); // input_encodings
  opt.writeVarint(3, POLO_ROLE_TYPE.INPUT); // preferred_role

  const outer = new ProtoWriter();
  outer.writeVarint(1, 2);
  outer.writeVarint(2, POLO_STATUS.STATUS_OK);
  outer.writeMessage(20, opt.finish());
  return outer.finish();
}

export function createPairingConfiguration(): Uint8Array {
  const encoding = new ProtoWriter();
  encoding.writeVarint(1, POLO_ENCODING_TYPE.HEXADECIMAL);
  encoding.writeVarint(2, 6);

  const config = new ProtoWriter();
  config.writeMessage(1, encoding.finish());
  config.writeVarint(2, POLO_ROLE_TYPE.INPUT);

  const outer = new ProtoWriter();
  outer.writeVarint(1, 2);
  outer.writeVarint(2, POLO_STATUS.STATUS_OK);
  outer.writeMessage(30, config.finish());
  return outer.finish();
}

export function createPairingSecret(secret: Uint8Array): Uint8Array {
  const sec = new ProtoWriter();
  sec.writeBytes(1, secret);

  const outer = new ProtoWriter();
  outer.writeVarint(1, 2);
  outer.writeVarint(2, POLO_STATUS.STATUS_OK);
  outer.writeMessage(40, sec.finish());
  return outer.finish();
}

export function createPairingSecretAck(secret: Uint8Array): Uint8Array {
  const sec = new ProtoWriter();
  sec.writeBytes(1, secret);

  const outer = new ProtoWriter();
  outer.writeVarint(1, 2);
  outer.writeVarint(2, POLO_STATUS.STATUS_OK);
  outer.writeMessage(41, sec.finish());
  return outer.finish();
}

export function parseOuterMessage(bytes: Uint8Array): OuterMessage {
  const fields = readProtoFields(bytes);
  let protocolVersion = 1;
  let status = POLO_STATUS.STATUS_OK;
  let hasPairingRequest = false;
  let hasPairingRequestAck = false;
  let hasOptions = false;
  let hasConfiguration = false;
  let hasConfigurationAck = false;
  let hasSecret = false;
  let hasSecretAck = false;
  let secretPayload: Uint8Array | undefined;

  for (const f of fields) {
    if (f.fieldNumber === 1 && f.varintValue !== undefined) {
      protocolVersion = f.varintValue;
    } else if (f.fieldNumber === 2 && f.varintValue !== undefined) {
      status = f.varintValue;
    } else if (f.fieldNumber === 10) {
      hasPairingRequest = true;
    } else if (f.fieldNumber === 11) {
      hasPairingRequestAck = true;
    } else if (f.fieldNumber === 20) {
      hasOptions = true;
    } else if (f.fieldNumber === 30) {
      hasConfiguration = true;
    } else if (f.fieldNumber === 31) {
      hasConfigurationAck = true;
    } else if (f.fieldNumber === 40 && f.lengthDelimitedValue) {
      hasSecret = true;
      const sub = readProtoFields(f.lengthDelimitedValue);
      const s = sub.find((x) => x.fieldNumber === 1 && x.lengthDelimitedValue);
      secretPayload = s?.lengthDelimitedValue;
    } else if (f.fieldNumber === 41 && f.lengthDelimitedValue) {
      hasSecretAck = true;
      const sub = readProtoFields(f.lengthDelimitedValue);
      const s = sub.find((x) => x.fieldNumber === 1 && x.lengthDelimitedValue);
      secretPayload = s?.lengthDelimitedValue;
    }
  }

  return {
    protocolVersion,
    status,
    hasPairingRequest,
    hasPairingRequestAck,
    hasOptions,
    hasConfiguration,
    hasConfigurationAck,
    hasSecret,
    hasSecretAck,
    secretPayload,
  };
}

/**
 * Computes the Polo pairing hash from public key parts and the 6-hex-digit PIN code.
 *
 * For RSA: client/server key parts are (modulus, exponent).
 * For EC / P-256: key parts are the public key bytes.
 *
 * Formula: SHA256(clientParts || serverParts || pinCode[2:])
 * Verification check: hash[0] must equal parseInt(pinCode[0:2], 16).
 */
export function computePoloSecret(
  clientKeyParts: Uint8Array[],
  serverKeyParts: Uint8Array[],
  pinCode: string
): { secret: Uint8Array; valid: boolean } {
  if (pinCode.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(pinCode)) {
    return { secret: new Uint8Array(0), valid: false };
  }
  const pinBytes = new Uint8Array(
    (pinCode.slice(2).match(/.{2}/g) ?? []).map((byteHex) => parseInt(byteHex, 16))
  );

  let totalLen = pinBytes.length;
  for (const part of clientKeyParts) totalLen += part.length;
  for (const part of serverKeyParts) totalLen += part.length;

  const buffer = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of clientKeyParts) {
    buffer.set(part, offset);
    offset += part.length;
  }
  for (const part of serverKeyParts) {
    buffer.set(part, offset);
    offset += part.length;
  }
  buffer.set(pinBytes, offset);

  const secret = sha256Sync(buffer);
  const expectedCheck = parseInt(pinCode.slice(0, 2), 16);
  const valid = secret[0] === expectedCheck;
  return { secret, valid };
}

// ============================================================================
// 4. Remote Protocol (RemoteMessage)
// ============================================================================

export const RemoteKeyCode = {
  KEYCODE_UNKNOWN: 0,
  KEYCODE_HOME: 3,
  KEYCODE_BACK: 4,
  KEYCODE_DPAD_UP: 19,
  KEYCODE_DPAD_DOWN: 20,
  KEYCODE_DPAD_LEFT: 21,
  KEYCODE_DPAD_RIGHT: 22,
  KEYCODE_DPAD_CENTER: 23,
  KEYCODE_VOLUME_UP: 24,
  KEYCODE_VOLUME_DOWN: 25,
  KEYCODE_POWER: 26,
  KEYCODE_ENTER: 66,
  KEYCODE_MEDIA_PLAY_PAUSE: 85,
  KEYCODE_MEDIA_STOP: 86,
  KEYCODE_MEDIA_NEXT: 87,
  KEYCODE_MEDIA_PREVIOUS: 88,
  KEYCODE_MEDIA_REWIND: 89,
  KEYCODE_MEDIA_FAST_FORWARD: 90,
  KEYCODE_MUTE: 91,
  KEYCODE_VOLUME_MUTE: 164,
  KEYCODE_SETTINGS: 176,
  KEYCODE_TV_POWER: 177,
  KEYCODE_TV_INPUT: 178,
  KEYCODE_MENU: 82,
} as const;

export type RemoteKeyCodeVal = (typeof RemoteKeyCode)[keyof typeof RemoteKeyCode];

export const RemoteDirection = {
  UNKNOWN_DIRECTION: 0,
  START_LONG: 1, // Key Press / Hold start
  END_LONG: 2,   // Key Release / Hold end
  SHORT: 3,      // Click (press + release)
} as const;

export type RemoteDirectionVal = (typeof RemoteDirection)[keyof typeof RemoteDirection];

export const RemoteFeature = {
  PING: 1 << 0,
  KEY: 1 << 1,
  IME: 1 << 2,
  VOICE: 1 << 3,
  POWER: 1 << 5,
  VOLUME: 1 << 6,
  APP_LINK: 1 << 9,
} as const;

export const DEFAULT_ACTIVE_FEATURES =
  RemoteFeature.PING |
  RemoteFeature.KEY |
  RemoteFeature.POWER |
  RemoteFeature.VOLUME |
  RemoteFeature.APP_LINK |
  RemoteFeature.IME;

export interface RemoteMessage {
  hasConfigure?: boolean;
  supportedFeatures?: number;
  deviceVendor?: string;
  deviceModel?: string;

  hasSetActive?: boolean;
  activeFeatures?: number;

  hasPingRequest?: boolean;
  pingVal1?: number;

  hasPingResponse?: boolean;

  hasKeyInject?: boolean;
  keyCode?: number;
  keyDirection?: number;

  hasStart?: boolean;
  isStarted?: boolean;

  hasVolumeLevel?: boolean;
  volumeLevel?: number;
  volumeMax?: number;
  volumeMuted?: boolean;

  hasImeKeyInject?: boolean;
  currentAppPackage?: string;
  imeCounter?: number;
  imeFieldCounter?: number;

  hasImeShowRequest?: boolean;
  hasImeBatchEdit?: boolean;

  hasAppLinkLaunch?: boolean;
  appLink?: string;
}

export function createRemoteConfigure(activeFeatures: number = DEFAULT_ACTIVE_FEATURES): Uint8Array {
  const devInfo = new ProtoWriter();
  devInfo.writeString(1, "TenunJS"); // model
  devInfo.writeString(2, "Tenun");   // vendor
  devInfo.writeVarint(3, 1);
  devInfo.writeString(4, "1");
  devInfo.writeString(5, "id.my.tenun.remote");
  devInfo.writeString(6, "1.0.0");

  const cfg = new ProtoWriter();
  cfg.writeVarint(1, activeFeatures);
  cfg.writeMessage(2, devInfo.finish());

  const outer = new ProtoWriter();
  outer.writeMessage(1, cfg.finish());
  return outer.finish();
}

export function createRemoteSetActive(activeFeatures: number = DEFAULT_ACTIVE_FEATURES): Uint8Array {
  const active = new ProtoWriter();
  active.writeVarint(1, activeFeatures);

  const outer = new ProtoWriter();
  outer.writeMessage(2, active.finish());
  return outer.finish();
}

export function createRemotePingResponse(val1: number): Uint8Array {
  const ping = new ProtoWriter();
  ping.writeVarint(1, val1);

  const outer = new ProtoWriter();
  outer.writeMessage(9, ping.finish());
  return outer.finish();
}

export function createRemoteKeyInject(
  keyCode: number,
  direction: RemoteDirectionVal = RemoteDirection.SHORT
): Uint8Array {
  const key = new ProtoWriter();
  key.writeVarint(1, keyCode);
  key.writeVarint(2, direction);

  const outer = new ProtoWriter();
  outer.writeMessage(10, key.finish());
  return outer.finish();
}

export function createRemoteTextInject(
  text: string,
  imeCounter: number = 0,
  fieldCounter: number = 0
): Uint8Array {
  const imeObj = new ProtoWriter();
  imeObj.writeVarint(1, text.length); // start
  imeObj.writeVarint(2, text.length); // end
  imeObj.writeString(3, text);        // value

  const editInfo = new ProtoWriter();
  editInfo.writeVarint(1, 1); // insert = 1
  editInfo.writeMessage(2, imeObj.finish());

  const batchEdit = new ProtoWriter();
  batchEdit.writeVarint(1, imeCounter);
  batchEdit.writeVarint(2, fieldCounter);
  batchEdit.writeMessage(3, editInfo.finish());

  const outer = new ProtoWriter();
  outer.writeMessage(21, batchEdit.finish());
  return outer.finish();
}

export function createRemoteAppLinkLaunch(appLink: string): Uint8Array {
  const app = new ProtoWriter();
  app.writeString(1, appLink);

  const outer = new ProtoWriter();
  outer.writeMessage(90, app.finish());
  return outer.finish();
}

export function parseRemoteMessage(bytes: Uint8Array): RemoteMessage {
  const msg: RemoteMessage = {};
  const fields = readProtoFields(bytes);

  for (const f of fields) {
    switch (f.fieldNumber) {
      case 1: { // remote_configure
        msg.hasConfigure = true;
        if (f.lengthDelimitedValue) {
          const cfgFields = readProtoFields(f.lengthDelimitedValue);
          for (const cf of cfgFields) {
            if (cf.fieldNumber === 1 && cf.varintValue !== undefined) {
              msg.supportedFeatures = cf.varintValue;
            } else if (cf.fieldNumber === 2 && cf.lengthDelimitedValue) {
              const devFields = readProtoFields(cf.lengthDelimitedValue);
              for (const df of devFields) {
                if (df.fieldNumber === 1 && df.lengthDelimitedValue) {
                  msg.deviceModel = textDecoder.decode(df.lengthDelimitedValue);
                } else if (df.fieldNumber === 2 && df.lengthDelimitedValue) {
                  msg.deviceVendor = textDecoder.decode(df.lengthDelimitedValue);
                }
              }
            }
          }
        }
        break;
      }
      case 2: { // remote_set_active
        msg.hasSetActive = true;
        if (f.lengthDelimitedValue) {
          const actFields = readProtoFields(f.lengthDelimitedValue);
          const act = actFields.find((x) => x.fieldNumber === 1);
          if (act?.varintValue !== undefined) msg.activeFeatures = act.varintValue;
        }
        break;
      }
      case 8: { // remote_ping_request
        msg.hasPingRequest = true;
        if (f.lengthDelimitedValue) {
          const pFields = readProtoFields(f.lengthDelimitedValue);
          const v = pFields.find((x) => x.fieldNumber === 1);
          if (v?.varintValue !== undefined) msg.pingVal1 = v.varintValue;
        }
        break;
      }
      case 9: { // remote_ping_response
        msg.hasPingResponse = true;
        break;
      }
      case 10: { // remote_key_inject
        msg.hasKeyInject = true;
        if (f.lengthDelimitedValue) {
          const kFields = readProtoFields(f.lengthDelimitedValue);
          for (const kf of kFields) {
            if (kf.fieldNumber === 1 && kf.varintValue !== undefined) msg.keyCode = kf.varintValue;
            if (kf.fieldNumber === 2 && kf.varintValue !== undefined) msg.keyDirection = kf.varintValue;
          }
        }
        break;
      }
      case 20: { // remote_ime_key_inject
        msg.hasImeKeyInject = true;
        if (f.lengthDelimitedValue) {
          const sub = readProtoFields(f.lengthDelimitedValue);
          for (const sf of sub) {
            if (sf.fieldNumber === 1 && sf.lengthDelimitedValue) {
              const appInfo = readProtoFields(sf.lengthDelimitedValue);
              const pkg = appInfo.find((x) => x.fieldNumber === 12 && x.lengthDelimitedValue);
              if (pkg?.lengthDelimitedValue) msg.currentAppPackage = textDecoder.decode(pkg.lengthDelimitedValue);
              const c = appInfo.find((x) => x.fieldNumber === 1 && x.varintValue !== undefined);
              if (c?.varintValue !== undefined) msg.imeCounter = c.varintValue;
            } else if (sf.fieldNumber === 2 && sf.lengthDelimitedValue) {
              const status = readProtoFields(sf.lengthDelimitedValue);
              const fc = status.find((x) => x.fieldNumber === 1 && x.varintValue !== undefined);
              if (fc?.varintValue !== undefined) msg.imeFieldCounter = fc.varintValue;
            }
          }
        }
        break;
      }
      case 21: { // remote_ime_batch_edit
        msg.hasImeBatchEdit = true;
        break;
      }
      case 22: { // remote_ime_show_request
        msg.hasImeShowRequest = true;
        break;
      }
      case 40: { // remote_start
        msg.hasStart = true;
        if (f.lengthDelimitedValue) {
          const sFields = readProtoFields(f.lengthDelimitedValue);
          const st = sFields.find((x) => x.fieldNumber === 1);
          if (st?.varintValue !== undefined) msg.isStarted = st.varintValue === 1;
        }
        break;
      }
      case 50: { // remote_set_volume_level
        msg.hasVolumeLevel = true;
        if (f.lengthDelimitedValue) {
          const vFields = readProtoFields(f.lengthDelimitedValue);
          for (const vf of vFields) {
            if (vf.fieldNumber === 6 && vf.varintValue !== undefined) msg.volumeMax = vf.varintValue;
            if (vf.fieldNumber === 7 && vf.varintValue !== undefined) msg.volumeLevel = vf.varintValue;
            if (vf.fieldNumber === 8 && vf.varintValue !== undefined) msg.volumeMuted = vf.varintValue === 1;
          }
        }
        break;
      }
      case 90: { // remote_app_link_launch_request
        msg.hasAppLinkLaunch = true;
        if (f.lengthDelimitedValue) {
          const aFields = readProtoFields(f.lengthDelimitedValue);
          const link = aFields.find((x) => x.fieldNumber === 1 && x.lengthDelimitedValue);
          if (link?.lengthDelimitedValue) msg.appLink = textDecoder.decode(link.lengthDelimitedValue);
        }
        break;
      }
    }
  }

  return msg;
}
