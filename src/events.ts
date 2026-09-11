import { EventEmitter } from "node:events";

export const bus = new EventEmitter();
bus.setMaxListeners(50);

export type LoadRow = Record<string, unknown>;

export function publishLoad(load: LoadRow): void {
  bus.emit("load", load);
}

export function publishVoice(action: LoadRow): void {
  bus.emit("voice", action);
}
