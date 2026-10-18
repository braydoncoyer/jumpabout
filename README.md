# Jumpabout

A browser remake of Epyx's *Jumpman Junior* (Randy Glover, 1983), following the Commodore 64 version.
Defuse every bomb across 12 boards of girders, ladders and ropes.

**Play:** https://jumpabout.anthropic-radar.workers.dev

## Controls

| Key | Action |
| --- | --- |
| A / D | Walk |
| W / S | Climb ladders, ride ropes (up-ropes up, down-ropes down) |
| Space | Jump straight up |
| Space + A / D | Leap left / right, including off ladders and ropes |
| P / Esc | Pause |
| M | Sound on / off |
| ` | Debug overlay (control decisions) |
| F9 | Download the last 10 s of input/state as JSON |

## How it was built

- Level layouts, bomb positions, spawn points and the girders/ladders that vanish when certain bombs are defused were mapped from C64 longplay footage (frame-by-frame diffing).
- Jump arc, walk/climb speeds and bullet behaviour were measured from footage.
- Some changes from the original make it more forgiving: solid side walls, mid-air ladder/rope catching, and short grace windows for late jumps.

## Run locally

No build step. Open `index.html` in a browser, or serve the folder with any static server.

## Deploy

Hosted as a Cloudflare Workers static-assets site (free tier):

```
npx wrangler deploy
```

High scores and settings are stored in the browser's `localStorage`.

*Unofficial fan tribute. Jumpman and Jumpman Junior are the property of their respective owners.*
