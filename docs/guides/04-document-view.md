# Document View

[Guide index](README.md) | Previous: [Asset View](03-asset-view.md) | Next: [QA View](05-qa-view.md)

Document View brings manuals, drawings, certificates, reports, and other COBie Document records into one relationship-aware list.

![Document View](../images/03-documents.png)

## Open Document View

Select **Document View**, or select a value in the **Document Category** filter. Selecting a category from Asset View switches to Document View automatically.

The result counter shows unique documents. Repeated COBie rows that point to the same Facility and Directory link are treated as one logical document for display and counts.

## Filter documents

You can combine Document Category with Facility, Floor, Space, Type, or System.

The available choices reflect the document's real relationship context. For example, a Type document can filter its Facility and Type, but does not automatically make every component, Space, Floor, or System a match.

This distinction is important when checking whether documentation has been attached at the correct COBie level.

## Group documents

Use the same draggable group controls as Asset View. Useful arrangements include:

- Facility -> Document Category
- System -> Document Category
- Floor -> Space -> Document Category
- Type -> Document Category

Groups such as **(No Type)** or **(No System)** mean the document is not related at that level. The document remains visible under that heading.

## Read a document card

A document card shows:

- Name or document number.
- Description.
- Relationship level and linked record.
- Category.
- **Info** and **Link** actions when available.

Select **Info** to open Document Information. Select **Link** to open the
Directory value in a new browser tab.

## Understand the Link field

Guerrilla Ops uses the COBie `Directory` value as the complete link. It does not join `Directory` and `File`.

Supported values can include:

- `https://` web addresses.
- `file:` addresses.
- Windows drive paths such as `C:\Documents\Manual.pdf`.
- UNC paths such as `\\server\share\Manual.pdf`.

Whether a local or network path opens depends on browser and security policy. Copy the path and open it in File Explorer when direct opening is blocked.

## Edit a document

Select **Info** on the document card. Document Information contains configured
fields including:

- **Name**
- **Description**
- **Category**
- **Link** (`Directory`)

It does not edit the linked Component, Type, Space, Floor, System, or Facility.

Double-click a value to edit it inline. To change the link:

1. Double-click the **Link** value.
2. Enter the complete URL, drive path, UNC path, or `file:` address.
3. Press **Enter** or move away from the field to apply it.
4. Use **Open link** or **Copy path** above the cards to check the result.

Use **Undo** on a changed row to restore its original value.

## Add or remove documents from an entity

Open the linked entity's **Info** view and use its **Documents** card:

- Select the add action to open a new Document Information draft linked to that entity.
- Complete Name, Description, Category, Link, and any required associations.
- Select **Save Document** to create the row or **Cancel** to discard the draft.

You can also select **Create > Document**. A document created from the main
menu starts with the current Facility as its relationship context; review its
associations before saving.

These changes remain unsaved until you update or download the workbook.
