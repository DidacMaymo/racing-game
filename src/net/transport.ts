/** Canal de mensajes bidireccional. PeerJS en producción, memoria en los tests. */
export interface Transport {
  send(msg: unknown): void;
  onMessage(cb: (msg: unknown) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

/**
 * Par de transportes en memoria. Los mensajes se encolan y se entregan al llamar a `flush()`
 * (serializados con JSON, como en la red de verdad).
 */
export function memoryPair(): { a: Transport; b: Transport; flush: () => number } {
  type Side = { msgCbs: ((m: unknown) => void)[]; closeCbs: (() => void)[]; inbox: string[] };
  const sides: [Side, Side] = [
    { msgCbs: [], closeCbs: [], inbox: [] },
    { msgCbs: [], closeCbs: [], inbox: [] },
  ];
  let closed = false;
  const make = (me: number): Transport => {
    const other = sides[1 - me];
    return {
      send(msg) {
        if (!closed) other.inbox.push(JSON.stringify(msg));
      },
      onMessage(cb) {
        sides[me].msgCbs.push(cb);
      },
      onClose(cb) {
        sides[me].closeCbs.push(cb);
      },
      close() {
        if (closed) return;
        closed = true;
        for (const s of sides) for (const cb of s.closeCbs) cb();
      },
    };
  };
  return {
    a: make(0),
    b: make(1),
    flush() {
      let n = 0;
      // entregamos hasta que no quede nada (las respuestas pueden generar más mensajes)
      for (let guard = 0; guard < 100; guard++) {
        let any = false;
        for (const s of sides) {
          const msgs = s.inbox.splice(0);
          for (const m of msgs) {
            any = true;
            n++;
            for (const cb of s.msgCbs) cb(JSON.parse(m));
          }
        }
        if (!any) break;
      }
      return n;
    },
  };
}
