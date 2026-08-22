import { describe, expect, it, vi } from "vitest";
import { createPointerLockInput } from "@/test-engine/input/pointer-lock";
import type { ButtonEvent, InputSink, MovementSample } from "@/test-engine/input/types";

/**
 * The browser input source (doc 19 §19.4, **EV-010**).
 *
 * `unadjustedMovement` is the single most consequential flag in the product: without it,
 * Windows pointer acceleration sits between the hand and the measurement as a velocity-
 * dependent curve that cannot be inverted after the fact (doc 11 §11.8). Exactly how each
 * browser signals a refusal is still an open verification item, so the source handles the three
 * shapes seen in the wild and — critically — reports anything it cannot *confirm* as not
 * effective. Assuming success would silently overstate the quality of every session on a
 * browser that quietly ignored the option.
 *
 * The DOM is doubled rather than emulated. Every listener, the lock element and the options bag
 * are the real contract; only the browser behind them is fake, which is what lets a refusal be
 * tested at all — no real browser can be asked to refuse on demand.
 */

interface FakeDom {
  readonly element: HTMLElement;
  readonly document: Document;
  readonly window: Window;
  /** Fires a DOM event at the document. */
  emit(type: string, event?: Record<string, unknown>): void;
  emitWindow(type: string, event?: Record<string, unknown>): void;
  lock(): void;
  unlock(): void;
  readonly listenerCount: number;
  readonly lockOptions: unknown[];
  exitCalls: number;
}

interface FakeDomOptions {
  /** How `requestPointerLock` behaves when given the options bag. */
  readonly withOptions?: "resolves" | "rejects" | "throws" | "undefined" | "missing";
  /** How the bare `requestPointerLock()` behaves. */
  readonly plain?: "resolves" | "rejects";
  /** Whether the lock actually takes effect. */
  readonly locks?: boolean;
}

function createFakeDom(options: FakeDomOptions = {}): FakeDom {
  const listeners = new Map<string, Set<EventListener>>();
  const windowListeners = new Map<string, Set<EventListener>>();
  const lockOptions: unknown[] = [];
  const locks = options.locks ?? true;

  let pointerLockElement: unknown = null;
  let exitCalls = 0;

  const add = (map: Map<string, Set<EventListener>>) => (type: string, listener: EventListener) => {
    const set = map.get(type) ?? new Set<EventListener>();
    set.add(listener);
    map.set(type, set);
  };
  const remove =
    (map: Map<string, Set<EventListener>>) => (type: string, listener: EventListener) => {
      map.get(type)?.delete(listener);
    };

  const element = {
    clientWidth: 1920,
    clientHeight: 1080,
    requestPointerLock(bag?: unknown): Promise<void> | undefined {
      if (bag !== undefined) {
        lockOptions.push(bag);
        switch (options.withOptions ?? "resolves") {
          case "rejects":
            return Promise.reject(new DOMException("not supported", "NotSupportedError"));
          case "throws":
            throw new TypeError("unadjustedMovement is not a recognised option");
          case "undefined":
            // Older browsers return nothing and ignore the bag entirely.
            if (locks) pointerLockElement = element;
            return undefined;
          case "resolves":
          default:
            if (locks) pointerLockElement = element;
            return Promise.resolve();
        }
      }

      if ((options.plain ?? "resolves") === "rejects") {
        return Promise.reject(new DOMException("denied", "NotAllowedError"));
      }
      if (locks) pointerLockElement = element;
      return Promise.resolve();
    },
    get ownerDocument() {
      return document;
    },
  };

  if ((options.withOptions ?? "resolves") === "missing") {
    Reflect.deleteProperty(element, "requestPointerLock");
  }

  const document = {
    addEventListener: add(listeners),
    removeEventListener: remove(listeners),
    visibilityState: "visible" as DocumentVisibilityState,
    get pointerLockElement() {
      return pointerLockElement;
    },
    exitPointerLock(): void {
      exitCalls += 1;
      pointerLockElement = null;
    },
    defaultView: null as unknown,
  };

  const view = {
    addEventListener: add(windowListeners),
    removeEventListener: remove(windowListeners),
    devicePixelRatio: 1,
  };
  document.defaultView = view;

  const fire = (
    map: Map<string, Set<EventListener>>,
    type: string,
    event: Record<string, unknown>,
  ) => {
    for (const listener of map.get(type) ?? []) listener(event as unknown as Event);
  };

  return {
    element: element as unknown as HTMLElement,
    document: document as unknown as Document,
    window: view as unknown as Window,
    lockOptions,
    get exitCalls() {
      return exitCalls;
    },
    set exitCalls(value: number) {
      exitCalls = value;
    },
    get listenerCount() {
      let total = 0;
      for (const set of listeners.values()) total += set.size;
      for (const set of windowListeners.values()) total += set.size;
      return total;
    },
    emit: (type, event = {}) => fire(listeners, type, event),
    emitWindow: (type, event = {}) => fire(windowListeners, type, event),
    lock: () => {
      pointerLockElement = element;
    },
    unlock: () => {
      pointerLockElement = null;
    },
  };
}

function createRecordingSink(): InputSink & {
  readonly moves: MovementSample[];
  readonly buttons: ButtonEvent[];
  readonly locks: boolean[];
  readonly focus: boolean[];
  readonly surfaces: string[];
  readonly keys: string[];
} {
  const moves: MovementSample[] = [];
  const buttons: ButtonEvent[] = [];
  const locks: boolean[] = [];
  const focus: boolean[] = [];
  const surfaces: string[] = [];
  const keys: string[] = [];

  return {
    moves,
    buttons,
    locks,
    focus,
    surfaces,
    keys,
    onMove: (sample) => moves.push(sample),
    onButton: (event) => buttons.push(event),
    onLockChange: (locked) => locks.push(locked),
    onFocusChange: (focused) => focus.push(focused),
    onSurfaceChange: (reason) => surfaces.push(reason),
    onKey: (key) => keys.push(key),
  };
}

const build = (dom: FakeDom, requestUnadjustedMovement?: boolean) =>
  createPointerLockInput({
    element: dom.element,
    document: dom.document,
    window: dom.window,
    ...(requestUnadjustedMovement === undefined ? {} : { requestUnadjustedMovement }),
  });

describe("requesting raw movement — EV-010", () => {
  it("reports raw input effective when the browser confirms it", async () => {
    const dom = createFakeDom({ withOptions: "resolves" });
    const outcome = await build(dom).requestLock();

    expect(dom.lockOptions).toEqual([{ unadjustedMovement: true }]);
    expect(outcome).toEqual({
      locked: true,
      unadjustedMovementRequested: true,
      unadjustedMovementEffective: true,
    });
  });

  it("falls back to a plain lock when the option is rejected", async () => {
    // A refusal of the option must cost the session some confidence, never cost the user their
    // calibration.
    const dom = createFakeDom({ withOptions: "throws" });
    const outcome = await build(dom).requestLock();

    expect(outcome.locked).toBe(true);
    expect(outcome.unadjustedMovementRequested).toBe(true);
    expect(outcome.unadjustedMovementEffective).toBe(false);
  });

  it("treats a silent downgrade as not effective, never as success", async () => {
    // The lock succeeds and nothing confirms the option took effect. Assuming it did would
    // overstate the quality of every session on that browser.
    const dom = createFakeDom({ withOptions: "undefined" });
    const outcome = await build(dom).requestLock();

    expect(outcome.locked).toBe(true);
    expect(outcome.unadjustedMovementEffective).toBe(false);
  });

  it("handles a rejected promise as well as a thrown error", async () => {
    const dom = createFakeDom({ withOptions: "rejects" });
    const outcome = await build(dom).requestLock();

    expect(outcome.unadjustedMovementEffective).toBe(false);
    expect(outcome.locked).toBe(true);
  });

  it("reports a denied lock with its reason rather than pretending to be locked", async () => {
    const dom = createFakeDom({ withOptions: "throws", plain: "rejects", locks: false });
    const outcome = await build(dom).requestLock();

    expect(outcome.locked).toBe(false);
    expect(outcome.unadjustedMovementEffective).toBe(false);
    expect(outcome.failureReason).toBeDefined();
  });

  it("reports an unsupported browser distinctly", async () => {
    const dom = createFakeDom({ withOptions: "missing" });
    const outcome = await build(dom).requestLock();

    expect(outcome).toEqual({
      locked: false,
      unadjustedMovementRequested: false,
      unadjustedMovementEffective: false,
      failureReason: "pointer_lock_unsupported",
    });
  });

  it("skips the option entirely for the degradation probe", async () => {
    const dom = createFakeDom();
    const outcome = await build(dom, false).requestLock();

    expect(dom.lockOptions).toEqual([]);
    expect(outcome.unadjustedMovementRequested).toBe(false);
    expect(outcome.unadjustedMovementEffective).toBe(false);
  });

  it("forgets that raw input was effective once the lock is lost", async () => {
    const dom = createFakeDom();
    const source = build(dom);
    const sink = createRecordingSink();
    source.attach(sink);

    await source.requestLock();
    expect(source.state.unadjustedMovementEffective).toBe(true);

    dom.unlock();
    dom.emit("pointerlockchange");

    expect(source.state.unadjustedMovementEffective).toBe(false);
    expect(sink.locks).toEqual([false]);
  });
});

describe("movement delivery", () => {
  it("delivers every coalesced sample, not one per frame", () => {
    // A 1000 Hz mouse contributes 1000 integration steps per second. Taking only the event
    // itself would collapse them to one per frame and erase the sub-frame path entirely.
    const dom = createFakeDom();
    const source = build(dom);
    const sink = createRecordingSink();
    source.attach(sink);
    dom.lock();

    dom.emit("pointermove", {
      timeStamp: 100,
      movementX: 9,
      movementY: 9,
      getCoalescedEvents: () => [
        { timeStamp: 97, movementX: 3, movementY: 1 },
        { timeStamp: 98, movementX: 3, movementY: 4 },
        { timeStamp: 99, movementX: 3, movementY: 4 },
      ],
    });

    expect(sink.moves).toEqual([
      { t: 97, dx: 3, dy: 1 },
      { t: 98, dx: 3, dy: 4 },
      { t: 99, dx: 3, dy: 4 },
    ]);
  });

  it("falls back to the event itself where coalescing is unavailable", () => {
    const dom = createFakeDom();
    const source = build(dom);
    const sink = createRecordingSink();
    source.attach(sink);
    dom.lock();

    dom.emit("pointermove", { timeStamp: 42, movementX: 5, movementY: -2 });
    expect(sink.moves).toEqual([{ t: 42, dx: 5, dy: -2 }]);
  });

  it("uses the event's own timestamp, not the frame's", () => {
    const dom = createFakeDom();
    const source = build(dom);
    const sink = createRecordingSink();
    source.attach(sink);
    dom.lock();

    dom.emit("pointermove", {
      timeStamp: 500,
      movementX: 1,
      movementY: 0,
      getCoalescedEvents: () => [{ timeStamp: 493.25, movementX: 1, movementY: 0 }],
    });

    expect(sink.moves[0]?.t).toBe(493.25);
  });

  it("ignores movement and clicks while unlocked", () => {
    // Input outside the lock is the desktop cursor moving, not the player aiming.
    const dom = createFakeDom();
    const source = build(dom);
    const sink = createRecordingSink();
    source.attach(sink);

    dom.emit("pointermove", { timeStamp: 10, movementX: 100, movementY: 100 });
    dom.emit("mousedown", { timeStamp: 11, button: 0 });

    expect(sink.moves).toEqual([]);
    expect(sink.buttons).toEqual([]);
  });

  it("reports presses and releases with their button and timestamp", () => {
    const dom = createFakeDom();
    const source = build(dom);
    const sink = createRecordingSink();
    source.attach(sink);
    dom.lock();

    dom.emit("mousedown", { timeStamp: 200, button: 0 });
    dom.emit("mouseup", { timeStamp: 245, button: 0 });

    expect(sink.buttons).toEqual([
      { t: 200, button: 0, phase: "down" },
      { t: 245, button: 0, phase: "up" },
    ]);
  });
});

describe("environmental events", () => {
  it("reports focus loss from both blur and visibility change", () => {
    const dom = createFakeDom();
    const source = build(dom);
    const sink = createRecordingSink();
    source.attach(sink);

    dom.emitWindow("blur");
    expect(sink.focus).toEqual([false]);

    Reflect.set(dom.document, "visibilityState", "hidden");
    dom.emit("visibilitychange");
    expect(sink.focus).toEqual([false, false]);
  });

  it("passes Escape through so the engine can pause", () => {
    const dom = createFakeDom();
    const source = build(dom);
    const sink = createRecordingSink();
    source.attach(sink);

    dom.emit("keydown", { key: "Escape", timeStamp: 900 });
    expect(sink.keys).toEqual(["Escape"]);
  });

  it("exits the lock only when it holds one", () => {
    const dom = createFakeDom();
    const source = build(dom);

    source.releaseLock();
    expect(dom.exitCalls).toBe(0);

    dom.lock();
    source.releaseLock();
    expect(dom.exitCalls).toBe(1);
  });

  it("removes every listener it added on detach", () => {
    // A source that leaked listeners would keep feeding a destroyed engine, and the second
    // session on the page would see the first one's input.
    const dom = createFakeDom();
    const source = build(dom);
    const sink = createRecordingSink();

    expect(dom.listenerCount).toBe(0);
    source.attach(sink);
    expect(dom.listenerCount).toBeGreaterThan(0);

    source.detach();
    expect(dom.listenerCount).toBe(0);

    dom.lock();
    dom.emit("pointermove", { timeStamp: 1, movementX: 50, movementY: 0 });
    expect(sink.moves).toEqual([]);
  });

  it("survives a document with no default view", async () => {
    const dom = createFakeDom();
    Reflect.set(dom.document, "defaultView", null);
    const source = createPointerLockInput({ element: dom.element, document: dom.document });

    const sink = createRecordingSink();
    expect(() => {
      source.attach(sink);
    }).not.toThrow();
    await expect(source.requestLock()).resolves.toMatchObject({ locked: true });
    source.detach();
  });

  it("reports a resize and a display change, and stops observing on detach", () => {
    // The canvas size fixes the angular-to-pixel mapping for the session. A resize, or a move
    // to a display with a different pixel ratio, means the session is no longer internally
    // comparable (doc 19 §19.5) — so it is surfaced, not absorbed.
    const observers: { callback: () => void; disconnected: boolean }[] = [];
    class FakeResizeObserver {
      private readonly entry: { callback: () => void; disconnected: boolean };
      constructor(callback: () => void) {
        this.entry = { callback, disconnected: false };
        observers.push(this.entry);
      }
      observe(): void {
        /* the element is irrelevant to the double */
      }
      disconnect(): void {
        this.entry.disconnected = true;
      }
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);

    const dom = createFakeDom();
    const source = build(dom);
    const sink = createRecordingSink();
    source.attach(sink);

    const observer = observers[0];
    expect(observer).toBeDefined();

    // Same size: nothing changed, so nothing is reported.
    observer?.callback();
    expect(sink.surfaces).toEqual([]);

    Reflect.set(dom.element, "clientWidth", 1280);
    observer?.callback();
    expect(sink.surfaces).toEqual(["resize"]);

    Reflect.set(dom.window, "devicePixelRatio", 2);
    observer?.callback();
    expect(sink.surfaces).toEqual(["resize", "device_pixel_ratio"]);

    source.detach();
    expect(observer?.disconnected).toBe(true);
    vi.unstubAllGlobals();
  });

  it("does not fabricate a timestamp when the event carries one", () => {
    const spy = vi.spyOn(performance, "now");
    const dom = createFakeDom();
    const source = build(dom);
    source.attach(createRecordingSink());
    dom.lock();

    dom.emit("pointermove", { timeStamp: 123, movementX: 1, movementY: 1 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
