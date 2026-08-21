import { EventEmitter } from "node:events";

const controller = new AbortController();
const events = new EventEmitter();
const promise = new Promise<void>(() => undefined);
const interval = setInterval(() => undefined, 100);
const timeout = setTimeout(() => undefined, 100);

void controller;
void events;
void promise;
void interval;
void timeout;
