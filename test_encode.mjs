import { encodeSnapshot, decodeSnapshot } from './src/network/protocol.js';
import { ServerState } from './src/server/server-state.js';

const state = new ServerState();
state.reset();

// Manually put some cards in hands
state.zones[1].push(0); // P1_HAND
state.zones[5].push(1); // P2_HAND

const scratch = new DataView(new ArrayBuffer(1024));
const bytes = encodeSnapshot(state, -1, 0, 0, scratch);

const decoded = decodeSnapshot(bytes, scratch);
console.log("P1_HAND card 0 type:", decoded.type[0]);
console.log("P2_HAND card 1 type:", decoded.type[1]);
console.log("HIDDEN constant:", 255);
