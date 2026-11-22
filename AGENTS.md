<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

- Serve Coach lives as a static app in public/serve-coach (plain JS modules, IndexedDB clips); / redirects to it. Why: imported as-is from moonstudio-dev/Serve-tracker (integration/serve-coach) without a rewrite.
- Swing-speed extraction is a pure function over saved normalised MoveNet frames and recorded video dimensions; replay applies the clip's pose/video clock offset. Why: analysis must not alter capture, re-run the model, or depend on playback speed, and peak seeking must match the video clock.
- Replay movement shows contact-local torso-scaled hand estimates or explicitly clip-relative movement bands; its arc is only a 300 ms wrist trail. Why: normalized image velocity is not physical speed and full-clip arcs obscure the footage.
- Replay contact analysis uses the recorded serving arm (session/profile fallback for legacy clips), a trophy-to-apex pose heuristic, clip-median torso scale and 65 mph per-step clamping; when no contact is found, swing speed falls back to a labelled forward-swing peak without creating a contact. No toss-arm inference. Why: isolate the racket arm, keep phases honest, and still give phone footage a speed estimate.
- Video upload was removed; live recording is the only capture path. Replay still opens legacy uploaded clips and reuses upload-media seek helpers. Why: iPhone first-pick decoding was unreliable.
- Personal notes use the local IndexedDB notes store with sessionId, stable IDs and timestamps, exposed through listNotes(sessionId), saveNote and deleteNote; legacy strings migrate without guessed session links and session deletion removes its notes. Why: preserve private local history and provide structured user data for future coaching without enabling coaching now.
- Session/clip schema versions are independent of analysis versions; derived per-frame confidence, joint angles and contact-local estimates live in analyses keyed by clipId alongside untouched poses/chunks, finalized on live/upload saves and backfilled from saved frames. Session duration is the sum of non-deleted clip durations, and captured hand/stroke metadata never follows later profile edits. Why: keep recordings and extensible metrics linked through reloads without duplicating media or changing capture/model processing.
- Journal export reads a single metadata-only IndexedDB snapshot, uses saved contact metrics and the shared extension-feedback formatter, and prepares its file before a separate download/share tap. Why: omit heavy media/pose arrays and example coaching, preserve original analysis meaning, and retain mobile user activation without truncating history.
- Progress mounts phase comparison and Coach topics without the recording-insight panel or historical saved-serve comparison; the recording picker belongs to phase comparison. Why: removed panels must not load extra video players or affect saved clips, phase selection and topic advice.
- Serve-phase comparison seeks original saved video on-device, overlays only nearby aligned confident poses, compares to original mirrored reference-pose diagrams, and stores manual video-time choices on the clip independently of derived analysis. Why: preserve footage, avoid fabricated phase/ball claims, and retain manual choices through analysis refreshes.
- No pixel-colour ball tracking and no free-text coach box: coach answers come from fixed topic buttons over saved pose evidence. Why: colour scanning was unreliable and stalled mobile decoders, and keyword matching misled users into expecting a chatbot without paying for an LLM.
