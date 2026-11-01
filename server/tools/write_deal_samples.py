"""Write shared/deal-samples.json from Python deals: 20 per layout, seeds 1 to 20.

Run from server/ after a change to the deals: python tools/write_deal_samples.py
The web suite plays every sample through the real tap; a server test fails if this
file falls behind make_deal.
"""

import json
from pathlib import Path

from isoca_play.mahjong import LAYOUTS, make_deal

TARGET = Path(__file__).resolve().parents[2] / "shared" / "deal-samples.json"


def main() -> None:
    samples = [
        {"layout": layout["id"], "seed": seed, "tiles": make_deal(layout, seed)}
        for layout in LAYOUTS
        for seed in range(1, 21)
    ]
    lines = ",\n".join(json.dumps(s, separators=(",", ":")) for s in samples)
    TARGET.write_text(f"[\n{lines}\n]\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
