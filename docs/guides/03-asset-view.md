# Asset View

[Guide index](README.md) | Previous: [Find, filter, and group](02-find-filter-group.md) | Next: [Document View](04-document-view.md)

Asset View is the default workspace for installed components and their COBie relationships.

## Open Asset View

Select **Asset View** above the results. Current Facility, Floor, Space, Type, and System filters continue to apply.

## Read a component card

A component card can show:

![Expanded component information example](../images/05-asset-card-details.png)

- Component name and description.
- Type.
- Space or location.
- Linked document badges.
- An **Info** action.
- Whole-card selection for highlighting the component in supported spatial views.

Select **Info** to open Component Information. The modal contains configured
property cards, associations, attributes, linked documents, and a component
location action when the required floor and coordinate data is available.

Double-click a value to edit it inline. Press **Enter** or move away from the
field to apply the value, press **Escape** to cancel the active edit, and use
**Undo** on a changed row to restore its original value.

## Use group information

Grouped headers provide an information action for the current group (Type, System, Space, Floor, or Facility).

The Information window shows available properties, associations, attributes,
and linked documents. Existing values are edited inline; association choices
are applied when selected.

## Follow relationships

Asset View uses the COBie references stored on each row:

- `Component.TypeName` links a component to a Type.
- `Component.Space` links it to a Space.
- Space data links the location to a Floor.
- System component lists link components to Systems.
- Every imported row is scoped to its source Facility.

QA View reports missing or unresolved references rather than inventing relationships.

## Work with component documents

Document badges on a component card represent documents linked to that
component. Select a badge to open Document Information, where values can be
edited inline and the link can be opened or copied.

Type, Space, Floor, System, and Facility documents are best reviewed in Document View. They are not automatically treated as documents owned by every descendant component.

If you select a Document Category, Guerrilla Ops opens Document View. You can return to Asset View to see components with directly linked component documents in that category.

## Edit a component

Select **Info** on a card and edit the Component Information cards inline.
Depending on the data, you can update:

- General component properties.
- Type.
- Space.
- System memberships.
- Linked documents.
- Component position on a floor plan.

Changing a component name also updates matching component references in System and Document data for the same Facility.

For full instructions, see [Edit and create records](06-edit-create.md).

## Useful Asset View workflows

### Find an asset by identifier

1. Search for its component name, tag, serial number, barcode, or asset identifier.
2. Group by Facility or Type if more than one result remains.
3. Open **Info**.

## Use Plan and 3D views

When the workbook contains Floor and Coordinate data, the results area can
show **Plan** and **3D** side panels.

- Select a component card or use a group **Highlight** action to emphasise matching geometry.
- Use the floor selector in 3D to overlay an available floor plan.
- Drag to rotate or pan the 3D view, zoom as supported by the pointer device, and use Reset to restore the default view.
- Open Component Information and use its location action to place or adjust a component when valid Space bounds are available.

If a panel reports that no coordinate data is available, review the Coordinate
sheet and the Facility, Space, and Floor relationships.

See the dedicated guides for complete instructions:

- [Plan viewer](09-plan-viewer.md)
- [3D viewer](10-3d-viewer.md)
- [Align Plan and 3D](11-align-plan-3d.md)

### Review all assets in one room

1. Select the Facility.
2. Select the Floor.
3. Select the Space.
4. Group by Type or System.

### Review one system

1. Select the Facility.
2. Select the System.
3. Group by Type.
4. Expand all groups.
