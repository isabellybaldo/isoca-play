import type { SaveStatus } from './useSavedGame';

// Small and calm: nothing at all while saving goes well. It speaks only of saving,
// never of the game itself. The link opens a new tab, so this page and its unsaved game
// stay where they are, and they save by themselves once the login has gone through.
export default function SaveMarker({
  saving,
  signedOut,
  refused = false,
  checking = false,
}: {
  saving: SaveStatus;
  signedOut: boolean;
  refused?: boolean;
  checking?: boolean;
}) {
  let line = null;
  if (refused) {
    line = 'Not saved: the server refused this.';
  } else if (signedOut) {
    line = (
      <>
        Not signed in, not saved. <a href="/login" target="_blank" rel="noopener">Log in</a>
      </>
    );
  } else if (saving === 'offline') {
    line = 'Offline, not saved yet.';
  } else if (saving === 'retrying') {
    line = 'Not saved yet, trying again.';
  } else if (checking) {
    line = 'Checking for newer moves.';
  }
  return <div role="status" className="save-status">{line && <p className="save-marker">{line}</p>}</div>;
}
