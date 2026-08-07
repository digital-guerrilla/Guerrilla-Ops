# Troubleshooting and data notes

[Guide index](README.md) | Previous: [Save, discard, and close](07-save-close.md) | Next: [Plan viewer](09-plan-viewer.md)

Use this guide for common loading, browser, filtering, document-link, and COBie relationship issues.

## Loading problems

### A workbook is skipped

Check that:

- Its extension is `.xlsx`, `.xls`, or `.xlsm`.
- Excel can open it without a repair warning.
- It is not password protected.
- It contains recognisable COBie sheets and headers.

Guerrilla Ops reports skipped workbooks after processing the remaining selection.

### I cannot mix loading actions

A session is either standard or editable.

- In a standard session, append with **Load Files** or **Load Folder**.
- In an editable session, append with **Open Editable**.
- Select **Close** to start again in the other mode.

### Open Editable is missing

Direct updates require the File System Access API. Use a current Chrome or Edge browser. Standard loading remains available in other modern browsers.

## Results and filters

### The result panel is empty

1. Clear global search.
2. Select **Clear all**.
3. Confirm the correct Asset, Document, or QA View.
4. Expand grouped results.
5. Check whether the source COBie relationship uses the expected row and sheet names.

### Selecting a Document Category changes the view

This is intentional. Category selection opens Document View so parent-level Facility, Floor, Space, Type, or System documents can be shown without pretending they belong to every component.

### A document is under (No Type) or (No System)

The document has no relationship at that level. Change the active grouping or correct the Document sheet's `SheetName` and `RowName` values if the relationship is wrong.

### Counts are lower than Document-sheet row counts

Document counts represent logical unique documents. Repeated rows with the same Facility and Directory link are deduplicated for display.

## Document links

### Browse shows only a filename

Browsers hide full local paths for security. Paste the complete drive, UNC, `file:`, or web link into **Link** when the full path is required.

### A local or network link does not open

Browser security or organisation policy may block local paths. Copy the displayed path and paste it into File Explorer.

### File and Directory are not joined

This is intentional. Guerrilla Ops treats COBie `Directory` as the complete link. The legacy `File` field is retained on existing rows but is not displayed or concatenated.

## Saving problems

### Update Selected Files is unavailable

The workbooks were loaded in standard mode or the browser does not support direct updates. Download the outputs, or close the session and reopen `.xlsx` files with **Open Editable XLSX**.

### I refreshed and lost changes

Unsaved changes exist only in browser memory. Browser refresh cannot recover them. Save or download before refreshing.

### An output looks different in Excel

`.xlsx` has the best formatting fidelity. `.xls` and `.xlsm` use compatibility export. Check styles, formulas, macros, and unmanaged sheets before replacing production files.

## COBie sheets used by the tool

| Sheet | Main use |
| --- | --- |
| Facility | Building identity, units, and source-workbook scope |
| Floor | Floor names, elevations, and heights |
| Space | Rooms and their Floor references |
| Type | Product and equipment type information |
| Component | Installed assets linked to Type and Space |
| System | System records and Component memberships |
| Document | Document metadata, category, complete Directory link, and linked row |
| Contact | People and organisations, including `CreatedBy` references |
| Coordinates | Geometry used for 3D view |
| Attributes | used to store floor plan svgs and any other attributes |

Other workbook sheets are not used by the dashboard but are retained in supported `.xlsx` save flows.

## Document relationship rules

A Document row uses:

- `SheetName` to identify Facility, Floor, Space, Type, System, or Component.
- `RowName` to identify the linked record.
- `Category` for document filtering.
- `Directory` for the complete link.

The linked record must exist in the same Facility scope. Use QA View to find unresolved relationships.

## Privacy and external links

Workbook parsing occurs locally in the browser. The application does not upload workbook contents.

Internet access is required to load third-party interface libraries. Selecting an external document link opens that destination in the browser and is then subject to the destination's own network and privacy controls.

## Still stuck

Record:

- Browser name and version.
- Workbook extension.
- Loading mode.
- Facility and active filters.
- Exact warning or error text.
- Whether Excel reports workbook repairs.

Use a copy of sensitive workbooks when reproducing a problem.

For spatial-data-specific checks, continue to the [Plan viewer](09-plan-viewer.md),
[3D viewer](10-3d-viewer.md), and [Align Plan and 3D](11-align-plan-3d.md) guides.
