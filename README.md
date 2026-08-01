# Guerrilla Ops

A COBie O&M dashboard in a single HTML file. Drop a COBie workbook in and get a
navigable, filterable view of the whole thing. No install, no webserver, no
account. Nothing leaves your machine.

**Try it here:** [Guerrilla-Ops live](https://digital-guerrilla.github.io/Guerrilla-Ops/Guerrilla-Ops.html)

## Getting started

1. Download `Guerrilla-Ops.html` (or use the hosted link above)
2. Open it in any modern browser. Double clicking the file is enough, it runs
   from disk with no webserver
3. Drag and drop a COBie Excel file (`.xlsx`, `.xls`, `.xlsm`) onto the page,
   or use **Select Files** / **Open Folder** to load several workbooks at once

Everything is parsed in your browser. No data is uploaded anywhere, so it is
safe to use with live project information, on site, or offline.

## What you can do

- **Browse assets** by Facility, Floor, Space, Type, System and Document
  Category, with live cross filtering. Every filter shows a count of matching
  components so you can see where the data is before you click
- **Search everything.** One search box covers names, serial numbers, tag
  numbers, barcodes, asset identifiers, descriptions, manufacturers and more
- **Group your way.** Drag the grouping chips to nest the asset list however
  you think about the building, for example Floor then Space then Type
- **Open documents.** O&M manuals, certificates and other linked documents are
  shown against their component, type, space, system or facility, with copy
  and open buttons for file paths and links
- **Document view.** Flip the whole dashboard to a document first view when
  the question is "what paperwork do we hold" rather than "what assets exist"
- **Edit and create.** Fix values, reassign types and spaces, manage document
  links, and add new spaces, types, components, systems and contacts through
  the built in forms
- **Export back to COBie.** Changes are tracked per facility and can be saved
  back to Excel, either overwriting the original file name or as a new
  `_modified` copy

## Multiple buildings

Load a folder of COBie files and Guerrilla Ops merges them into one view,
tagged per facility. The Facility filter and facility grouping keep estates
work manageable across any number of buildings.

## Contributing

Fork it, break it, improve it. Pull requests are welcome, and if you want to
be an active contributor please get in touch through
[digital-guerrilla.scot](https://digital-guerrilla.scot).
