import { useCallback, useEffect, useMemo, useRef, type SetStateAction } from 'react';
import type { GameName } from '../api';
import type { Saved } from '../useSavedGame';
import { addRecords, sendRecords } from './outbox';
import { track, type Tick } from './run';

// What a game screen tells the stats: nothing it draws depends on any of this.
export type Tracker = { tip(): void; onScreen(on: boolean): void };

type Link<G extends GameName> = {
  state: Saved[G] | null;
  setState: (action: SetStateAction<Saved[G] | null>) => void;
  giveUp: () => void;
};

// The device's own calendar: a day is the day it was where the player is.
function localDay(): string {
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Wraps a saved game so each change is counted. Time and tips wait here, on the device, and
// go into the save with the next real move: no save is ever sent for them alone.
export function useTracked<G extends GameName>(game: G, saved: Link<G>) {
  const { setState, giveUp: givenUp } = saved;
  const pending = useRef({ seconds: 0, tips: 0 });
  const clock = useRef<{ onScreen: boolean; since: number | null }>({ onScreen: false, since: null });
  const latest = useRef(saved.state);
  latest.current = saved.state;

  const stopClock = useCallback(() => {
    if (clock.current.since !== null) pending.current.seconds += (performance.now() - clock.current.since) / 1000;
    clock.current.since = null;
  }, []);
  const startClock = useCallback(() => {
    if (clock.current.onScreen && clock.current.since === null && document.visibilityState === 'visible') {
      clock.current.since = performance.now();
    }
  }, []);

  useEffect(() => {
    const onVisible = () => (document.visibilityState === 'visible' ? startClock() : stopClock());
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [startClock, stopClock]);

  const counted = useCallback(
    (prev: Saved[G] | null, next: Saved[G] | null) => {
      stopClock();
      const tick: Tick = { today: localDay(), ...pending.current, newId };
      const { save, records, spent } = track(game, prev, next, tick);
      if (spent) pending.current = { seconds: 0, tips: 0 };
      latest.current = save;
      startClock();
      if (records.length > 0) {
        addRecords(records);
        void sendRecords();
      }
      return save;
    },
    [game, startClock, stopClock],
  );

  const onGame = useCallback(
    (action: SetStateAction<Saved[G] | null>) =>
      setState((prev) => counted(prev, typeof action === 'function' ? (action as (s: Saved[G] | null) => Saved[G] | null)(prev) : action)),
    [counted, setState],
  );

  const giveUp = useCallback(() => {
    counted(latest.current, null);
    givenUp();
  }, [counted, givenUp]);

  const tracker = useMemo<Tracker>(
    () => ({
      tip() {
        pending.current.tips += 1;
      },
      onScreen(on) {
        clock.current.onScreen = on;
        if (on) startClock();
        else stopClock();
      },
    }),
    [startClock, stopClock],
  );

  return { onGame, giveUp, tracker };
}

// A game screen's mount and unmount, for the clock.
export function useOnScreen(tracker: Tracker | undefined, on = true): void {
  useEffect(() => {
    if (!tracker || !on) return;
    tracker.onScreen(true);
    return () => tracker.onScreen(false);
  }, [tracker, on]);
}
