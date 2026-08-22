/**
 * Pre-allocated telemetry buffers (doc 19 §19.7, `SENS-NFR-003`).
 *
 * A 2.5 s flick trial at 1000 Hz polling and 144 Hz rendering produces roughly 2,900 samples,
 * and a Standard session produces on the order of 1.5 million. None of it is transmitted
 * (doc 22) and none of it may allocate: the buffers are typed arrays, sized once from the
 * plan, and reused between trials. Allocating per sample would put the garbage collector in
 * the middle of a latency measurement, which is exactly the kind of quiet corruption this
 * product cannot detect after the fact.
 *
 * ## The overflow policy is asymmetric, on purpose
 *
 * doc 19 §19.7 requires that overflow drop the **oldest frame samples**, never input samples
 * and never button events. The three streams are therefore separate buffers with different
 * behaviour:
 *
 *  - **Frame samples** are a true ring: they overwrite oldest-first. They exist to describe
 *    what was drawn, and losing the early part of that costs little.
 *  - **Input samples** are linear. If they ever filled — which correct sizing prevents — the
 *    buffer stops appending and flags the trial, keeping a contiguous prefix. Overwriting
 *    oldest-first would silently corrupt path length and correction counting, producing a
 *    plausible wrong number instead of an obviously incomplete one.
 *  - **Button events** are linear and generously sized; they are the smallest stream and the
 *    most consequential, since a lost press is a lost hit.
 */

export interface SampleBufferOptions {
  readonly inputCapacity: number;
  readonly frameCapacity: number;
  readonly eventCapacity: number;
}

export interface SampleView {
  readonly t: Float64Array;
  readonly yaw: Float64Array;
  readonly pitch: Float64Array;
  readonly count: number;
}

export interface EventView {
  readonly t: Float64Array;
  /** 0 = press, 1 = release. */
  readonly phase: Uint8Array;
  readonly button: Uint8Array;
  readonly count: number;
}

export interface TelemetryBuffers {
  /** Records one input-derived camera sample. */
  recordInput(t: number, yawDeg: number, pitchDeg: number): void;
  /** Records one rendered-frame camera sample. */
  recordFrame(t: number, yawDeg: number, pitchDeg: number): void;
  recordEvent(t: number, phase: 0 | 1, button: number): void;

  /** Clears the buffers for a new trial. Does not reallocate. */
  reset(): void;

  /** True when any stream lost or refused data during this trial. */
  readonly overflowed: boolean;

  input(): SampleView;
  frames(): SampleView;
  events(): EventView;

  readonly capacity: SampleBufferOptions;
}

/**
 * Sizes the buffers for a trial.
 *
 * Headroom is deliberate: an 8000 Hz mouse under a browser that batches aggressively can burst
 * well above its nominal rate, and a buffer that is merely adequate on average will overflow
 * on exactly the trials where the player moved fastest.
 */
export function sizeBuffers(options: {
  readonly timeoutMs: number;
  readonly maxPollingRateHz: number;
  readonly maxRefreshHz: number;
  readonly headroom?: number;
}): SampleBufferOptions {
  const headroom = options.headroom ?? 1.5;
  const seconds = options.timeoutMs / 1000;

  return {
    inputCapacity: Math.max(256, Math.ceil(seconds * options.maxPollingRateHz * headroom)),
    frameCapacity: Math.max(128, Math.ceil(seconds * options.maxRefreshHz * headroom)),
    eventCapacity: 256,
  };
}

export function createTelemetryBuffers(capacity: SampleBufferOptions): TelemetryBuffers {
  const inputT = new Float64Array(capacity.inputCapacity);
  const inputYaw = new Float64Array(capacity.inputCapacity);
  const inputPitch = new Float64Array(capacity.inputCapacity);
  let inputCount = 0;

  const frameT = new Float64Array(capacity.frameCapacity);
  const frameYaw = new Float64Array(capacity.frameCapacity);
  const framePitch = new Float64Array(capacity.frameCapacity);
  let frameCount = 0;
  let frameStart = 0;

  const eventT = new Float64Array(capacity.eventCapacity);
  const eventPhase = new Uint8Array(capacity.eventCapacity);
  const eventButton = new Uint8Array(capacity.eventCapacity);
  let eventCount = 0;

  let overflowed = false;

  // Scratch views, reused so that reading the buffers allocates nothing either. They are
  // resized only when the retained count changes, via subarray, which does not copy.
  const frameOrdered = {
    t: new Float64Array(capacity.frameCapacity),
    yaw: new Float64Array(capacity.frameCapacity),
    pitch: new Float64Array(capacity.frameCapacity),
  };

  return {
    get capacity() {
      return capacity;
    },
    get overflowed() {
      return overflowed;
    },

    recordInput(t: number, yawDeg: number, pitchDeg: number): void {
      if (inputCount >= capacity.inputCapacity) {
        // Keep the contiguous prefix rather than a corrupted whole; the flag makes the trial
        // visibly incomplete instead of quietly wrong.
        overflowed = true;
        return;
      }
      inputT[inputCount] = t;
      inputYaw[inputCount] = yawDeg;
      inputPitch[inputCount] = pitchDeg;
      inputCount += 1;
    },

    recordFrame(t: number, yawDeg: number, pitchDeg: number): void {
      const slot = (frameStart + frameCount) % capacity.frameCapacity;
      frameT[slot] = t;
      frameYaw[slot] = yawDeg;
      framePitch[slot] = pitchDeg;

      if (frameCount < capacity.frameCapacity) {
        frameCount += 1;
      } else {
        // Full ring: the write above overwrote the oldest entry, so advance the start.
        frameStart = (frameStart + 1) % capacity.frameCapacity;
        overflowed = true;
      }
    },

    recordEvent(t: number, phase: 0 | 1, button: number): void {
      if (eventCount >= capacity.eventCapacity) {
        overflowed = true;
        return;
      }
      eventT[eventCount] = t;
      eventPhase[eventCount] = phase;
      eventButton[eventCount] = button;
      eventCount += 1;
    },

    reset(): void {
      inputCount = 0;
      frameCount = 0;
      frameStart = 0;
      eventCount = 0;
      overflowed = false;
    },

    input(): SampleView {
      return {
        t: inputT.subarray(0, inputCount),
        yaw: inputYaw.subarray(0, inputCount),
        pitch: inputPitch.subarray(0, inputCount),
        count: inputCount,
      };
    },

    frames(): SampleView {
      // The ring is contiguous only when it has not wrapped. When it has, the samples are
      // unrolled into the scratch arrays so consumers always see chronological order.
      if (frameStart === 0) {
        return {
          t: frameT.subarray(0, frameCount),
          yaw: frameYaw.subarray(0, frameCount),
          pitch: framePitch.subarray(0, frameCount),
          count: frameCount,
        };
      }

      for (let i = 0; i < frameCount; i += 1) {
        const slot = (frameStart + i) % capacity.frameCapacity;
        frameOrdered.t[i] = frameT[slot] as number;
        frameOrdered.yaw[i] = frameYaw[slot] as number;
        frameOrdered.pitch[i] = framePitch[slot] as number;
      }

      return {
        t: frameOrdered.t.subarray(0, frameCount),
        yaw: frameOrdered.yaw.subarray(0, frameCount),
        pitch: frameOrdered.pitch.subarray(0, frameCount),
        count: frameCount,
      };
    },

    events(): EventView {
      return {
        t: eventT.subarray(0, eventCount),
        phase: eventPhase.subarray(0, eventCount),
        button: eventButton.subarray(0, eventCount),
        count: eventCount,
      };
    },
  };
}
