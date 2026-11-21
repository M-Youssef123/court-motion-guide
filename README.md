# Court Motion Guide

Review the codebase I provided here from the ZIP carefully to understand how recorded video clips are captured, stored as Blobs, and rendered on the post-recording review/feedback screen for this serve coach app.

Implement a mobile-optimized "Save / Download Video" feature with the following requirements:

1. Native Mobile & iOS Support:

   - On mobile devices (especially iOS Safari / iPhone), standard `<a download>` links often fail or only save to iCloud Files rather than the camera roll.

   - Implement the Web Share API (`navigator.canShare` / `navigator.share`) using a `File` object created from the recorded `Blob`. On iOS, opening the native share sheet allows the user to tap "Save Video" directly to their Photos gallery or save to Files.

   - Provide a seamless fallback to an `<a download="..." href="blobUrl">` anchor trigger for browsers/devices where `navigator.share` with files is unavailable.

2. Original Quality & Full Resolution:

   - Do not re-encode, compress, or downscale the video. Export the exact raw Blob captured by `MediaRecorder`.

   - Ensure the filename has a clear naming convention (e.g. `serve-coach-YYYYMMDD-HHmmss.mp4` or appropriate extension matching the MIME type).

3. UI & UX Integration:

   - Add a prominent "Save Video" / "Download" button on the post-recording/feedback screen alongside the replay controls.

   - Show clear loading or success feedback while preparing the download, and handle permission denials or cancellations gracefully without breaking the UI.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://court-motion-guide.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/07e91af3-909d-48b8-bddb-7e0986b7c630).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
