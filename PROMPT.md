# Project: WebAR monster test

I'm not a coder. Explain things simply. Whenever I need to do something, give me exact commands in copyable blocks for Konsole (Kubuntu).

## Goal
A printed sheet with an ArUco marker and a QR code. Scanning the QR with the iPhone camera app opens a website in Safari. The site uses the rear camera, tracks the ArUco marker, and shows an animated 3D monster standing on the marker. Test device: iPhone 16, Safari.

## Hosting
- Create a PRIVATE GitHub repo named `webar-monster-test` using `gh`, and deploy with GitHub Pages (HTTPS).
- First run `gh auth status` and `gh api user --jq .plan.name`. If my plan can't do Pages from a private repo, STOP and explain my options (GitHub Student Developer Pack, Netlify, Cloudflare Pages). Never make the repo public without asking me.

## Tech
- Plain static HTML/CSS/JS, no build step.
- three.js for rendering, js-aruco2 (or equivalent) for marker detection and pose.
- Pin exact library versions that are at least 2 weeks old, and copy them into a /vendor folder in the repo, so the site doesn't depend on a CDN.

## Monster model
- Use a free, animated monster in GLB/glTF from a reputable source with a clear license. Prefer Quaternius (CC0) or the Khronos glTF sample assets.
- Write the source URL, author, and license in CREDITS.md, and show a small credit line on the page.
- If the download needs a manual step, STOP and give me the exact link and where to save the file.
- Keep the GLB under 5 MB (compress if needed). Loop an idle animation.

## Printable markers
- Generate 3 markers, each with a DIFFERENT marker ID, so the site automatically knows each one's physical size:
  - Large: as big as possible on US Letter paper on an HP inkjet (assume 0.25 in printer margins). Keep a white quiet zone of at least one cell width around it, and still fit a QR code on the page.
  - Medium: 100 mm.
  - Small: 50 mm.
- Each page has: the marker, a QR code linking to the live site URL, a label with the marker ID and size, a 100 mm ruler line to check print scale, and the text "Print at 100% / Actual size — do not fit to page".
- Output one 3-page `markers.pdf` with exact millimetre sizes.
- Generate the markers with Python OpenCV in a venv. Make sure the dictionary matches what the browser detector supports, and VERIFY by running the browser detector (in Node) on the generated images.

## Page behaviour
- A start screen with a "Start AR" button. The camera turns on only after the tap. Use the rear camera, and set the video to playsinline and muted.
- A full-screen fixed camera video with the three.js canvas on top. Make the page slightly taller than the viewport, so scrolling down collapses Safari's toolbar and scrolling up brings it back. Use dvh units and safe-area insets.
- Estimate the marker pose from its corners using its known size. Estimate focal length from the iPhone main camera's field of view, stored as an easy-to-edit constant.
- Smooth the pose with a One Euro filter so the monster doesn't jitter.
- The monster stands on the marker, about 1.5x the marker width tall.
- If the marker isn't detected for 0.5 s: hide the monster and show a screen overlay with the monster in a corner, facing me, and the text "Look back at the marker!". Fade back in when the marker is found again.
- Run detection on a downscaled frame (around 640 px wide) for speed.
- Tapping the top-left corner toggles a debug overlay showing FPS, detected marker ID, marker size, and distance.

## Errors and fallbacks
Show friendly messages for:
- not on HTTPS,
- camera permission denied (explain how to re-enable it in iPhone Settings for Safari),
- no camera,
- no WebGL,
- an in-app browser that blocks the camera (tell the user to open the link in Safari or Chrome).

## When done
- Write a simple README.
- Give me the live URL, printing instructions, and a short test checklist (each marker size, distances, lighting, tilting the paper).
