# Making Byte in VRoid Studio

This swaps the built-in 3D Byte for a higher-detail model you make yourself. First time takes about 1-2 hours.


## What you need

- VRoid Studio (free, Windows). Get it from Steam (search "VRoid Studio") or the VRoid website.
- Optional, only for the cigarette: Blender plus the VRM Add-on for Blender.

## 1. Install and start

Install VRoid Studio, open it, and start a new model from a preset.

## 2. Body and face (chibi look)

- Pick a male preset as the base.
- Body tab: raise the head size and lower the overall height so the head is big and the body is short.
- Face tab: make the eyes big and round, set the iris to brown.
- For thick black eye outlines, use a bold eyeliner or eyelash option if your version has one, or paint thick lines on the face texture later.
- Skin: set a light skin tone.

## 3. Hair (brown, shaggy)

- Hair tab: start from a messy or shaggy preset and set the color to brown.
- Use the hair editing tools to pull a few strands out at the sides and back, so they poke out from under the cap.

## 4. Cap, letters, brim, mustache

- Check the Accessories tab for a cap or hat. If one fits, set its color to bright red.
- If nothing fits, make the cap from hair: add a hair group in the Hair tab, shape it into a rounded cap with a brim sticking forward, and color it red.
- Letters: open the texture editor for the cap (look for the texture or edit button on that item). Paint big white block letters on the front. A big soft brush gives the fuzzy look.
- Mustache: paint a thick brown mustache on the face texture above the lip, or add a small brown hair group there.

## 5. Shirt

- Clothing tab, Tops: choose a plain T-shirt.
- Texture editor: fill the base with dark teal or green and paint horizontal stripes across the body.
- White collar: paint it on the collar edge, or use a collar item if your version has one.

## 6. Cigarette (pick one)

- Skip it. VRoid has no cigarette item, and the overlay can add a 3D cigarette later.
- Or add it in Blender with the VRM Add-on: import the model, add a small white cylinder with a grey tip, parent it to the Head bone at the mouth corner, then export back to VRM.

## 7. Export

- Use the export option in VRoid Studio and choose VRM. Pick VRM 1.0 if it is offered. VRM 0.x also works.
- If the export screen shows texture size or polygon reduction, keep reduction moderate and set the texture size to 2048.
- Name the file `byte.vrm`.

## 8. Put it in place

1. Copy `byte.vrm` into `sidekick\overlay\avatar\`, the same folder as this guide.
2. Close Byte if it is running, then double-click `start.bat`.
3. In OBS, refresh the Browser Source. Its URL should be `http://localhost:7777/static/byte3d.html`.
4. To go back to the built-in model, rename or delete `byte.vrm` and restart.

## 9. Alternatives

- Commission a VRM on VGen or Booth, or buy a base model on Booth or VRoid Hub and edit it in VRoid Studio.
- Any VRM needs these expressions for lip sync and blinking: `aa` (mouth open), `blink`, `happy` and `relaxed`. VRM 1.0 uses these names. VRM 0.x files use A, Blink, Joy and Fun, and the overlay's loader maps those to the same names.
- Movement and effects like a thinking face come from the overlay code, not from VRoid. The model only needs the standard expressions above.

## Troubleshooting

- Nothing shows: check the file is exactly `byte.vrm` in `overlay\avatar\`, then refresh the OBS source.
- Model shows but the mouth does not move: the model is missing `aa`. Re-export as VRM 1.0 and check the expression names.
- Model is wrong size or stuck in the floor: re-export and check the height settings in the Body tab.
