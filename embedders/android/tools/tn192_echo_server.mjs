/**
 * TN-192 device-gate echo server (host side).
 *
 * Plain TCP byte-echo: whatever the guest writes is written straight back,
 * so the tvremote latency fixture's key-inject frames return as the
 * "device acknowledgement" observation point. Plain TCP (not TLS) is
 * deliberate: the transport segment then measures the socket round trip,
 * not a TLS record-layer confound — recorded in the digest doc.
 *
 * The chosen port is written to --port-file because the runner starts
 * this server before the instrumentation exists.
 */
import { writeFileSync } from "node:fs";
import net from "node:net";

const [, , portFile] = process.argv;
if (!portFile) {
  console.error("usage: node tn192_echo_server.mjs <port-file>");
  process.exit(2);
}

const server = net.createServer((socket) => {
  socket.on("data", (chunk) => {
    socket.write(chunk); // byte-exact echo: frames come back as sent
  });
  socket.on("error", () => socket.destroy());
});

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  writeFileSync(portFile, String(port));
  console.log(`tn192 echo server listening on 127.0.0.1:${port}`);
});
