# App Store screenshots

Source artwork for the App Store listing. Uploaded to App Store Connect with the
`asc_upload_screenshot` tooling, not by any build step — nothing here ships inside the app.

## The size is not negotiable

The listing's only screenshot set is `APP_IPHONE_67`, which accepts **1290 × 2796**
portrait PNG and rejects every other dimension outright. Apple scales that set down for
smaller iPhones, so this one size is enough to submit; iPad would need its own set.

## What is here

| File | Size | Store-ready |
|---|---|---|
| `EZChangeOrder_DontDoExtraWork_B_852x1846.png` | 852 × 1846 | **no** |

That file is a DOWNSCALED copy (roughly 1.51× too small, same aspect ratio) that arrived
through a chat attachment rather than as an export. It is kept because it is the current
design and the only copy on hand — not because it can be uploaded.

Do not upload it and do not upscale it to make the check pass: the artwork is almost
entirely text, it would sit beside `EZChangeOrder_DontDoExtraWork_A_1290x2796.png`
(already live at full resolution), and a soft screenshot on a Retina product page is a
visible downgrade to the one page that sells the app.

Replace it with a real 1290 × 2796 export from the design source, then upload.

## Already live on the listing

Version 1.0 (`PREPARE_FOR_SUBMISSION`), locale `en-US`, set `APP_IPHONE_67`:

1. `EZChangeOrder_DontDoExtraWork_A_1290x2796.png`
2. `EZChangeOrder_AppStore_01_1290x2796.png`

Slot 1 is what a browser sees first.
