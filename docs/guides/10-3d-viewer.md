# 3D viewer

[Guide index](README.md) | Previous: [Plan viewer](09-plan-viewer.md) | Next: [Align Plan and 3D](11-align-plan-3d.md)

The 3D viewer converts supported COBie Coordinate rows into an interactive
spatial view. Spaces provide room geometry, while Components can be shown at
their recorded or placed positions.


## Data needed

The panel appears when the workbook contains Coordinate rows. Useful geometry
normally requires:

- `SheetName` identifying `Space` or `Component`.
- `RowName` matching a record in the same Facility.
- Numeric X, Y, and Z coordinate values.
- Lower-left and upper-right rows for room or component boxes.
- Space-to-Floor relationships so rooms are placed on the correct storey.

A single valid point can represent a Component, but Space corner bounds give a
more useful room volume. Floor SVG attributes are optional and are used only
for the selectable floor-plan overlay.

## Open and resize the panel

- Select the vertical **3D** edge control to collapse or reopen the viewer.
- On a wide desktop, drag the panel's left edge to change its width.
- Clear restrictive filters if the panel says **No coordinate data available for the current view.**

The panel is hidden when the loaded workbooks contain no Coordinate rows.

## Navigate the model

Use these mouse controls over the 3D canvas:

| Action | Result |
| --- | --- |
| Mouse wheel | Zoom in or out |
| Middle-button drag | Rotate the model |
| Right-button drag | Pan the model |
| Left-click a room | Select that Space |
| Ctrl + left-click | Add or remove a Space from the current selection |
| Reset icon | Restore the default rotation, pan, and zoom |

Hover over supported room geometry to see its Space name and room number.

## Control what is shown

Facility, Floor, and Space filters control the visible room context. Type and
System filters, or component/group highlights, make matching Component
geometry visible. Selecting a room updates the Space filter and synchronises
the Plan viewer and result list.

Use **Remove all highlights** above the results when a previous result
highlight is obscuring the current review.

## Add a floor-plan overlay

When a visible Floor has both SVG and Space coordinate bounds, the control at
the bottom of the 3D viewer shows **Floor plan...**.

1. Open the dropdown.
2. Select a Floor.
3. The same Floor opens in the Plan viewer.
4. Review the SVG plane against the room geometry.

Floors without a usable SVG are marked **(No SVG)** and cannot be selected as
an overlay. Selecting an overlay does not create an alignment; use
[Align Plan and 3D](11-align-plan-3d.md) if the drawing is rotated, mirrored,
scaled, or offset from the room geometry.

## Understand the geometry

Guerrilla Ops maps source Coordinate axes into its viewer coordinate system
and uses the matching Facility and row name to find each object. Invalid,
blank, and `n/a` numeric values are ignored. Duplicate rows prefer usable
numeric coordinates.

Space geometry can also use room polygons recovered from an aligned floor SVG.
When both are available, the SVG polygon provides the room footprint while the
Coordinate data supplies elevation and height.

## If the model does not work

| Symptom | Check |
| --- | --- |
| 3D panel is absent | Confirm the workbook contains a Coordinate sheet with rows |
| Empty-state message appears | Clear filters and verify matching Facility, SheetName, and RowName values |
| Rooms appear as points or are missing | Add valid Space lower-left and upper-right coordinates |
| Components are not visible | Apply a Type/System filter or highlight matching component results, then check Component Coordinates |
| Floor overlay is unavailable | The Floor needs both an SVG and usable Space coordinate bounds |
| Overlay does not match rooms | Save or modify the Plan-to-3D alignment |

## Next step

Continue to [Align Plan and 3D](11-align-plan-3d.md).