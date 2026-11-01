import { Component, type ReactNode } from 'react';

type Props = { name: string; onNewGame: () => void; onHome: () => void; children: ReactNode };

// A game that will not draw takes only its own screen down. The games are held above
// this, so the other one is untouched, and New game is still within reach.
export default class GameBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="shell">
        <h1 className="sd-title">{this.props.name}</h1>
        <p className="start-note">This game could not be opened.</p>
        <div className="boundary-actions">
          <button
            type="button"
            className="back"
            onClick={() => {
              this.props.onNewGame();
              this.setState({ failed: false });
            }}
          >
            New game
          </button>
          <button type="button" className="back" onClick={this.props.onHome}>Back to home</button>
        </div>
      </main>
    );
  }
}
