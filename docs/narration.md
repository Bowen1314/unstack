# Demo narration (docs/demo.mp4)

Voice: Microsoft Edge neural TTS (`edge-tts`), `en-US-AvaNeural`. One line per scene. Each line starts when its scene starts, and `scripts/narrate_demo.mjs` re-times the recorded frames so every scene lasts at least as long as its line plus a short pause. The burned-in captions stay as recorded.

| # | Scene | Narration |
|---|---|---|
| 1 | Title | This is Unstack. It checks your skincare shelf before you layer it. Every YouCam call in this video is a live API call. |
| 2 | Shelf and label photo | This demo shelf has nine generic products, each with the ingredient families Unstack recognises. To add a product, photograph its label. This label is a test print made for this demo. A vision model on Nebius transcribes the ingredients, and nothing is saved until you review it. |
| 3 | Check | The shelf check flags conflicts, duplicate actives and missing sunscreen. Each finding shows its evidence and sources, and it also says what is fine to combine. Cosmetic guidance, not medical advice. |
| 4 | Plan | The weekly plan keeps conflicting actives in separate sessions, with the retinoid at night. |
| 5 | Scan setup | Before any photo is chosen, Unstack asks for consent. We use Sample A, one of YouCam's own sample faces, sent as a file upload. Eight concerns in HD cost sixteen units, shown before you scan. |
| 6 | Live scan | Each step is a real YouCam API call: an upload slot, the presigned upload, then the skin analysis task, polled until it finishes. |
| 7 | Results | When the results are copied, Unstack deletes the task and the photo at YouCam. These are YouCam's own masks for hydration, pores and redness. Scores are appearance scores, and flagged concerns are mapped to your shelf. |
| 8 | Sun profile | Next, an optional sun profile from YouCam's Fitzpatrick analyser, for ten units. The photo is converted to JPEG in the browser and uploaded. The result, type two, only raises the priority of the sunscreen finding. It is never a diagnosis. |
| 9 | Experiments | Experiments are shown here with demo history, not real scans. Change one product, rescan every two weeks, and compare with your baseline inside a measured noise band. |
| 10 | Privacy | No accounts. The photo is held in server memory and deleted at YouCam, and scores stay in your browser. You can withdraw consent or delete everything at any time. |
| 11 | Outro | Unstack. Built on the YouCam API. |
