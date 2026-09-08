/** Audit sink (BE-PIPE-012): every mutating endpoint writes an event. */
export class AuditRepository {
  constructor() {
    this.events = [];
  }

  async record(event) {
    const full = { id: crypto.randomUUID(), at: Date.now(), ...event };
    this.events.push(full);
    return full;
  }

  list(filter = {}) {
    return this.events.filter(
      (e) =>
        (!filter.actorDidHash || e.actorDidHash === filter.actorDidHash) &&
        (!filter.action || e.action === filter.action),
    );
  }
}
