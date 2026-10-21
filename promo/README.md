# Promo video

A 35-second marketing animation for Evacuation Roll Call, shown on a floating phone: the alarm, staff seeing the assembly point and checking in by name with GPS, the admin view filling in live, an AI name match, the AI debrief, and an end card.

- **Watch / export:** [claude.ai artifact](https://claude.ai/artifact/My2yv946fbGi2jVvTk7ETk) (private until shared from its Share menu). Use **Export** there for an MP4.
- **Source:** this folder is a copy of the film's code, kept for reference. It runs only inside the Motion player on claude.ai; editing these files doesn't change the video. Edits are made in the artifact.

| File | What it is |
|---|---|
| `scenes.json` | Scene list, order and timings, palette and typefaces |
| `scene-*.js` | One file per scene (alarm, point, checkin, admin, match, debrief, end) |
| `shared.js` | The phone frame and the app screens the scenes share |
| `app.css` | The app's own styles, recreated for the phone screens |
| `base.css` | The film's colours and type |
| `score.js` | Generated music and sound effects |
| `cut.js` | The film's entry point |

Names, times and the assembly point in the video are made-up examples.
