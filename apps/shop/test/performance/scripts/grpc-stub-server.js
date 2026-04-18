'use strict';

/**
 * gRPC stub server for B3 circuit-breaker before-state capture.
 *
 * Completes the full HTTP/2 + gRPC handshake so the client channel
 * reaches READY state, but every RPC handler hangs forever (callback
 * is never called).  This forces the shop's rxjs timeout(PAYMENTS_GRPC_TIMEOUT_MS)
 * to fire on every authorize() call, reproducing the full retry stall:
 *   3 × 5 s timeouts + 3 × 2 s delays = ~21 s per message → queue backs up.
 *
 * Run: node apps/shop/test/performance/scripts/grpc-stub-server.js
 * (from monorepo root — needs @grpc/grpc-js in node_modules)
 */

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const fs = require('node:fs');
const path = require('node:path');

// In the grpc-stub Docker image, __dirname is /app and the proto is baked at
// dist/apps/shop/proto/payments.proto (from the prod-base build stage).
// When run from source on host, fallback walks up to the monorepo root /proto/.
const containerProto = path.join(__dirname, 'dist/apps/shop/proto/payments.proto');
const sourceProto = path.join(__dirname, '../../../../../proto/payments.proto');
const PROTO_PATH = fs.existsSync(containerProto) ? containerProto : sourceProto;

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const proto = grpc.loadPackageDefinition(packageDefinition);

const server = new grpc.Server();

// Never call callback — RPCs hang until client-side timeout fires.
const hang = (_call, _callback) => {};

server.addService(proto.payments.Payments.service, {
  Authorize: hang,
  GetPaymentStatus: hang,
  Capture: hang,
  Refund: hang,
  Ping: hang,
});

const PORT = process.env.GRPC_STUB_PORT || '5001';

server.bindAsync(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
  if (err) {
    console.error('grpc-stub: failed to bind:', err.message);
    process.exit(1);
  }
  console.log(`grpc-stub: listening on :${port} — all RPCs hang until client timeout fires`);
});
