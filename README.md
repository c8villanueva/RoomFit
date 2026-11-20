# RoomFit - Shop for your room

RoomFit is a browser prototype for comparing shopping finds with photos of your rooms. It supports several session-only rooms, rough color profiles, optional room and item suggestions, product-photo cutouts, one-room-per-item assignment, and a manually positioned preview.

## Run locally

1. Open this folder in VS Code.
2. In a terminal in this folder, run `python -m http.server 5500` (or `py -m http.server 5500` on some Windows systems).
3. Open `http://localhost:5500` in a modern browser.
4. Room and product photos are processed in the browser. Room or item suggestions download Transformers.js and a CLIP model on first use; keep an internet connection for those actions. Inference uses single-threaded WASM to avoid browser worker initialization failures. Model downloads report byte progress; a stalled analysis times out after 90 seconds and leaves manual item and room selection available.

## Shopper workflow

1. Upload a room photo. It is added to the saved room strip for the current page session. Name it before upload, choose or suggest its type, and add other rooms the same way.
2. Select a saved room or use the **Active room** selector in step 3 to see it in the large preview. Products are assigned to one room and appear only in that room.
3. Upload a product photo and click **Analyze item**. Once detected, the item label becomes its default name (duplicate finds receive a number); enter a custom name before analysis or edit the selected item name afterward. Model loading and image analysis show animated progress indicators. Choose whether to remove the photo background. Turn background removal off for artwork or whenever the full photo should stay visible.
4. RoomFit samples colors from the item photo, asks CLIP for a likely item label, and ranks rooms by rough color affinity. A prominent **Item Type -> Typical Room** card shows the use-based room suggestion separately from the color comparison. The room panel keeps the original base-photo palette visible and adds a live combined palette that includes items placed in that room. Item affinity scores compare against each room photo plus its other placed items, excluding the candidate item itself.
5. Correct the item-use category when needed. For example, mark an art print as flexible decor so its color affinity can guide placement. Choose **Show this item in** to assign the item to a room.
6. Drag the item in its assigned room and set its displayed width. Switching rooms hides it elsewhere.

## Computer vision and estimates

- **Room category:** zero-shot image classification with CLIP (`Xenova/clip-vit-base-patch32`) through Transformers.js, using a short list of room types.
- **Item category and typical room:** the same model compares a product image with shopping-item labels such as toaster, bed, or art print. Common item types map to typical room types separately from color scores; users can correct the category. The item is automatically assigned to a matching saved room by detected type or room name, regardless of which room is active.
- **Color affinity:** the app samples coarse RGB color bins from the whole room photo and item photo/cutout, then ranks rooms by nearest-color similarity. It does not detect artwork, wall color, or design style as separate objects.
- **Product cutout:** when enabled, estimates background color from image edges and flood-fills connected pixels within a configurable RGB distance. This is basic image processing, not semantic segmentation. When disabled, it keeps the complete uploaded image.
- **2D size estimate:** the foreground bounding box provides a pixel aspect ratio. If the shopper enters a known item width from its product label/specification, RoomFit multiplies it by that ratio to estimate a front-view height. It does not measure depth or derive true dimensions from the image.
- **Room mockup:** composites product images over the assigned room photo with manual drag and width controls. Room data and positions last only while the page remains open.

## Browser check list

1. Start the local server and open RoomFit. Add a room named `Living room`, then one named `Bedroom`. Confirm both thumbnails appear and selecting either changes the large preview.
2. Click **Analyze room photo** for a room photo. Confirm a suggestion appears and the room type can still be changed manually. The first model download can take time; its progress is shown. If recognition does not finish within 90 seconds, the photo remains available for manual item-use and room selection.
3. Upload a toaster or other kitchen appliance photo. After the model finishes, confirm the **Item Type -> Typical Room** card suggests Kitchen independently of color affinity. Set the room type to Kitchen and confirm the item is assigned there.
4. With no Kitchen room saved, confirm a toaster remains unplaced and the UI says a matching room is needed. Then set a room to Kitchen and confirm it becomes placed. Assign it manually to another room and verify it appears only there.
5. For artwork, turn background removal off, choose flexible decor, and confirm the entire source photo appears. Check the item/room swatches, affinity meter, and scores for rooms with deliberately different colors.
6. Turn background removal on for a plain-background object and off for another. Confirm the first is cut out and the second retains its photo background.
7. Enter a known item width for a front-facing product and compare the estimated silhouette height with the photo. Repeat with an angled photo to see why the estimate is approximate.
8. Test a cluttered store photo, a non-JPG/PNG file, offline model loading, and a narrow mobile viewport. Room type and item use can be selected manually if model inference fails.
9. Refresh the page. Confirm rooms, products, and assignments reset; this prototype does not persist sessions.

## Limitations

- Busy store backgrounds, colored backdrops, shadows, or items touching image edges can make the cutout inaccurate. There is no manual mask brush.
- With background removal off, the full image is shown and sampled, including its background.
- Model scores are suggestions. Review them for unusual objects, ambiguous photos, or rooms with mixed purposes.
- Color affinity is a coarse pixel comparison, not a trained interior-design recommendation. The combined room palette weights the base room profile and the sampled palettes of items assigned to that room; it updates when items are placed, moved between rooms, or removed. It uses the whole room image, so it cannot specifically compare an art print with other art. Lighting and camera white balance affect results.
- The height estimate assumes the provided width corresponds to the visible width and that the photo is close to straight-on. Perspective, angled photos, imperfect cutouts, and non-uniform shapes make it inaccurate.
- The preview is not augmented reality and cannot establish physical fit, perspective, occlusion, true scale, or how colors will look under home lighting.
- The CLIP model downloads from a public model host on demand. Download time, memory use, and device performance vary.
- Photos, saved rooms, products, placements, and assignments are temporary. Refreshing clears them; there is no account, save/export feature, or product catalog.





