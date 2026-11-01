import { useState } from 'react';

const KEY = 'isoca-play-mahjong-slots';

// On unless the player switched it off. A store that will not answer means on.
function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

// Slots on or off for the next game, remembered on this device.
export function useSlotsSetting(): [boolean, (slots: boolean) => void] {
  const [slots, setSlots] = useState(read);
  const set = (next: boolean) => {
    setSlots(next);
    try {
      localStorage.setItem(KEY, next ? 'on' : 'off');
    } catch {
      // Not remembered, but it holds for now.
    }
  };
  return [slots, set];
}
