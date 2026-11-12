/**
 * TN-188 device-gate TLS server (host side).
 *
 * The API-30 emulator guest's SERVER-mode Conscrypt handshake fails with a
 * mutual read-EOF even though the ClientHello provably reaches the peer
 * (raw-byte probe, 2026-11-09), while guest CLIENT-mode TLS works (an
 * outward handshake to a real CA endpoint succeeds). The device gate
 * therefore runs its TLS server HERE, on the host, reachable from the
 * guest through the emulator's 10.0.2.2 loopback alias — the guest only
 * ever uses its proven client mode.
 *
 * Protocol on every accepted TLS connection:
 *   1. the server presents the self-signed certificate given on argv;
 *   2. it REQUESTS a client certificate (requestCert) but accepts any
 *      (rejectUnauthorized: false) — the CLIENT's certificate is evidence,
 *      verified by the test against the keys identity, not by a CA;
 *   3. it sends `SERVER:<sha256 of its own leaf cert DER>\nCLIENT:<sha256
 *      of the peer cert DER, or none>\n` as the first application bytes;
 *   4. it echoes everything afterwards, so the test proves data flows.
 *
 * The chosen port is written to --port-file because the runner starts this
 * server before the instrumentation exists.
 */
import { createHash, X509Certificate } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import tls from "node:tls";

const [, , certPath, keyPath, portFile] = process.argv;
if (!certPath || !keyPath || !portFile) {
  console.error("usage: node tn188_tls_server.mjs <cert.pem> <key.pem> <port-file>");
  process.exit(2);
}

const certPem = readFileSync(certPath);
const serverFingerprint = createHash("sha256")
  .update(new X509Certificate(certPem).raw)
  .digest("hex");

const server = tls.createServer(
  {
    cert: certPem,
    key: readFileSync(keyPath),
    requestCert: true,
    rejectUnauthorized: false, // client-cert evidence is verified by the test, not a CA
  },
  (socket) => {
    console.log(`tls connection: authorized=${socket.authorized} cipher=${socket.getCipher()?.name} peer=${!!socket.getPeerCertificate()?.raw}`);
    const peerCert = socket.getPeerCertificate();
    const peerFingerprint =
      peerCert && peerCert.raw
        ? createHash("sha256").update(peerCert.raw).digest("hex")
        : "none";
    socket.write(`SERVER:${serverFingerprint}\nCLIENT:${peerFingerprint}\n`);
    socket.pipe(socket); // echo, proving data flows after the handshake
    socket.on("error", () => socket.destroy()); // a wrong-pin client aborts mid-handshake
  },
);

server.on("tlsClientError", (error, socket) => {
  console.error(`tlsClientError: ${error.message}`);
});
server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  writeFileSync(portFile, String(port));
  console.log(`tn188 tls server listening on 127.0.0.1:${port} (server fp ${serverFingerprint})`);
});
