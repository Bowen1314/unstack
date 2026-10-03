# YouCam API notes

Researched 2026-10-02 from the official docs (docs.perfectcorp.com, API version **v1.16**, released 2026-09-24).
Every machine-readable shape below comes from the OpenAPI bundles the docs site publishes at
`https://docs.perfectcorp.com/_bundle/reference/<name>.yaml`. The Markdown versions are at
`https://docs.perfectcorp.com/<path>.md`, and `https://docs.perfectcorp.com/llms.txt` indexes all of them.

Status tags used below:

- **[doc]**: stated in the official docs or OpenAPI bundle (URL given).
- **[unverified]**: inferred or seen only in examples. It has to be checked with a real key.
- **[3rd-party]**: from a non-doc source (named).
- **[verified 10-02]**: checked against the live API with the project key (see §12).

Live verification ran on 2026-10-02 and spent **26 units** (1040 → 1014) under a 60-unit verification cap. Section 12 has the results, and the redacted recordings are in `fixtures/recorded/`.

---

## 1. Host, auth, accounts

| Item | Value | Source |
|---|---|---|
| API host | `https://yce-api-01.makeupar.com` | [doc] https://docs.perfectcorp.com/develop/api_server |
| Auth | `Authorization: Bearer <API_KEY>`, a single space after `Bearer` | [doc] https://docs.perfectcorp.com/develop/quick_start_guide |
| Console / keys | https://yce.perfectcorp.com/api-console/en/api-keys/ (India mirror: yce.makeupar.com) | [doc] quick start; hackathon /resources page |
| Hackathon units | 1,000 free units via a redemption code that arrives by email after Devpost registration; redeem at https://yce.perfectcorp.com/ai-api | hackathon pages (checked 10-02) |
| 401 body | `{"status":401,"error":"Unauthorized","error_code":"InvalidAccessToken"}` (the clothes docs). The skin-analysis bundle shows only `{"status":401,"error":"Invalid API key"}` | [doc] both shapes exist, so the client accepts both |
| Secret key | The FAQ mentions that a "secret key" is shown only once at creation. The v2 endpoints below use only the Bearer API key | [doc] https://docs.perfectcorp.com/develop/faq. [unverified]: whether anything we call needs the secret |

## 2. Universal flow: file, task, poll, result

Source: https://docs.perfectcorp.com/develop/quick_start_guide and the skin-analysis integration guide in
https://docs.perfectcorp.com/_bundle/reference/ai_skin_analysis.yaml.

### 2.1 Create an upload slot: `POST /s2s/v2.0/file` [doc]

https://docs.perfectcorp.com/reference/file.md, bundle `file.yaml`.

Request:
```json
{ "files": [ { "content_type": "image/jpg", "file_name": "my-selfie.jpg", "file_size": 50000 } ] }
```
- `content_type`: image or video MIME type. The docs use both `image/jpg` and `image/png`.
- `file_size`: bytes. Limits are **10 MB per image** and 100 MB per video.

Response (the shape the integration guide shows):
```json
{
  "status": 200,
  "data": {
    "files": [{
      "content_type": "image/png",
      "file_name": "skin_analysis_01.png",
      "file_id": "SaGaqpDg...FBfaud",
      "requests": [{ "method": "PUT", "url": "https://yce-us.s3-accelerate.amazonaws.com/...", "headers": { "Content-Length": "547541", "Content-Type": "image/png" } }]
    }]
  }
}
```
- The bundle schema `FileResponseV2` is malformed (`data: null` plus a `$ref`), so the client trusts the example above. [verified 10-02] The real nesting is `data.files[0]`, as in the example.
- `file_id` contains `/` and `+`, so it can't be put in a URL unencoded. It is only ever sent in JSON bodies.

### 2.2 Upload the bytes [doc]

`PUT` to `requests[0].url` with **exactly** the returned headers (Content-Type, Content-Length).
Skipping this step makes the task fail later with 500 `unknown_internal_error` or 404.

- [unverified]: whether the S3 bucket allows browser CORS for a direct PUT. Because of that, the app relays the bytes from its own server, in memory only.

### 2.3 Alternative: a public URL instead of a file [doc]

Every task accepts `src_file_url` (a publicly reachable URL) in place of `src_file_id`.
The app uses this only for YouCam's own sample images.

### 2.4 Run a task, then poll

| Step | Request | Response |
|---|---|---|
| Run | `POST /s2s/v2.x/task/<feature>` with JSON body | `{"status":200,"data":{"task_id":"..."}}` |
| Poll | `GET /s2s/v2.x/task/<feature>/<task_id>` | `{"status":200,"data":{"task_status":"running"\|"success"\|"error","results":...,"error":<code\|null>,"error_message":"..."}}` |

- Polling cadence: the docs say "poll ... at regular intervals (e.g., every 10 seconds)". [doc] polling guide
- **Units are charged only when the task reaches `success`.** No units are charged while the task is `running` or when it ends in `error`. [doc] skin-analysis guide, Step 6
- Units nearing expiry are deducted first. [doc]
- The skin-analysis description says "Processed results are retained for 24 hours after completion". The retention page instead says task_id is valid for 30 days and download URLs for 2 hours. **These conflict.** The app reads results immediately and treats URLs as valid for at most 2 hours.
- FAQ: polling a timed-out task returns `InvalidTaskId`. [doc]
- The run endpoint can return 400 `RunError` with `error_code` ∈ `InvalidParameters | CreditInsufficiency | BadRequest | InvalidStyleGroup | InvalidStyle`. [doc]
- The poll endpoint can return 400 `{"status":400,"error":"Invalid task ID"}` and 500 `{"status":500,"error":"Task execution timed out"}`. [doc]
- Webhooks follow the Standard Webhooks spec, with an HMAC-SHA256 secret prefixed `whsec_`. They need a public HTTPS endpoint, so a local demo uses polling. [doc] https://docs.perfectcorp.com/develop/webhook

### 2.5 Delete a task and its files: `POST /s2s/v2.0/task/delete` [doc]

https://docs.perfectcorp.com/reference/task_management.md (added in v1.13, 2026-06-29).

- Request: `{"task_id": "<id from run>"}`. Response: `{"status":200}`.
- Errors (400): `OperationNotSupport` (wrong id type), `OperationInvalid` (task not finished), `InvalidTaskId`, `InvalidParameters`.
- It "Delete[s] a finished task ... including all associated input files and generated outputs".
- **The app calls it right after it has copied the results.** Without it, uploads and outputs stay on YouCam storage for 30 days.

## 3. Retention and rate limits [doc]

- https://docs.perfectcorp.com/develop/file_retention_period
  - Uploaded files and `file_id` are kept 30 days. `task_id` is valid 30 days.
  - Result download URLs are valid **2 hours**.
  - Everything is auto-deleted after 30 days.
- https://docs.perfectcorp.com/develop/rate_limit
  - **250 requests per 300 s per IP AND per access token.** Exceeding either returns 429.
  - Recommended pace is about 5 QPS.
  - The app's client paces itself to 4 QPS and keeps a sliding 300 s window of at most 200 requests.

## 4. Units (cost) [doc unless marked]

- Balance: `GET /s2s/v1.0/client/credit` returns `{"status":200,"results":[{"id":..,"type":"ApiSubsToken"|"ApiPaygToken","amount_dec":10.04,"expiry":<ms>}]}`. `amount` is deprecated. https://docs.perfectcorp.com/reference/unit_system.md
- History: `GET /s2s/v1.0/client/credit/history?page_size=1..30&starting_token=` returns `{"result":{"next_token","history":[{id,timestamp,action,target_id,info:{credits:[{id,amount_dec}],dst_actions}}]}}`.
- Live price list: `GET /s2s/v2.0/credit/feature-cost?page_size=1..20&starting_token=` returns `{"result":{"next_token","skus":[{"description","amount","unit":"result_image"|"second","proc_unit","run_task_url"}]}}`. The app reads this at startup when a key is set and **never charges below the documented table**.

Documented unit consumption (from the "Unit Consumption" section of each API page):

| Feature | Units | Source |
|---|---|---|
| Skin Analysis SD, 1–4 concerns | 9 | ai_skin_analysis bundle |
| Skin Analysis SD, 5–8 concerns | 12 | 〃 |
| Skin Analysis SD, 9–12 concerns | 14 | 〃 |
| Skin Analysis SD, 13–16 concerns | 16 | 〃 |
| Skin Analysis HD, 1–4 / 5–8 / 9–12 / 13–16 concerns | 12 / 16 / 20 / 22 | 〃 (applies to v2.0 and v2.1) |
| Fitzpatrick Skin Type v1.0 | 10 | ai_fitzpatrick_skin_type bundle |
| Facial Color Tones (skin-tone-analysis) v1.0 | 20 | ai_skin_tone_analysis bundle |
| Skin Simulation, 1–4 / 5–10 concerns | 4 / 6 | ai_skin_simulation bundle |
| Clothes VTO v2.0 / v3.0 | 2 / 2 | ai_clothes bundle |
| Clothes VTO **v4** | **2** | Not on the doc page. [verified 10-02] via feature-cost |

[verified 10-02] The live `feature-cost` list matches every row above for skin analysis v2.0/v2.1 (SD and HD tiers), Fitzpatrick and Clothes v2/v3/v4. The balance deltas matched too: SD with 16 concerns cost 16 units and Fitzpatrick cost 10.

- Dollar price: about $0.055 per unit pay-as-you-go and $0.048 subscribed. [3rd-party]: the Perfect Corp blog https://www.perfectcorp.com/business/blog/ai-clothes/virtual-try-on-api-pricing. The pricing page itself is client-rendered and was not readable.
- Budget math for 1,000 units: about 83 SD scans with 5–8 concerns, or 45 HD scans with 13–16 concerns.

## 5. AI Skin Analysis (main API for this project) [doc]

Bundle: https://docs.perfectcorp.com/_bundle/reference/ai_skin_analysis.yaml. Page: https://docs.perfectcorp.com/reference/ai_skin_analysis

### Endpoints

- `POST /s2s/v2.0/task/skin-analysis` and `GET /s2s/v2.0/task/skin-analysis/{task_id}`
- `POST /s2s/v2.1/task/skin-analysis` and `GET /s2s/v2.1/task/skin-analysis/{task_id}`
  - v2.1 (2026-06-09) has updated engines and up to 2560 px output.
  - It adds an optional boolean `pf_camera_kit`, which the app sets when the photo came from the YouCam JS Camera Kit. [unverified]: its exact effect isn't documented beyond the schema.

### Request

```json
{
  "src_file_id": "...",
  "dst_actions": ["wrinkle", "pore", "texture", "acne"],
  "miniserver_args": { "enable_mask_overlay": false },
  "format": "json"
}
```

Alternatively send `src_file_url` in place of `src_file_id`.

- `dst_actions` enum. **SD and HD must not be mixed**: mixing returns 400 `"cannot mix HD and SD dst_actions"`, and an unknown action returns `"Not available dst_action abc123"`.
  - SD: `wrinkle, pore, texture, acne, oiliness, radiance, eye_bag, age_spot, dark_circle_v2, droopy_upper_eyelid, droopy_lower_eyelid, firmness, moisture, redness, tear_trough, skin_type`
  - HD: the same list prefixed `hd_`, except that it is `hd_dark_circle` (not `_v2`).
- `format`: `zip` (default; the response is a URL to a ZIP of `skinanalysisResult/score_info.json` plus PNG masks) or `json` (scores and mask URLs inline). **The app uses `json`.**
- `miniserver_args` options:
  - `enable_mask_overlay` (default false). False returns a raw PNG mask with alpha; true returns a JPG blended onto the photo.
  - `enable/color/opacity_dark_background_hd_pore`
  - `…_hd_wrinkle`

### JSON result (task_status `success`)

```json
{"status":200,"data":{"task_status":"success","results":{"output":[
  {"type":"hd_wrinkle","region":"whole","raw_score":25.3,"ui_score":25,"mask_urls":["https://..."]},
  {"type":"hd_pore","region":"nose","raw_score":45.7,"ui_score":46,"mask_urls":["https://..."]},
  {"type":"hd_skin_type","region":"t_zone","skin_type":"Oily","mask_urls":["https://..."]},
  {"type":"skin_age","score":29},
  {"type":"all","score":28.5},
  {"type":"resize_image","mask_urls":["https://..."]}
]}}}
```

- `raw_score`: 1–100 float. Higher means healthier-looking skin.
- `ui_score`: 1–100 int, "adjusted ... to produce more favorable results". **The app shows ui_score for display but tracks raw_score for experiments**, because raw is not inflated.
- Regions:
  - HD pore: forehead, nose, cheek, whole.
  - HD wrinkle: forehead, glabellar, crowfeet, periocular, nasolabial, marionette, whole.
  - skin_type: whole, t_zone, u_zone, with values like Normal, Oily, Dry, Combination, Redness, Dry & Redness, Oily & Redness, Combination & Redness.
- [verified 10-02] SD output entries for scored concerns have **no `region`**: `{type, raw_score, ui_score, mask_urls:[1 url], url:null}`. Only `skin_type` carries `region` (three entries: whole, t_zone, u_zone). `all` and `skin_age` carry `score`. Every entry has an extra `url: null` the docs don't mention. SD uses `dark_circle_v2` as the type name in output too.
- [verified 10-02] With `enable_mask_overlay:false`, each mask is a PNG with alpha at the **same pixel size as the input** (1200×1600 for the sample), so it overlays the photo directly.
- Mask URLs are S3 links valid for 2 hours.

### Image requirements

- SD: short side ≥ 480 px. HD: short side ≥ 1080 px.
- Long side over 2560 px is auto-resized. Under 10 MB. jpg/jpeg/png.
- **Face width > 60% of image width.** Portrait orientation, even lighting, no glasses or bangs over the forehead, no makeup, front-facing, mouth closed.

### Skin-analysis-specific errors

`error_below_min_image_size, error_exceed_max_image_size, error_src_face_too_small, error_src_face_out_of_bound, error_lighting_dark`, plus the general engine codes `error_no_face, error_pose, error_face_parsing, error_nsfw_content_detected, error_inference, unknown_internal_error, …`. The full list is at https://docs.perfectcorp.com/develop/error_codes.

The app maps each code to plain-language retake advice (`src/shared/youcamErrors.ts`).

## 6. JS Camera Kit (capture SDK) [doc]

Documented inside the skin-analysis page (section "JS Camera Kit", v2.5).

- Script: `https://plugins-media.makeupar.com/v2.5-camera-kit/sdk.js`. It installs a global `YMK`.
- Set-up requirements:
  - Define `window.YMKAsyncInit` before the script loads.
  - A mount point `<div id="YMK-module">` is mandatory.
  - HTTPS is required (localhost is fine).
- `YMK.init({ faceDetectionMode: 'skincare'|'hdskincare'|..., imageFormat: 'base64'|'blob', language: 'enu', qualityLevel: 'relaxed'|'moderate'|'strict', videoQuality: '720p'|'1080p'|'1920p', countingDuration: 800 })`.
- Then call `YMK.openCameraKit()`. Events:
  - `faceQualityChanged {hasFace, position, frontal, lighting}`
  - `faceDetectionCaptured {mode, images:[{phase, image, width, height}]}`
  - `cameraFailed` (`error_permission_denied`, …)
  - `closed`
- Close with `YMK.close()`.
- No API key is passed to the kit in the docs. [unverified]: whether the kit phones home.
- **The app loads it lazily, only after consent and only when the user picks "Use camera".** Using the kit gives the experiment tracker consistent capture conditions (same distance, pose and lighting thresholds), which is what makes week-over-week comparisons meaningful.

## 7. AI Fitzpatrick Skin Type (secondary API) [doc]

Bundle: https://docs.perfectcorp.com/_bundle/reference/ai_fitzpatrick_skin_type.yaml

- Run: `POST /s2s/v2.0/task/fitzpatrick-scale-analyzer` with `{"src_file_id"|"src_file_url", "version":"1.0", "index"?: 0}`. `version` is required, and its only value is `"1.0"`.
- Poll: `GET /s2s/v2.0/task/fitzpatrick-scale-analyzer/{task_id}` returns `data.results = {"fitzpatrick_scale":"I".."VI","timed":<sec>}`.
- Optional multi-face pre-process: `POST …/fitzpatrick-scale-analyzer/pre-process` returns `results.result=[{left,top,width,height}]`. The array index becomes `index`.
- Image: **jpg/jpeg only**, short side ≥ 320, long side ≤ 4096, under 10 MB. The app converts PNG to JPEG in the browser first.
- Errors: `error_face_position_invalid, error_face_position_too_small, error_face_position_out_of_boundary, error_insufficient_lighting, error_face_angle_invalid, error_below_min_image_size`.
- Cost: 10 units.
- Used once per profile. The result only raises the priority of the existing "you have photosensitising actives but no SPF" flag. It is never used as a diagnosis.

## 8. AI Clothes VTO (researched, not used by the chosen concept) [doc]

Bundle: https://docs.perfectcorp.com/_bundle/reference/ai_clothes.yaml

- `POST /s2s/v2.0/task/cloth` (v2), `/cloth-v3`, `/cloth-v4`. Each has a matching `GET …/{task_id}`.
- `GET /s2s/v2.0/task/template/cloth` lists predefined templates (v2 only).
- Body: `src_file_id|src_file_url` + `ref_file_id|ref_file_url` (or `template_id` on v2) + `garment_category`.
  - Category values: `full_body|lower_body|upper_body|shoes|auto`; v4 adds `outer`.
  - Optional `change_shoes` (default true).
  - v4 adds `filter_multi_person: off|normal|strict`.
- Result: `data.results.url` (valid 2 hours).
- Image requirements:
  - User image: 1024×768 recommended, 512×384 minimum, ≤ 4096 px. Single person, upper body from the chest up with shoulders visible, standing, facing forward.
  - Reference: a front-facing single-garment product shot, or a single-person worn photo. Lower body accepts only worn photos.
- Errors: `error_pose, error_invalid_ref, error_apply_region_mismatch, error_invalid_src, error_editing_failed, error_multi_person`, …
- Cost: v2/v3 = 2 units. v4 is not listed.

## 9. Other APIs looked at

- **Facial Color Tones** (`/s2s/v2.0/task/skin-tone-analysis`): 20 units, jpg only. Returns skin, eye, brow, lip and hair colours. Not needed: no feature in this concept depends on colour matching.
- **Skin Simulation** (`/s2s/v2.0/task/skin-simulation`): 4–6 units. Renders "treatment progress" previews (0–1 sliders per concern). **Deliberately not used.** Showing a simulated improved face next to a product routine would read as an efficacy promise, which conflicts with the project's no-claims stance.
- **Face Attribute Analysis** (`/s2s/v2.0/task/face-attr-analysis`): face shape, ratios. Irrelevant here.

## 10. Privacy obligations

- API privacy policy: https://www.makeupar.com/perfectbeauty/youcam/privacy-policy-api. Terms: https://www.makeupar.com/perfectbeauty/youcam/terms-of-service-api.
- Per the owner's 10-02 read, the integrating app is the data controller and must obtain end-user consent for face photos; BIPA and GDPR are mentioned.
- How the app meets this:
  - An explicit consent screen comes before any photo is chosen. Consent is versioned and can be withdrawn.
  - The server keeps the photo in memory only and never writes it to disk.
  - The YouCam task and its files are deleted right after the results are copied.
  - Scores and the photo thumbnail stay in the user's browser.

## 11. Open questions to check with the real key (costs units, so these are the first things to run)

1. The real `POST /s2s/v2.0/file` response nesting (`data.files[]` vs `files[]`).
2. Whether SD JSON output carries `region` for skin_type, and what `ui_score`/`raw_score` look like for SD.
3. The `feature-cost` SKU descriptions for skin analysis and Fitzpatrick, and the v4 clothes cost.
4. Whether `task/delete` invalidates `mask_urls` immediately. The app copies the masks before deleting either way.
5. Typical skin-analysis latency, which tunes the poll back-off.
6. Whether the 401 body is `InvalidAccessToken` or `Invalid API key` on these endpoints.

All six were answered on 10-02. See §12.

## 12. Live verification results (2026-10-02)

Run with `npm run record-fixtures` (free calls) and then `npm run record-fixtures -- --tasks`. The script keeps a cumulative ledger in `data/verify-ledger.json` and refuses to go past 60 units in total.

| Call | Result |
|---|---|
| `GET /s2s/v1.0/client/credit` | 200. Two `ApiPaygToken` entries (1000 + 40), each with `id`, `type`, `amount`, `amount_dec` and `expiry` in ms. Free |
| `GET /s2s/v2.0/credit/feature-cost` | 200. 6 pages at `page_size=20`. `next_token` is a short base64 string and is `null` on the last page. Free |
| `POST /s2s/v2.0/file` | 200. Nested as **`data.files[0]`**, with `{content_type, file_name, file_id, requests:[{method:"PUT", url, headers:{"Content-Length","Content-Type"}}]}` |
| Presigned PUT | 200, sending only the two returned headers and no auth |
| `POST /s2s/v2.1/task/skin-analysis` (SD, 16 actions, `src_file_id`) | 200 `{data:{task_id}}` |
| `GET /s2s/v2.1/task/skin-analysis/{id}` | `{data:{error:null, results:null, task_status:"running"}}` three times, then `success` after **about 6.4 s** (4 polls) |
| `POST /s2s/v2.0/task/delete` | 200 `{"status":200}`. **The mask URLs return 404 right after delete**, so delete really removes the result files |
| `POST /s2s/v2.0/task/fitzpatrick-scale-analyzer` (`src_file_url` of a doc sample JPG, `version:"1.0"`) | 200, then `success` after 3 polls: `results:{timed:2325, fitzpatrick_scale:"I"}` |
| Bad or missing token on `/client/credit` | 401 `{"status":401,"error":"Unauthorized","error_code":"InvalidAccessToken"}` |

Units: 16 (skin SD with 13–16 concerns) + 10 (Fitzpatrick) = **26**. That leaves **1014** for development and the demo video.

The recordings in `fixtures/recorded/*.json` are redacted (every URL, file id and task id replaced). The masks for YouCam's sample face are in `fixtures/recorded/masks/yc-skin-01/`. They are git-ignored and used only locally by the mock to show real overlays.

The console also issued an RSA public key (`YOUCAM_PUBLIC_KEY` in `.env`). None of the endpoints this app uses need it. The app ignores it and never reads it.

### 12.1 End-to-end run through the Unstack server (2026-10-02, late)

One SD skin-analysis scan with 1 concern (moisture), run from the browser through the real server (Sample A uploaded as a file, so it went through `file` and presigned `PUT`): 9 units. `feature-cost` was checked first: SD 1–4 concerns is 9 units.

- Ledger reserved 9, charged 9 on success; balance 1014 → 1005, matching the price.
- The task was deleted after the mask was copied (Scan results show "Deleted at YouCam").
- Mask PNGs come back 1200×1600 for a 1200×1600 photo, so the overlay lines up without any scaling.
- **New:** the presigned result URLs serve masks as `Content-Type: binary/octet-stream`. The server now labels copied masks by their magic bytes (`image/png`), and the mock serves the same header.
- `data/verify-ledger.json` total: 26 → 35 of the 60-unit verification cap.
