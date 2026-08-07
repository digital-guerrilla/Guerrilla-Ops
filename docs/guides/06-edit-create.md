# Edit and create records

[Guide index](README.md) | Previous: [QA View](05-qa-view.md) | Next: [Save, discard, and close](07-save-close.md)

Edits and new records are applied to the in-memory COBie data immediately. They are not written to a workbook until you use an action in **Unsaved Changes**.

![Information view with inline editing](../images/04-edit-record.png)

## Edit an existing record

Select **Info** on a component, document, or group header to open the shared
Information view. It usually separates the record into cards for properties,
associations, attributes, and documents.

- Double-click a value to start editing.
- Press **Enter** or move away from the field to apply it.
- Press **Escape** to cancel the active field edit.
- Use **Undo** on a changed row to restore its original workbook value.
- Select association checkboxes to apply relationship changes.
- Use **Clear All** where a many-value association supports it.

Applied changes are recorded under **Unsaved Changes** immediately. Closing an
existing Information view does not discard changes already applied there.

QA findings are the exception: their pencil action opens a correction form.
Select **Save Changes** to apply that form or **Cancel** to close it without
applying the form.

## Rename records carefully

Names are COBie keys. Guerrilla Ops prevents duplicate names within the same Facility and updates supported references when a record is renamed.

Rename handling includes:

- Component names in System memberships and linked Documents.
- Type names on Components and linked Documents.
- Space names on Components and linked Documents.
- Floor names on Spaces and linked Documents.
- System names in filters and linked Documents.
- Facility scope across the loaded workbook data.

Review QA View after a significant rename.

## Change associations

Depending on the record type, the Information view can provide:

- Type autocomplete for a Component.
- Space autocomplete for a Component.
- System membership checkboxes for a Component.
- Component membership checkboxes for a System.
- Floor selection for a Space.
- Linked Document rows.

Use the search field above a long option list to find the required System or
Component. Classification groups can be expanded or collapsed, and long lists
load additional choices as needed.

If a Component is assigned a new Type name that does not exist, Guerrilla Ops prompts the workflow to create that Type after saving the Component.

## Manage linked documents

The **Documents** card groups linked records by classification.

- Select a document to open Document Information.
- Double-click Name, Description, Category, or Link to edit it inline.
- Use **Open link** or **Copy path** to check the complete Directory value.
- Use the card's add action to create a linked Document draft.
- Select **Save Document** to create it or **Cancel** to discard the draft.

The hidden COBie `File` value on an existing row is retained for compatibility; the interface uses `Directory` as the complete link.

## Create a record

Select **Create**, then choose Space, Type, Component, System, Contact, or
Document. A blank Information draft opens with explicit **Save** and **Cancel**
buttons. Draft edits and associations are not added to the database until the
Save button is selected.

### Space

Typical fields include Name, Category, Floor, Room Tag, Description, Usable Height, Gross Area, and Net Area.

### Type

Typical fields include Name, Category, Asset Type, Manufacturer, Model Number, Description, and warranty details.

### Component

Typical fields include Name, Type, Space, Description, Assembly Type, Serial Number, Installation Date, and Tag Number.

### System

Enter Name, Category, and Description, then select the member Components.

### Contact

Enter the unique Name, usually the COBie email identifier, plus person, company, contact, category, location, and organisation details.

### Document

Enter Name, Category, Description, and Link, then review the Facility and other
available associations. Documents created from an entity's Documents card are
pre-linked to that entity.

## Position a component

Component Information can expose a location action when the selected Space has
usable Coordinate bounds and a floor plan is available. Use it to place the
component on the plan and set its height. Saving the placement updates the
component Coordinate rows and the 3D preview.

Plan-to-coordinate mapping uses the saved floor alignment. Complete
[Align Plan and 3D](11-align-plan-3d.md) before positioning components when the
SVG and coordinate room boxes do not already coincide.

See [Locate components](12-locate-components.md) for the complete placement,
height, 3D preview, and verification workflow.

## Choose the Facility

When more than one workbook is loaded, the Create window displays a Facility selector. Confirm this before creating the record.

Existing edits are also Facility-scoped. This allows similarly named records in separate workbooks to remain independent.

## Required and duplicate values

- Name is required for all creatable record types.
- Names must be unique for that record type within the selected Facility.
- A new record appears in the dashboard after creation, even if current filters would normally have a zero count.

## Review your work

After editing or creating:

1. Check the **Unsaved Changes** count.
2. Use **Refresh Display** if you want to force a dashboard rebuild.
3. Review the affected record in Asset, Document, or QA View.
4. Save before refreshing or closing the browser tab.
