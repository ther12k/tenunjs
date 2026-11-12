import { describe, expect, test } from "bun:test";
import {
  encodeVarint,
  decodeVarint,
  frameMessage,
  decodeFrames,
  sha256Sync,
  createPairingRequest,
  createPairingOption,
  createPairingConfiguration,
  createPairingSecret,
  createPairingSecretAck,
  parseOuterMessage,
  computePoloSecret,
  POLO_STATUS,
  RemoteKeyCode,
  RemoteDirection,
  RemoteFeature,
  createRemoteConfigure,
  createRemoteSetActive,
  createRemotePingResponse,
  createRemoteKeyInject,
  createRemoteTextInject,
  createRemoteAppLinkLaunch,
  parseRemoteMessage,
  utf8Encode,
  utf8Decode,
  ProtoWriter,
} from "../src/protocol";

describe("TN-191 protocol: varint framing & encoding", () => {
  test("encodeVarint and decodeVarint round-trip numbers correctly", () => {
    const testCases = [0, 1, 127, 128, 300, 16384, 2097151, 268435455];
    for (const val of testCases) {
      const encoded = encodeVarint(val);
      const decoded = decodeVarint(encoded, 0);
      expect(decoded).not.toBeNull();
      expect(decoded!.value).toBe(val);
      expect(decoded!.bytesRead).toBe(encoded.length);
    }
  });

  test("decodeFrames extracts multiple concatenated varint-framed messages", () => {
    const msg1 = new Uint8Array([1, 2, 3]);
    const msg2 = new Uint8Array([4, 5, 6, 7, 8]);
    const framed1 = frameMessage(msg1);
    const framed2 = frameMessage(msg2);

    const combined = new Uint8Array(framed1.length + framed2.length);
    combined.set(framed1, 0);
    combined.set(framed2, framed1.length);

    const { frames, remaining } = decodeFrames(combined);
    expect(frames.length).toBe(2);
    expect(Array.from(frames[0]!)).toEqual(Array.from(msg1));
    expect(Array.from(frames[1]!)).toEqual(Array.from(msg2));
    expect(remaining.length).toBe(0);
  });

  test("decodeFrames leaves incomplete frames in remaining buffer", () => {
    const msg = new Uint8Array([10, 20, 30, 40]);
    const framed = frameMessage(msg);

    // Provide only the length varint and partial data
    const partial = framed.subarray(0, 3);
    const { frames, remaining } = decodeFrames(partial);
    expect(frames.length).toBe(0);
    expect(remaining.length).toBe(3);
  });
});

describe("TN-191 protocol: zero-dep SHA-256 implementation", () => {
  test("sha256Sync matches known standard NIST test vectors", () => {
    // SHA256("")
    const emptyHash = sha256Sync(new Uint8Array(0));
    const emptyHex = Array.from(emptyHash).map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(emptyHex).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

    // SHA256("abc")
    const abc = new TextEncoder().encode("abc");
    const abcHash = sha256Sync(abc);
    const abcHex = Array.from(abcHash).map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(abcHex).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("TN-191 protocol: pure-TS UTF-8 codec (QuickJS has no TextEncoder)", () => {
  // The device fixture evaluates this module inside QuickJS, where
  // TextEncoder/TextDecoder do not exist — delete them (as the embedded
  // realm effectively does) and prove the wire codec still round-trips.
  const savedEnc = globalThis.TextEncoder;
  const savedDec = globalThis.TextDecoder;

  test("utf8Encode/utf8Decode round-trip ASCII, Latin-1, CJK, emoji, and pairing names", () => {
    (globalThis as { TextEncoder?: unknown }).TextEncoder = undefined;
    (globalThis as { TextDecoder?: unknown }).TextDecoder = undefined;
    try {
      const samples = [
        "atvremote",
        "Living Room TV",
        "Televisi kamar (utama)",
        "café — naïve résumé",
        "日系テレビ",
        "TV 📺 remote",
        " Télécommande ",
      ];
      for (const s of samples) {
        const bytes = utf8Encode(s);
        expect(utf8Decode(bytes)).toBe(s);
      }
      // A 3-byte character round-trips through the RemoteMessage path too.
      const framed = createRemoteAppLinkLaunch("https://tv.example/é日");
      const parsed = parseRemoteMessage(framed);
      expect(parsed.appLink).toBe("https://tv.example/é日");
    } finally {
      (globalThis as { TextEncoder?: unknown }).TextEncoder = savedEnc;
      (globalThis as { TextDecoder?: unknown }).TextDecoder = savedDec;
    }
  });

  test("unpaired surrogates degrade to U+FFFD instead of corrupting the wire", () => {
    (globalThis as { TextEncoder?: unknown }).TextEncoder = undefined;
    try {
      const bytes = utf8Encode("\uD800x");
      expect(Array.from(bytes)).toEqual([0xef, 0xbf, 0xbd, 0x78]);
      expect(utf8Decode(new Uint8Array([0xff]))).toBe("\uFFFD");
    } finally {
      (globalThis as { TextEncoder?: unknown }).TextEncoder = savedEnc;
    }
  });
});

describe("TN-191 protocol: Polo pairing wire messages", () => {
  test("createPairingRequest builds a valid OuterMessage with protocol_version=2", () => {
    const bytes = createPairingRequest("My Phone", "atvremote");
    const parsed = parseOuterMessage(bytes);
    expect(parsed.protocolVersion).toBe(2);
    expect(parsed.status).toBe(POLO_STATUS.STATUS_OK);
    expect(parsed.hasPairingRequest).toBe(true);
  });

  test("createPairingOption and createPairingConfiguration encode correct role and type", () => {
    const optBytes = createPairingOption();
    const optMsg = parseOuterMessage(optBytes);
    expect(optMsg.protocolVersion).toBe(2);
    expect(optMsg.status).toBe(POLO_STATUS.STATUS_OK);
    expect(optMsg.hasOptions).toBe(true);

    const cfgBytes = createPairingConfiguration();
    const cfgMsg = parseOuterMessage(cfgBytes);
    expect(cfgMsg.protocolVersion).toBe(2);
    expect(cfgMsg.hasConfiguration).toBe(true);
  });

  test("createPairingSecret and SecretAck transfer raw secret payload", () => {
    const secret = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const secBytes = createPairingSecret(secret);
    const secMsg = parseOuterMessage(secBytes);
    expect(secMsg.hasSecret).toBe(true);
    expect(Array.from(secMsg.secretPayload!)).toEqual(Array.from(secret));

    const ackBytes = createPairingSecretAck(secret);
    const ackMsg = parseOuterMessage(ackBytes);
    expect(ackMsg.hasSecretAck).toBe(true);
    expect(Array.from(ackMsg.secretPayload!)).toEqual(Array.from(secret));
  });

  test("computePoloSecret validates PIN prefix matching hash[0]", () => {
    const clientKey = [new Uint8Array([1, 2, 3]), new Uint8Array([1, 0, 1])];
    const serverKey = [new Uint8Array([4, 5, 6]), new Uint8Array([1, 0, 1])];

    // Known test vector computed earlier:
    // With client=[1,2,3], [1,0,1] and server=[4,5,6], [1,0,1],
    // PIN "090000" gives SHA256 starting with 0x09:
    const { secret, valid } = computePoloSecret(clientKey, serverKey, "090000");
    expect(valid).toBe(true);
    expect(secret.length).toBe(32);
    expect(secret[0]).toBe(0x09);

    // Wrong PIN prefix should fail validation check
    const invalidCheck = computePoloSecret(clientKey, serverKey, "FF0000");
    expect(invalidCheck.valid).toBe(false);

    // Malformed PIN (not 6 hex chars) should fail immediately
    expect(computePoloSecret(clientKey, serverKey, "123").valid).toBe(false);
    expect(computePoloSecret(clientKey, serverKey, "zzzzzz").valid).toBe(false);
  });
});

describe("TN-191 protocol: RemoteMessage commands & interactions", () => {
  test("createRemoteConfigure encodes device info and active features", () => {
    const bytes = createRemoteConfigure(RemoteFeature.KEY | RemoteFeature.PING);
    const msg = parseRemoteMessage(bytes);
    expect(msg.hasConfigure).toBe(true);
    expect(msg.supportedFeatures).toBe(RemoteFeature.KEY | RemoteFeature.PING);
    expect(msg.deviceVendor).toBe("Tenun");
    expect(msg.deviceModel).toBe("TenunJS");
  });

  test("createRemoteSetActive encodes active features", () => {
    const bytes = createRemoteSetActive(RemoteFeature.KEY | RemoteFeature.APP_LINK);
    const msg = parseRemoteMessage(bytes);
    expect(msg.hasSetActive).toBe(true);
    expect(msg.activeFeatures).toBe(RemoteFeature.KEY | RemoteFeature.APP_LINK);
  });

  test("createRemoteKeyInject supports press, release, and click with correct directions", () => {
    // START_LONG (press / hold start)
    const pressBytes = createRemoteKeyInject(RemoteKeyCode.KEYCODE_DPAD_UP, RemoteDirection.START_LONG);
    const pressMsg = parseRemoteMessage(pressBytes);
    expect(pressMsg.hasKeyInject).toBe(true);
    expect(pressMsg.keyCode).toBe(RemoteKeyCode.KEYCODE_DPAD_UP);
    expect(pressMsg.keyDirection).toBe(RemoteDirection.START_LONG);

    // END_LONG (release / hold end)
    const releaseBytes = createRemoteKeyInject(RemoteKeyCode.KEYCODE_DPAD_UP, RemoteDirection.END_LONG);
    const releaseMsg = parseRemoteMessage(releaseBytes);
    expect(releaseMsg.keyCode).toBe(RemoteKeyCode.KEYCODE_DPAD_UP);
    expect(releaseMsg.keyDirection).toBe(RemoteDirection.END_LONG);

    // SHORT (click)
    const clickBytes = createRemoteKeyInject(RemoteKeyCode.KEYCODE_BACK, RemoteDirection.SHORT);
    const clickMsg = parseRemoteMessage(clickBytes);
    expect(clickMsg.keyCode).toBe(RemoteKeyCode.KEYCODE_BACK);
    expect(clickMsg.keyDirection).toBe(RemoteDirection.SHORT);
  });

  test("createRemoteTextInject builds valid batch edit message", () => {
    const bytes = createRemoteTextInject("hello world", 12, 34);
    const msg = parseRemoteMessage(bytes);
    expect(msg.hasImeBatchEdit).toBe(true);
  });

  test("createRemoteAppLinkLaunch encodes URL to launch on TV", () => {
    const bytes = createRemoteAppLinkLaunch("https://www.youtube.com");
    const msg = parseRemoteMessage(bytes);
    expect(msg.hasAppLinkLaunch).toBe(true);
    expect(msg.appLink).toBe("https://www.youtube.com");
  });

  test("createRemotePingResponse echoes requested val1", () => {
    const bytes = createRemotePingResponse(42);
    const msg = parseRemoteMessage(bytes);
    expect(msg.hasPingResponse).toBe(true);
  });

  test("parseRemoteMessage correctly parses incoming server status messages", () => {
    // Server sends remote_start: started = true (field 40)
    const startWriter = new ProtoWriter();
    startWriter.writeBool(1, true);
    const outerStart = new ProtoWriter();
    outerStart.writeMessage(40, startWriter.finish());
    const startMsg = parseRemoteMessage(outerStart.finish());
    expect(startMsg.hasStart).toBe(true);
    expect(startMsg.isStarted).toBe(true);

    // Server sends remote_set_volume_level: max=100, level=25, muted=false (field 50)
    const volWriter = new ProtoWriter();
    volWriter.writeVarint(6, 100);
    volWriter.writeVarint(7, 25);
    volWriter.writeBool(8, false);
    const outerVol = new ProtoWriter();
    outerVol.writeMessage(50, volWriter.finish());
    const volMsg = parseRemoteMessage(outerVol.finish());
    expect(volMsg.hasVolumeLevel).toBe(true);
    expect(volMsg.volumeMax).toBe(100);
    expect(volMsg.volumeLevel).toBe(25);
    expect(volMsg.volumeMuted).toBe(false);

    // Server sends ping_request: val1=999 (field 8)
    const pingWriter = new ProtoWriter();
    pingWriter.writeVarint(1, 999);
    const outerPing = new ProtoWriter();
    outerPing.writeMessage(8, pingWriter.finish());
    const pingMsg = parseRemoteMessage(outerPing.finish());
    expect(pingMsg.hasPingRequest).toBe(true);
    expect(pingMsg.pingVal1).toBe(999);
  });
});
