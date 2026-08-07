<div align="center">

# Guerrilla Ops

### A quick, visual way to explore and update COBie information

Turn an Excel workbook into a searchable view of your buildings, assets,
systems and documents. No installation. No account. No data upload.

[![Open Guerrilla Ops](https://img.shields.io/badge/Open_Guerrilla_Ops-00ADED?style=for-the-badge&logo=googlechrome&logoColor=white)](https://digital-guerrilla.github.io/Guerrilla-Ops/)

![Single HTML file](https://img.shields.io/badge/Single_HTML_File-323232?style=flat-square)
![Runs in your browser](https://img.shields.io/badge/Runs_in_Your_Browser-323232?style=flat-square)
![COBie Excel](https://img.shields.io/badge/COBie-Excel-217346?style=flat-square&logo=microsoftexcel&logoColor=white)

</div>

<p align="center">
  <img src="dev/svgs/Guerrilla-Ops.svg" alt="Guerrilla Ops asset browser" width="20%">
</p>

<p align="center">
  <a href="#get-started">Get started</a> ·
  <a href="#2-find-the-information-you-need">Find assets</a> ·
  <a href="#3-choose-a-working-mode">Choose a view</a> ·
  <a href="#4-review-update-and-create-records">Edit and create</a> ·
  <a href="#save-your-work">Save your work</a> ·
  <a href="#detailed-user-guides">Detailed guides</a>
</p>

---

## What can it do?

| Explore | Maintain |
| --- | --- |
| Find assets without working through a large spreadsheet | Check COBie information for common gaps and broken links |
| See where equipment is, what type it is and which system it belongs to | Edit records and create new items in a shared information view |
| Bring manuals, certificates and other documents into one view | Save changes back to Excel |
| Combine several building workbooks into one estate-wide view | Keep each building's information separate |
| Review floor plans and coordinate data beside the results | Position components where spatial data is available |

## Get started

1. **Open Guerrilla Ops.** Use the [live version](https://digital-guerrilla.github.io/Guerrilla-Ops/Guerrilla-Ops.html),
   or download and double-click `Guerrilla-Ops.html`.
2. **Choose your data.** Open one COBie workbook, several files, or a folder.
3. **Start exploring.** Filter, search, group and open records.

> [!NOTE]
> Your workbook is read inside your browser. It is not uploaded to a server.

## Detailed user guides

The guides below provide step-by-step help beyond this quick introduction.

| Guide | Covers |
| --- | --- |
| [Getting started](docs/guides/01-getting-started.md) | Loading modes, appending workbooks, privacy and screen layout |
| [Find, filter, and group](docs/guides/02-find-filter-group.md) | Search, cross-filter counts, active filters and result grouping |
| [Asset View](docs/guides/03-asset-view.md) | Component cards, details, relationships and asset workflows |
| [Document View](docs/guides/04-document-view.md) | Document context, categories, links and inline document editing |
| [QA View](docs/guides/05-qa-view.md) | Audit findings, severity, corrections and report download |
| [Edit and create records](docs/guides/06-edit-create.md) | Properties, associations, renaming, documents and new records |
| [Save, discard, and close](docs/guides/07-save-close.md) | Standard and editable saves, rollback and session safety |
| [Troubleshooting and data notes](docs/guides/08-troubleshooting-data.md) | Browser limits, file issues, links and COBie relationships |
| [Plan viewer](docs/guides/09-plan-viewer.md) | Floor SVGs, room selection, plan controls and replacing drawings |
| [3D viewer](docs/guides/10-3d-viewer.md) | Coordinate geometry, navigation, selection and floor overlays |
| [Align Plan and 3D](docs/guides/11-align-plan-3d.md) | Match an SVG floor plan to Space coordinate geometry and save the transform |
| [Locate components](docs/guides/12-locate-components.md) | Place Components on floor plans, set height and verify the position in 3D |

Start from the [complete guide index](docs/guides/README.md) for suggested reading paths.

## 1. Open your workbook

<p align="center">
  <img src="docs/images/01-open-workbook.png" alt="Choose a COBie workbook" width="900">
</p>

| Option | Use it when... |
| --- | --- |
| **Select Files** | You want to open one or more COBie workbooks |
| **Open Folder** | You want to load all COBie workbooks from a folder |
| **Open Editable XLSX** | You want Chrome or Edge to update an `.xlsx` file directly |
| **Drag and drop** | You already have the files open in Explorer |

## 2. Find the information you need

Use the columns to narrow the results by **Facility**, **Floor**, **Space**,
**Type**, **System** or **Document Category**. The numbers beside each option
show matching components in Asset View or unique documents in Document View.

The search box checks names, descriptions, serial numbers, tags,
manufacturers and other useful fields.

### Group and reorder results

The **Group** controls above the results decide how records are arranged:

1. **Turn on a group.** Click **Floor**, **Space**, **Type** or another group
   name. Active groups have a dark background.
2. **Add more levels.** Turn on as many groups as you need. Click an active
   group again to remove it.
3. **Set the order.** Drag the group names left or right. The leftmost active
   group becomes the outer level.
4. **Open the results.** Select **Expand All** to open every group.

> **Location-led example:** `Floor` → `Space` → `Type`<br>
> **System-led example:** `System` → `Type`

## 3. Choose a working mode

The buttons above the results let you look at the same workbook in three
different ways. Your active filters continue to apply when you move between
views.

| Mode | Best for | What you will see |
| --- | --- | --- |
| **Asset View** | Finding equipment | Components, locations, types, systems and full asset records |
| **Document View** | Finding information files | Manuals, certificates, drawings, links and network file paths |
| **QA View** | Checking data quality | Missing references, unresolved relationships and incomplete records |

### Asset View

Use **Asset View** for equipment and component information. It is the best
starting point for finding an asset, checking where it is installed, seeing
its type and system, or opening its full record.

The **Group** controls are most useful here. Try **System → Type** for a
system-led view or **Floor → Space → Type** for a location-led view.

### Document View

Select **Document View** to focus on manuals, certificates, drawings and other
linked files. The same filters remain available, so you can quickly reduce a
large document set to one building, space, system or asset type.

Expand a result to see its document details. Web links can be opened directly,
and file paths can be copied for use on your local network.

### QA View

Use **QA View** to check the workbook for common COBie problems, including
missing references, unresolved relationships and incomplete records. Findings
are grouped by check and marked as errors, warnings or information.

The **Facility** filter controls which buildings are audited. Select a finding
to inspect or edit the affected record, then return to QA View to see the
updated results. A report of the findings can also be downloaded.

## 4. Review, update and create records

Open a record's **Info** view to update its properties and relationships.
Double-click a value to edit it inline; press **Enter** or move away to apply
the value, and use **Undo** to restore the original. Depending on the record,
you can change its type or space, update system membership, position a
component, and add or remove linked documents.

### Create a new item

Select **Create**, choose the kind of item, and complete the new Information
view. You can add `Spaces`, `Types`, `Components`, `Systems`, `Contacts`, and
`Documents`.

> [!TIP]
> When several workbooks are open, choose the correct facility before saving.

New items behave like edited records: they appear under **Unsaved Changes**
until you update or download the workbook.

## Save your work

The **Unsaved Changes** button appears after an edit.

| Action | What it does |
| --- | --- |
| **Refresh Display** | Rebuilds the dashboard using your latest values |
| **Discard All** | Restores workbook data to the session baseline |
| **Download Modified Copies** | Downloads updated copies of the workbooks |
| **Download with Original Names** | Downloads standard-mode outputs using the source filenames |
| **Update Selected Files** | Updates files opened with **Open Editable XLSX** |

> [!IMPORTANT]
> Standard `.xlsx` files provide the best formatting fidelity. Legacy `.xls`
> and macro-enabled `.xlsm` files use a compatibility export. Unmanaged
> workbook sheets are retained.

## Working with several buildings

Load several workbooks or an entire folder and Guerrilla Ops combines them in
one dashboard. Additional selections append to the current session instead of
replacing it. Use the **Facility** filter or grouping control to move between
buildings while keeping each workbook's information separate.

## Good to know

| | |
| --- | --- |
| **Supported files** | `.xlsx`, `.xls` and `.xlsm` |
| **Direct updates** | Require a current Chromium browser such as Chrome or Edge |
| **Internet access** | Needed to load the interface libraries |
| **Application format** | One portable HTML file |

The footer includes project attribution, license links, and a **Terms of use** popup.

## AI use disclaimer

This project has been developed and documented with assistance from artificial
intelligence tools. AI-assisted output may contain errors or omissions and does
not replace professional judgement, project information requirements, or an
independent review of the source data.

Guerrilla Ops itself does not provide an AI service and does not send loaded
workbook data to an AI model. Users remain responsible for checking QA findings,
edits, document links, and exported workbooks before relying on them or using
them in a production information-management process. Work from backups and
review the resulting Excel files against the original data.

## Contributing

Ideas, fixes and pull requests are welcome. To get involved, visit
[digital-guerrilla.scot](https://digital-guerrilla.scot).

The development source is under `dev/`. Run the regression checks and rebuild
the self-contained release files with:

```powershell
npm test
npm run build
```
