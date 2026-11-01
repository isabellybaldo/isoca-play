# isoca-play

A small private site with two pixel-art games, mahjong and sudoku, for one player on a
phone. One password in front of everything, one saved game of each kind, and each game
resumes where it was left on any device. A game that has been loaded can be played
offline. There are no ads, trackers or requests to third parties.

The code and the art are public. The password, sessions and saves live only on the
server, and deploy secrets only in GitHub.

## The games

### Mahjong

Pick a difficulty, then a layout or random. Every deal can be won.

- A tile with another on top of it is face down. A face-up tile can be taken only if its
  left or right side is open.
- Two clicks send a tile up: the first selects it, the second sends it to the next empty
  slot.
- There are 4 slots. A pair in the slots leaves right away. If the 4th tile makes no
  pair, the game is lost. An empty board wins.
- Any season matches any season, and any flower any flower. Everything else matches only
  itself.
- Return takes back one send, with no limit, including the one that lost the game.

### Sudoku

Easy, medium or hard, set by the techniques a board needs. Every puzzle has exactly one
solution and can be solved by logic alone.

The game never says a number is wrong while you play. When the board is full it reports
won or not solved, without saying where. You can then return and keep trying, or start
over.

## Run it locally

Needs Python 3.10 or newer, Node 22.12 or newer and openssl. The login cookie is
`__Host-` and the server accepts changes only from an https origin, so even locally it
runs over https, with a throwaway certificate.

    cd web
    npm ci
    npm run build
    cd ../server
    python -m venv .venv
    .venv/bin/pip install --require-hashes -r requirements.txt -r requirements-dev.txt
    .venv/bin/pip install --no-deps -e .
    openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj /CN=localhost \
      -addext subjectAltName=DNS:localhost -keyout /tmp/play-key.pem -out /tmp/play-cert.pem
    export DB_PATH=/tmp/play.db STATIC_DIR=../web/dist
    .venv/bin/isoca-play set-password
    .venv/bin/uvicorn --factory isoca_play.app:app_from_env --port 8443 \
      --ssl-keyfile /tmp/play-key.pem --ssl-certfile /tmp/play-cert.pem

Then open https://localhost:8443 and accept the certificate. On Windows the venv's
programs are in `.venv\Scripts`.

For live frontend work, keep that server running and start `npm run dev` in `web/`; it
proxies to it.

Tests:

    cd web && npm test                                # game rules and pages
    cd server && .venv/bin/python -m pytest           # the image test skips without Docker
    node web/e2e/offline.mjs                          # offline, in real Chrome

The image is built from the repository root: `docker build --build-arg VERSION=dev .`

## Licences

The code and art are under the MIT licence, see [LICENSE](LICENSE).

The fonts VT323, Press Start 2P and IBM Plex Mono are under the SIL Open Font Licence 1.1,
and come through [Fontsource](https://fontsource.org). The licence texts for the two
served on the login page are next to them in `server/isoca_play/public/fonts/`.

The sudoku pack is made by this repository's own grader.
[rustoku](https://github.com/huangsam/rustoku) (MIT) is used only as a cross-check when
making a pack, and is not part of the site.
